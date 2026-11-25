import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASELINE = path.join(ROOT, 'docs/perf/frontend-baseline.json')
const CAPTURE_SCRIPT = path.join(ROOT, 'scripts/perf/frontend-baseline.mjs')

/**
 * Compares a freshly captured bundle against the recorded baseline.
 * Only the initial JS payload is budgeted: lazy chunks (Monaco workers etc.)
 * are demand-loaded and would otherwise drown the signal.
 */
export const evaluateBudget = ({ current, baseline, tolerance = 1.02 }) => {
  const currentBytes = current?.initial?.js?.gzipBytes
  const baselineBytes = baseline?.initial?.js?.gzipBytes
  if (!Number.isFinite(currentBytes) || !Number.isFinite(baselineBytes)) {
    throw new Error('bundle baseline is missing initial.js.gzipBytes')
  }

  const budgetBytes = Math.floor(baselineBytes * tolerance)
  return {
    currentBytes,
    baselineBytes,
    tolerance,
    budgetBytes,
    deltaBytes: currentBytes - baselineBytes,
    deltaRatio: currentBytes / baselineBytes - 1,
    withinBudget: currentBytes <= budgetBytes,
  }
}

const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`

const readArgument = (argv, name, fallback) => {
  const index = argv.indexOf(name)
  if (index === -1 || index === argv.length - 1) return fallback
  return argv[index + 1]
}

const captureCurrent = ({ distDir, label }) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'clash-verge-budget-'))
  try {
    const output = path.join(tempDir, 'capture.json')
    execFileSync(
      process.execPath,
      [CAPTURE_SCRIPT, '--dist', distDir, '--label', label, '--out', output],
      { cwd: ROOT, stdio: 'inherit' },
    )
    return JSON.parse(readFileSync(output, 'utf8'))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

const main = () => {
  const argv = process.argv.slice(2)
  const distDir = path.resolve(ROOT, readArgument(argv, '--dist', 'dist'))
  const baselinePath = path.resolve(
    ROOT,
    readArgument(argv, '--baseline', path.relative(ROOT, DEFAULT_BASELINE)),
  )
  const tolerance = Number(readArgument(argv, '--tolerance', '1.02'))
  const label = readArgument(argv, '--label', 'frontend-budget')

  if (argv.includes('--record')) {
    const current = captureCurrent({ distDir, label })
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`)
    console.log(
      `[budget] recorded ${formatKb(current.initial.js.gzipBytes)} gzip initial JS as baseline: ${path.relative(ROOT, baselinePath)}`,
    )
    return
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const current = captureCurrent({ distDir, label })
  const result = evaluateBudget({ current, baseline, tolerance })

  console.log(
    `[budget] initial JS gzip: baseline ${formatKb(result.baselineBytes)} -> current ${formatKb(result.currentBytes)} (${(result.deltaRatio * 100).toFixed(1)}%), budget ${formatKb(result.budgetBytes)} (+${((result.tolerance - 1) * 100).toFixed(0)}%)`,
  )
  if (result.withinBudget) {
    console.log('[budget] within budget')
    return
  }

  console.error(
    `[budget] over budget by ${formatKb(-result.deltaBytes)}: update the baseline only for an intentional bundle change`,
  )
  process.exitCode = 1
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
