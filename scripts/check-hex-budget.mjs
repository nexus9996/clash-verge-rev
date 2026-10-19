import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const EXTENSIONS = new Set(['.ts', '.tsx', '.scss'])
// Token definitions and stylesheet-level CSS variable defaults are the only
// legitimate homes for raw color literals.
const ALLOWED_PREFIXES = ['config/theme/', 'assets/styles/']
// Guard against regressions; lower this when a domain is migrated.
const HEX_BUDGET = 39
const HEX = /#[0-9a-fA-F]{3,8}\b/g

const collectFiles = (dir) => {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute))
      continue
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue
    if (entry.name.includes('.test.')) continue
    const relative = path.relative(SRC, absolute).split(path.sep).join('/')
    if (ALLOWED_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue
    files.push({ absolute, relative })
  }
  return files
}

const counts = collectFiles(SRC)
  .map(({ absolute, relative }) => ({
    file: relative,
    count: readFileSync(absolute, 'utf8').match(HEX)?.length ?? 0,
  }))
  .filter(({ count }) => count > 0)
  .sort((left, right) => right.count - left.count)

const total = counts.reduce((sum, entry) => sum + entry.count, 0)

console.log(`[hex] ${total} hardcoded color literals outside token files`)
for (const entry of counts.slice(0, 10)) {
  console.log(`  ${entry.count.toString().padStart(3)}  src/${entry.file}`)
}

if (total <= HEX_BUDGET) {
  console.log(`[hex] within budget (${HEX_BUDGET})`)
} else {
  console.error(
    `[hex] over budget by ${total - HEX_BUDGET}; use theme.palette, the generated CSS variables or config/theme/tokens.ts`,
  )
  process.exitCode = 1
}
