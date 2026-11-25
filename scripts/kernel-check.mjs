/**
 * Mihomo kernel version check.
 *
 * Compares the upstream MetaCubeX releases with the version recorded in
 * `docs/kernel-versions.json` (the baseline this branch was validated with)
 * and, when the local sidecars exist, with the binaries currently on disk.
 *
 * Usage:
 *   bun scripts/kernel-check.mjs [--json] [--fail-on-update] [--fail-on-drift]
 *                               [--no-local]
 *
 * Exit codes: 0 current, 1 update/drift found while a --fail-* flag is set,
 * 2 the upstream versions could not be fetched.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { HttpsProxyAgent } from 'https-proxy-agent'

const ROOT = path.resolve(import.meta.dirname, '..')
const BASELINE_FILE = path.join(ROOT, 'docs', 'kernel-versions.json')
const SIDECAR_DIR = path.join(ROOT, 'src-tauri', 'sidecar')

const STABLE_VERSION_URL =
  'https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt'
const ALPHA_VERSION_URL =
  'https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt'

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)
const asJson = hasFlag('--json')
const failOnUpdate = hasFlag('--fail-on-update')
const failOnDrift = hasFlag('--fail-on-drift')
const checkLocal = !hasFlag('--no-local')

const proxy =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy
const proxyOptions = proxy ? { agent: new HttpsProxyAgent(proxy) } : {}

const fetchText = async (url) => {
  const response = await fetch(url, {
    ...proxyOptions,
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return (await response.text()).trim()
}

/** Reads the version recorded in docs/kernel-versions.json. */
const readBaseline = () => {
  const parsed = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  if (typeof parsed.stable !== 'string' || typeof parsed.alpha !== 'string') {
    throw new Error(`${BASELINE_FILE} is missing stable/alpha versions`)
  }
  return parsed
}

/** Best-effort host triple for naming the bundled sidecar binaries. */
const hostTriple = () => {
  try {
    const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    const match = output.match(/^host:\s*(\S+)$/m)
    if (match) return match[1]
  } catch {
    // Fall back to the current platform/arch below.
  }

  const arch = process.arch === 'x64' ? 'x86_64' : process.arch
  const platforms = {
    darwin: { x86_64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
    linux: {
      x86_64: 'x86_64-unknown-linux-gnu',
      arm64: 'aarch64-unknown-linux-gnu',
      arm: 'armv7-unknown-linux-gnueabihf',
    },
    win32: {
      x86_64: 'x86_64-pc-windows-msvc',
      arm64: 'aarch64-pc-windows-msvc',
    },
  }
  return (
    platforms[process.platform]?.[arch] ?? `${arch}-unknown-${process.platform}`
  )
}

const sidecarVersion = (name, triple) => {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const binary = path.join(SIDECAR_DIR, `${name}-${triple}${suffix}`)
  if (!existsSync(binary)) return null
  try {
    const output = execFileSync(binary, ['-v'], { encoding: 'utf8' })
    const firstLine = output
      .split('\n')
      .find((line) => line.trim())
      ?.trim()
    return firstLine ?? null
  } catch {
    return null
  }
}

const extractVersion = (line, channel) => {
  if (!line) return null
  const pattern = channel === 'alpha' ? /alpha-[0-9a-f]+/ : /\bv\d+\.\d+\.\d+\b/
  return line.match(pattern)?.[0] ?? null
}

const format = (label, value) => `${label}: ${value}`

const main = async () => {
  let baseline
  try {
    baseline = readBaseline()
  } catch (error) {
    console.error(`[kernel] cannot read baseline: ${error.message}`)
    process.exit(2)
  }

  let latest
  try {
    const [stable, alpha] = await Promise.all([
      fetchText(STABLE_VERSION_URL),
      fetchText(ALPHA_VERSION_URL),
    ])
    latest = { stable, alpha }
  } catch (error) {
    console.error(`[kernel] cannot fetch upstream versions: ${error.message}`)
    process.exit(2)
  }

  const triple = hostTriple()
  const local = checkLocal
    ? {
        stable: sidecarVersion('verge-mihomo', triple),
        alpha: sidecarVersion('verge-mihomo-alpha', triple),
      }
    : null

  const update = {
    stable: latest.stable !== baseline.stable,
    alpha: latest.alpha !== baseline.alpha,
  }
  const drift = local
    ? {
        stable:
          local.stable !== null &&
          extractVersion(local.stable, 'stable') !== baseline.stable,
        alpha:
          local.alpha !== null &&
          extractVersion(local.alpha, 'alpha') !== baseline.alpha,
      }
    : null

  const updateAvailable = update.stable || update.alpha
  const localDrift = Boolean(drift?.stable || drift?.alpha)
  const status = updateAvailable
    ? 'update-available'
    : localDrift
      ? 'local-drift'
      : 'ok'

  const report = {
    status,
    latest,
    baseline: {
      stable: baseline.stable,
      alpha: baseline.alpha,
      recordedAt: baseline.recordedAt ?? null,
    },
    local: local
      ? {
          stable: local.stable,
          alpha: local.alpha,
          triple,
        }
      : null,
    updateAvailable,
    update,
    localDrift,
    drift,
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('')
    console.log(
      `[kernel] latest   ${format('stable', latest.stable)}  ${format('alpha', latest.alpha)}`,
    )
    console.log(
      `[kernel] baseline ${format('stable', baseline.stable)}  ${format('alpha', baseline.alpha)}${
        baseline.recordedAt ? `  (recorded ${baseline.recordedAt})` : ''
      }`,
    )
    if (local) {
      console.log(
        `[kernel] local    stable=${local.stable ?? `not downloaded (${triple})`}  alpha=${local.alpha ?? 'not downloaded'}`,
      )
    }
    if (updateAvailable) {
      console.log('')
      console.log('[kernel] an upstream kernel update is available:')
      if (update.stable)
        console.log(`  - stable ${baseline.stable} -> ${latest.stable}`)
      if (update.alpha)
        console.log(`  - alpha  ${baseline.alpha} -> ${latest.alpha}`)
      console.log(
        '  run `bun run prebuild:download --force`, verify the binaries, then update docs/kernel-versions.json',
      )
    } else {
      console.log('')
      console.log(
        '[kernel] the recorded baseline matches the latest upstream releases',
      )
    }
    if (local && localDrift) {
      console.log('')
      console.log('[kernel] local sidecars do not match the recorded baseline:')
      if (drift.stable) console.log(`  - stable: ${local.stable}`)
      if (drift.alpha) console.log(`  - alpha:  ${local.alpha}`)
      console.log('  run `bun run prebuild:download --force` to refresh them')
    }
  }

  if ((failOnUpdate && updateAvailable) || (failOnDrift && localDrift)) {
    process.exit(1)
  }
}

await main()
