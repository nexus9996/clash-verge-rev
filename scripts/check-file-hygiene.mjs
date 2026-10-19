// Checks tracked text files for whitespace and newline hygiene.

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const SKIP_FILES = new Set(['.eslintcache', 'Cargo.lock', 'pnpm-lock.yaml'])

const SKIP_PREFIXES = [
  'dist/',
  'src-tauri/gen/',
  'src-tauri/icons/',
  'src-tauri/images/',
  'src/assets/',
  'target/',
]

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
const MARKDOWN_FILE = /\.mdx?$/i

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .filter((file) => !SKIP_FILES.has(file))
  .filter((file) => !SKIP_PREFIXES.some((prefix) => file.startsWith(prefix)))

const problems = []
for (const file of trackedFiles) {
  let buffer
  try {
    if (statSync(file).size > MAX_TEXT_FILE_BYTES) continue
    buffer = readFileSync(file)
  } catch {
    continue
  }
  if (buffer.includes(0)) continue

  const content = buffer.toString('utf8')
  if (content.includes('\r\n')) {
    problems.push([file, 'contains CRLF line endings'])
  }
  // Markdown uses trailing spaces for hard line breaks; only check other files.
  if (!MARKDOWN_FILE.test(file)) {
    const trailing = content.match(/[^\S\r\n]+$/gm)
    if (trailing) {
      problems.push([
        file,
        `${trailing.length} line(s) with trailing whitespace`,
      ])
    }
  }
  if (content.length > 0 && !content.endsWith('\n')) {
    problems.push([file, 'missing final newline'])
  }
}

for (const [file, message] of problems) {
  console.error(`${file}: ${message}`)
}
console.error(
  `checked ${trackedFiles.length} files, ${problems.length} problem(s)`,
)
if (problems.length > 0) process.exitCode = 1
