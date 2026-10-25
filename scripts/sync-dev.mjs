/**
 * Forecast syncing the upstream `dev` branch into the local fork branch.
 *
 * Prints the commits the upstream ref has that HEAD does not, the files each
 * one touches, the conflicts a `git merge` would hit, and the fixed resolution
 * rules this fork applies to its diverged toolchain (bun + oxlint/oxfmt live
 * only on `local`). The manual procedure lives in docs/upstream-sync.md.
 *
 * Usage:
 *   bun scripts/sync-dev.mjs [--upstream origin/dev] [--no-fetch] [--json]
 */
import { execFileSync } from 'node:child_process'

import { log_error, log_info, log_success } from './utils.mjs'

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)
const argValue = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1]
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(
    'usage: bun scripts/sync-dev.mjs [--upstream origin/dev] [--no-fetch] [--json]',
  )
  process.exit(0)
}

const upstream = argValue('--upstream', 'origin/dev')
const shouldFetch = !hasFlag('--no-fetch')
const asJson = hasFlag('--json')

const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const gitResult = (...args) => {
  try {
    return { ok: true, stdout: git(...args), stderr: '' }
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout ?? '').toString().trim(),
      stderr: (error.stderr ?? '').toString().trim(),
      message: error.message,
    }
  }
}

/** Resolution rules for the files this fork intentionally diverges on. */
const RESOLUTION_RULES = [
  {
    matches: /^pnpm-(lock|workspace)\.yaml$/,
    rule: 'keep the local deletion: this fork manages dependencies with bun',
  },
  {
    matches: /^bun\.lock$/,
    rule: 'local-only file; resync with `bun install` after porting dependency bumps',
  },
  {
    matches: /^\.tool-versions$/,
    rule: 'take local (bun); port only the upstream Node version bump',
  },
  {
    matches: /^\.devcontainer\//,
    rule: 'take local (bun feature); port only the upstream Node version bump',
  },
  {
    matches: /^\.github\/workflows\//,
    rule: 'take the local workflow shape (bun steps); port Node/tool version bumps only',
  },
  {
    matches: /^package\.json$/,
    rule: 'take local scripts/tooling; port dependency version bumps, then `bun install`',
  },
  {
    matches: /^Changelog\.md$/,
    rule: 'move upstream entries into `v(Version Goes Here)` and run `bash scripts-workflow/group_platforms.sh`',
  },
  {
    matches: /^src\/locales\//,
    rule: 'accept, then `bun run i18n:format && bun run i18n:types`',
  },
  {
    matches: /^src\/types\/generated\//,
    rule: 'regenerate with `bun run i18n:types` instead of hand-merging',
  },
  {
    matches: /^(AGENTS|CLAUDE|GEMINI)\.md$|^CONTRIBUTING\.md$|^docs\//,
    rule: 'take local for fork-specific documentation; port upstream doc moves only when relevant',
  },
  {
    matches: /^scripts\//,
    rule: 'take local for toolchain scripts; prebuild/service-release stay upstream-shared, review those hunks',
  },
  {
    matches: /^(Cargo\.toml|Cargo\.lock|src-tauri\/Cargo\.(toml|lock))$/,
    rule: 'merge normally; run `cargo check`, targeted tests and clippy after resolution',
  },
  {
    matches: /^src-tauri\/src\//,
    rule: 'merge normally (Rust); run `cargo fmt --check`, `cargo check` and targeted tests',
  },
  {
    matches: /^src\/(?!locales\/|types\/generated\/)/,
    rule: 'merge normally; run typecheck, lint and the frontend test suite',
  },
  {
    matches: /^(\.oxlintrc\.json|\.oxfmtrc\.json|Makefile\.toml|knip\.json)$/,
    rule: 'local-only tooling config; keep local',
  },
]

const VERIFY_COMMANDS = [
  'bun install --frozen-lockfile',
  'bun run format:check && bun run lint && bun run typecheck',
  'bun run test && bun run perf:test',
  'bun run i18n:verify && bun run knip:check',
  'bun scripts/check-architecture.mjs listen emit invoke',
  'bun run check:bundle-budget && bun run hygiene',
  'cargo fmt --check',
  'cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings',
]

const fail = (message) => {
  log_error(`sync-dev: ${message}`)
  process.exit(1)
}

