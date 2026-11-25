/**
 * Capture a reproducible frontend bundle baseline from a `vite build` output.
 *
 * The baseline separates what the webview must load before first paint
 * (entry script + modulepreload + stylesheet referenced by index.html) from
 * the lazy chunks that are only fetched on demand. `scripts/check-bundle-budget.mjs`
 * (planned in Phase 4) will compare against the emitted JSON.
 *
 * Usage:
 *   node scripts/perf/frontend-baseline.mjs --dist dist \
 *     --out docs/perf/frontend-baseline-YYYY-MM-DD.json
 */
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const argv = process.argv.slice(2)
const arg = (name, fallback = undefined) => {
  const index = argv.indexOf(name)
  if (index === -1 || index === argv.length - 1) return fallback
  return argv[index + 1]
}

const distDir = path.resolve(arg('--dist', 'dist'))
const outFile = arg('--out')
const label = arg('--label', path.basename(path.dirname(distDir)))
const gzipLevel = Number(arg('--gzip-level', '9'))

const readSize = (absolutePath) => {
  const buffer = readFileSync(absolutePath)
  return {
    rawBytes: buffer.byteLength,
    gzipBytes: gzipSync(buffer, { level: gzipLevel }).byteLength,
  }
}

const toPosix = (value) => value.split(path.sep).join('/')

const walk = (dir) => {
  const entries = []
  for (const name of readdirSync(dir).sort()) {
    const absolute = path.join(dir, name)
    const stats = statSync(absolute)
    if (stats.isDirectory()) {
      entries.push(...walk(absolute))
    } else {
      entries.push({
        absolute,
        relative: toPosix(path.relative(distDir, absolute)),
      })
    }
  }
  return entries
}

const indexHtmlPath = path.join(distDir, 'index.html')
const html = readFileSync(indexHtmlPath, 'utf8')

/** @type {Map<string, 'script' | 'modulepreload' | 'stylesheet'>} */
const initialRefs = new Map()
const normalizeRef = (href) => href.replace(/^\//, '').replace(/^\.\//, '')

for (const match of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
  initialRefs.set(normalizeRef(match[1]), 'script')
}
for (const match of html.matchAll(
  /<link[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g,
)) {
  initialRefs.set(normalizeRef(match[1]), 'modulepreload')
}
for (const match of html.matchAll(
  /<link[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g,
)) {
  initialRefs.set(normalizeRef(match[1]), 'stylesheet')
}

const files = walk(distDir)
  .filter(({ relative }) => /\.(?:js|css)$/.test(relative))
  .map(({ absolute, relative }) => ({
    file: relative,
    ...readSize(absolute),
  }))

const initial = []
const asyncChunks = []
for (const file of files) {
  const role = initialRefs.get(file.file)
  if (role) {
    initial.push({ ...file, role })
  } else {
    asyncChunks.push(file)
  }
}

const missing = [...initialRefs.keys()].filter(
  (ref) => !files.some((file) => file.file === ref),
)
if (missing.length) {
  console.warn(
    `[baseline] index.html references missing files: ${missing.join(', ')}`,
  )
}

const sum = (list, key) => list.reduce((total, item) => total + item[key], 0)
const sortByRaw = (list) =>
  [...list].sort((left, right) => right.rawBytes - left.rawBytes)

const initialJs = initial.filter((file) => file.role !== 'stylesheet')
const initialCss = initial.filter((file) => file.role === 'stylesheet')
const workers = asyncChunks.filter((file) => /\.worker|worker-/.test(file.file))

const git = (() => {
  try {
    return {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      branch: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      dirty:
        execFileSync('git', ['status', '--porcelain'], {
          encoding: 'utf8',
        }).trim() !== '',
    }
  } catch {
    return null
  }
})()

const baseline = {
  schemaVersion: 1,
  label,
  generatedAt: new Date().toISOString(),
  build: {
    distDir: toPosix(path.relative(process.cwd(), distDir)),
    indexHtml: 'index.html',
    gzipLevel,
  },
  git,
  environment: {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpu: os.cpus()[0]?.model ?? null,
    node: process.version,
    packageManager: 'pnpm@12.14.0',
  },
  initial: {
    files: sortByRaw(initial),
    js: {
      fileCount: initialJs.length,
      rawBytes: sum(initialJs, 'rawBytes'),
      gzipBytes: sum(initialJs, 'gzipBytes'),
    },
    css: {
      fileCount: initialCss.length,
      rawBytes: sum(initialCss, 'rawBytes'),
      gzipBytes: sum(initialCss, 'gzipBytes'),
    },
    rawBytes: sum(initial, 'rawBytes'),
    gzipBytes: sum(initial, 'gzipBytes'),
  },
  async: {
    fileCount: asyncChunks.length,
    rawBytes: sum(asyncChunks, 'rawBytes'),
    gzipBytes: sum(asyncChunks, 'gzipBytes'),
    topByRaw: sortByRaw(asyncChunks).slice(0, 20),
  },
  workers: {
    fileCount: workers.length,
    rawBytes: sum(workers, 'rawBytes'),
    files: sortByRaw(workers).map((file) => file.file),
  },
  totals: {
    jsCssFileCount: files.length,
    rawBytes: sum(files, 'rawBytes'),
    gzipBytes: sum(files, 'gzipBytes'),
  },
}

if (outFile) {
  const outputPath = path.resolve(outFile)
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`)
}

const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
console.log(
  `[baseline] label=${label} git=${git?.commit?.slice(0, 8) ?? 'unknown'}`,
)
console.log(
  `[baseline] initial JS ${initialJs.length} files: ${formatKb(sum(initialJs, 'rawBytes'))} raw / ${formatKb(sum(initialJs, 'gzipBytes'))} gzip`,
)
console.log(
  `[baseline] initial CSS ${initialCss.length} files: ${formatKb(sum(initialCss, 'rawBytes'))} raw / ${formatKb(sum(initialCss, 'gzipBytes'))} gzip`,
)
console.log(
  `[baseline] initial total: ${formatKb(baseline.initial.rawBytes)} raw / ${formatKb(baseline.initial.gzipBytes)} gzip`,
)
console.log(
  `[baseline] async ${asyncChunks.length} files: ${formatKb(sum(asyncChunks, 'rawBytes'))} raw (workers: ${workers.length})`,
)
console.log('[baseline] initial files (raw, gzip, role):')
for (const file of sortByRaw(initial)) {
  console.log(
    `  ${file.file}\t${formatKb(file.rawBytes)}\t${formatKb(file.gzipBytes)}\t${file.role}`,
  )
}
if (outFile)
  console.log(
    `[baseline] written to ${path.relative(process.cwd(), path.resolve(outFile))}`,
  )
