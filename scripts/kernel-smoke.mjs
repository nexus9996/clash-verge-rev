/**
 * Kernel config smoke test for the bundled Mihomo sidecar.
 *
 * Runs `verge-mihomo -t` (configuration test only, no listeners or TUN device)
 * against a minimal config that carries the TUN block and every `dns-mode`
 * value the GUI can write. This catches sidecar/config-serialization breakage
 * after a kernel or enhancer change without starting the app or touching the
 * network.
 *
 * Note: mihomo ignores unknown YAML fields, so a passing run proves the config
 * parses and the kernel initializes — for `dns-mode` support itself rely on the
 * upstream release notes and the version gate in the TUN dialog.
 *
 * Usage:
 *   bun scripts/kernel-smoke.mjs [--json]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SIDECAR_DIR = path.join(ROOT, 'src-tauri', 'sidecar')
const asJson = process.argv.includes('--json')

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

const sidecar = () => {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const binary = path.join(SIDECAR_DIR, `verge-mihomo-${hostTriple()}${suffix}`)
  if (!existsSync(binary)) {
    console.error(
      `[kernel-smoke] sidecar not found at ${path.relative(ROOT, binary)}; run \`bun run prebuild:download\``,
    )
    process.exit(2)
  }
  return binary
}

const CONFIG_HEADER = `mixed-port: 17890
allow-lan: false
mode: rule
log-level: info
ipv6: false
dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - 1.1.1.1
proxies: []
rules:
  - MATCH,DIRECT
tun:
  enable: false
  stack: gvisor
  device: Mihomo
  auto-route: false
  auto-detect-interface: false
  dns-hijack:
    - any:53
`

const CASES = [
  { name: 'legacy config without dns-mode', tun: '' },
  { name: 'dns-mode auto (empty string)', tun: '  dns-mode: ""\n' },
  { name: 'dns-mode native', tun: '  dns-mode: native\n' },
  { name: 'dns-mode disabled', tun: '  dns-mode: disabled\n' },
  { name: 'dns-mode hijack', tun: '  dns-mode: hijack\n' },
]

const binary = sidecar()
const dir = mkdtempSync(path.join(os.tmpdir(), 'mihomo-smoke-'))
const results = []

try {
  for (const testCase of CASES) {
    const configPath = path.join(dir, `${results.length}.yaml`)
    writeFileSync(configPath, CONFIG_HEADER + testCase.tun)
    const run = spawnSync(binary, ['-t', '-f', configPath, '-d', dir], {
      encoding: 'utf8',
      timeout: 30000,
    })
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
    const passed = run.status === 0 && /test is successful/i.test(output)
    results.push({
      name: testCase.name,
      passed,
      exitCode: run.status,
      tail: output.split('\n').slice(-2).join(' | '),
    })
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const failed = results.filter((result) => !result.passed)

if (asJson) {
  console.log(
    JSON.stringify(
      { binary: path.relative(ROOT, binary), results, failed: failed.length },
      null,
      2,
    ),
  )
} else {
  console.log(`[kernel-smoke] ${path.relative(ROOT, binary)}`)
  for (const result of results) {
    console.log(`  ${result.passed ? 'ok  ' : 'FAIL'}  ${result.name}`)
    if (!result.passed) console.log(`        ${result.tail}`)
  }
  console.log(
    failed.length === 0
      ? '[kernel-smoke] all TUN dns-mode config variants pass the kernel config test'
      : `[kernel-smoke] ${failed.length} variant(s) failed`,
  )
}

process.exit(failed.length === 0 ? 0 : 1)