const insideWorkTree = gitResult('rev-parse', '--is-inside-work-tree')
if (!insideWorkTree.ok || insideWorkTree.stdout !== 'true') {
  fail('run this script from inside a git worktree')
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
const dirty = git('status', '--porcelain') !== ''

const upstreamCommitResult = gitResult(
  'rev-parse',
  '--verify',
  `${upstream}^{commit}`,
)
if (!upstreamCommitResult.ok) {
  fail(
    `upstream ref "${upstream}" is not available; fetch it first or pass --upstream`,
  )
}

if (shouldFetch) {
  const remote = upstream.includes('/') ? upstream.split('/')[0] : null
  if (!remote) {
    log_info(`skip fetch: "${upstream}" is not a remote-tracking ref`)
  } else {
    const fetched = gitResult('fetch', '--prune', remote)
    if (fetched.ok) log_success(`fetched ${remote}`)
    else
      log_error(`fetch ${remote} failed: ${fetched.stderr || fetched.message}`)
  }
}

const upstreamCommit = git('rev-parse', '--short', upstream)
const logResult = gitResult(
  'log',
  '--reverse',
  '--format=%H%x1f%ct%x1f%s',
  `HEAD..${upstream}`,
)
const commits = logResult.stdout
  ? logResult.stdout.split('\n').map((line) => {
      const [hash, timestamp, subject] = line.split('\x1f')
      return { hash, timestamp: Number(timestamp), subject }
    })
  : []

const filesOfCommit = (hash) => {
  const changed = gitResult(
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '-r',
    hash,
  )
  if (!changed.stdout) return []
  return changed.stdout
    .split('\n')
    .map((line) => {
      const [status, ...paths] = line.split('\t')
      return {
        status,
        path: paths.length === 1 ? paths[0] : paths.join(' -> '),
      }
    })
    .filter((file) => file.path)
}

const changedFiles = new Set()
for (const commit of commits) {
  commit.files = filesOfCommit(commit.hash)
  for (const file of commit.files) changedFiles.add(file.path)
}

let merge = { supported: true, conflicts: [], reason: '' }
if (commits.length > 0) {
  const mergeResult = gitResult(
    'merge-tree',
    '--write-tree',
    '--name-only',
    'HEAD',
    upstream,
  )
  if (mergeResult.stdout) {
    // `<tree OID>\n<conflicted path>...\n\n<informational messages>`
    const lines = mergeResult.stdout.split('\n')
    for (const line of lines.slice(1)) {
      if (line === '') break
      merge.conflicts.push(line)
      changedFiles.add(line)
    }
  } else {
    merge = {
      supported: false,
      conflicts: [],
      reason: `${mergeResult.stderr || mergeResult.message} (git merge-tree --write-tree needs git >= 2.38)`,
    }
  }
}

const rules = []
for (const rule of RESOLUTION_RULES) {
  const files = [...changedFiles]
    .filter((file) => rule.matches.test(file))
    .sort()
  if (files.length > 0) rules.push({ ...rule, files })
}

const report = {
  branch,
  dirty,
  upstream,
  upstreamCommit,
  commits: commits.map((commit) => ({
    hash: commit.hash.slice(0, 8),
    date: new Date(commit.timestamp * 1000).toISOString().slice(0, 10),
    subject: commit.subject,
    files: commit.files.map((file) => `${file.status} ${file.path}`),
  })),
  merge,
  rules: rules.map((rule) => ({ rule: rule.rule, files: rule.files })),
  verify: VERIFY_COMMANDS,
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const short = (values, limit) =>
  values.length <= limit
    ? values
    : [...values.slice(0, limit), `… +${values.length - limit} more`]

console.log('')
log_info(
  `sync-dev: ${branch} <- ${upstream} @ ${upstreamCommit}${dirty ? ' (dirty worktree!)' : ''}`,
)

if (dirty) {
  log_error('working tree is dirty — commit or stash changes before merging')
}

if (commits.length === 0) {
  log_success(
    'upstream has no commits missing from this branch; nothing to sync',
  )
  process.exit(0)
}

console.log('')
log_info(`${commits.length} commit(s) to evaluate`)
for (const commit of commits) {
  console.log(
    `\n  ${commit.hash.slice(0, 8)}  ${new Date(commit.timestamp * 1000).toISOString().slice(0, 10)}  ${commit.subject}`,
  )
  for (const line of short(
    commit.files.map((file) => `${file.status}\t${file.path}`),
    12,
  )) {
    console.log(`      ${line}`)
  }
}

console.log('')
if (!merge.supported) {
  log_error(`merge simulation unavailable: ${merge.reason}`)
} else if (merge.conflicts.length === 0) {
  log_success('merge forecast: no conflicts')
} else {
  log_info(`merge forecast: ${merge.conflicts.length} conflict(s)`)
  for (const conflict of short(merge.conflicts, 30))
    console.log(`      ${conflict}`)
}

if (rules.length > 0) {
  console.log('')
  log_info('resolution rules for the diverged files')
  for (const rule of rules) {
    console.log(`\n  ${rule.rule}`)
    for (const file of short(rule.files, 5)) console.log(`      ${file}`)
  }
}

console.log('')
log_info('verify after resolving')
for (const command of VERIFY_COMMANDS) console.log(`      ${command}`)
console.log('')
console.log('see docs/upstream-sync.md for the full procedure')
