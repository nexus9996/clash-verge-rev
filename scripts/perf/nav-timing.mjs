import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  COLD_P95_MS,
  HOT_P95_MS,
  MIN_COLD_SAMPLES,
  MIN_HOT_SAMPLES,
  buildBaselineRecord,
  evaluate,
  formatReport,
  summarize,
  validateSamples,
} from './nav-timing-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_BASELINE = path.join(
  ROOT,
  'docs/perf/navigation-timing-baseline.json',
)

const usage = () => {
  console.log(`Usage: pnpm perf:nav-timing --file <navigation-timing.json> [options]

Input: the JSON copied from \`__vergeNavTiming.export()\` in the desktop dev app
(see docs/perf/navigation-timing.md). Use \`-f -\` to read stdin.

Options:
  --file <path>       Exported samples (required; '-' reads stdin)
  --check             Exit non-zero unless cold/hot p95 and sample counts pass
  --record            Write the measured baseline to docs/perf/navigation-timing-baseline.json
  --baseline <path>   Baseline file for --record (default: ${path.relative(ROOT, DEFAULT_BASELINE)})
  --hot-p95 <ms>      Hot navigation p95 budget (default: ${HOT_P95_MS})
  --cold-p95 <ms>     Cold navigation p95 budget (default: ${COLD_P95_MS})
  --min-hot <count>   Required hot samples (default: ${MIN_HOT_SAMPLES})
  --min-cold <count>  Required cold samples (default: ${MIN_COLD_SAMPLES})
  --json              Print the machine-readable report instead of a table
  --help              Show this message
`)
}

const readArgument = (argv, name, fallback) => {
  const index = argv.indexOf(name)
  if (index === -1 || index === argv.length - 1) return fallback
  return argv[index + 1]
}

const readInput = (file) => {
  const raw =
    file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8')
  return JSON.parse(raw)
}

const git = (args) => {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const main = () => {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    usage()
    return
  }

  const file = readArgument(argv, '--file')
  if (!file) {
    usage()
    throw new Error('--file is required')
  }

  const report = summarize(validateSamples(readInput(file)))
  const thresholds = {
    hotP95: Number(readArgument(argv, '--hot-p95', HOT_P95_MS)),
    coldP95: Number(readArgument(argv, '--cold-p95', COLD_P95_MS)),
    minHot: Number(readArgument(argv, '--min-hot', MIN_HOT_SAMPLES)),
    minCold: Number(readArgument(argv, '--min-cold', MIN_COLD_SAMPLES)),
  }
  const result = evaluate({ report, ...thresholds })

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ report, ...result }, null, 2))
  } else {
    console.log('[nav-timing] measured')
    console.log(formatReport(report))
    console.log(
      `[nav-timing] budgets: cold p95 ≤ ${thresholds.coldP95} ms (≥${thresholds.minCold} samples), hot p95 ≤ ${thresholds.hotP95} ms (≥${thresholds.minHot} samples)`,
    )
  }

  const shouldRecord =
    argv.includes('--record') && (result.ok || !argv.includes('--check'))
  if (shouldRecord) {
    const baselinePath = path.resolve(
      ROOT,
      readArgument(argv, '--baseline', path.relative(ROOT, DEFAULT_BASELINE)),
    )
    const record = buildBaselineRecord({
      report,
      thresholds,
      commit: git(['rev-parse', 'HEAD']) || 'unknown',
      environment: {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        node: process.version,
        dirty: git(['status', '--porcelain']) !== '',
      },
    })
    mkdirSync(path.dirname(baselinePath), { recursive: true })
    writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`)
    console.log(
      `[nav-timing] recorded baseline: ${path.relative(ROOT, baselinePath)}`,
    )
  }

  if (result.failures.length > 0) {
    console.error('\n[nav-timing] check failed:')
    for (const failure of result.failures) console.error(`  - ${failure}`)
    if (argv.includes('--check')) process.exitCode = 1
  } else {
    console.log('\n[nav-timing] check passed')
  }
}

try {
  main()
} catch (error) {
  console.error(`[nav-timing] ${error.message}`)
  process.exitCode = 1
}
