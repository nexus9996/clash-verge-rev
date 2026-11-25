// Enforces the frontend architecture boundaries.
//
// The lint config keeps the static-import half of the IPC boundary rules so
// editors surface violations; this gate owns the dynamic forms and the layer
// direction that oxlint cannot express.
import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')
const gates = process.argv.slice(2)
if (
  !gates.length ||
  gates.some((gate) => !['listen', 'emit', 'invoke'].includes(gate))
) {
  console.error('usage: check-architecture.mjs <gate>... (listen|emit|invoke)')
  process.exit(2)
}

const TAURI_CORE = '@tauri-apps/api/core'
const TAURI_EVENT = '@tauri-apps/api/event'
const EVENT_IMPORTS = new Set(['listen', 'emit', 'emitTo', 'once'])
const INVOKE_IMPORTS = new Set(['invoke'])
const BINDINGS_MODULE = /(^|\/)bindings(\.ts)?$/

// routes -> pages -> components/hooks -> services/config. Upward imports are
// rejected here and surfaced by the arch:check layers gate.
const ZONES = [
  { target: 'src/components', from: 'src/pages' },
  { target: 'src/components', from: 'src/routes' },
  { target: 'src/components', from: 'src/app' },
  { target: 'src/services', from: 'src/components' },
  { target: 'src/services', from: 'src/pages' },
  { target: 'src/services', from: 'src/routes' },
  { target: 'src/services', from: 'src/app' },
  { target: 'src/hooks', from: 'src/components' },
  { target: 'src/hooks', from: 'src/pages' },
  { target: 'src/hooks', from: 'src/routes' },
  { target: 'src/hooks', from: 'src/app' },
  { target: 'src/config', from: 'src/components' },
  { target: 'src/config', from: 'src/pages' },
  { target: 'src/config', from: 'src/routes' },
  { target: 'src/config', from: 'src/services' },
  { target: 'src/config', from: 'src/hooks' },
  { target: 'src/config', from: 'src/store' },
  { target: 'src/config', from: 'src/app' },
  { target: 'src/pages', from: 'src/routes' },
  { target: 'src/pages', from: 'src/app' },
  { target: 'src/routes', from: 'src/services' },
  { target: 'src/routes', from: 'src/store' },
  { target: 'src/routes', from: 'src/hooks' },
].map((zone) => ({
  target: path.join(ROOT, zone.target),
  from: path.join(ROOT, zone.from),
  source: zone,
}))

const violations = []

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function isWithin(file, directory) {
  return file === directory || file.startsWith(`${directory}${path.sep}`)
}

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts'))
    return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function sourceFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(entryPath)
      return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) &&
        entry.name !== 'routeTree.gen.ts'
        ? [entryPath]
        : []
    })
    .sort()
}

function namedImports(declaration) {
  const clause = declaration.importClause
  if (!clause || clause.isTypeOnly) return []
  const bindings = clause.namedBindings
  if (!bindings || !ts.isNamedImports(bindings)) return []
  return bindings.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => (element.propertyName ?? element.name).text)
}

function namedExports(declaration) {
  if (!declaration.exportClause || !ts.isNamedExports(declaration.exportClause))
    return []
  if (declaration.isTypeOnly) return []
  return declaration.exportClause.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => (element.propertyName ?? element.name).text)
}

function resolveModule(fromFile, specifier) {
  if (specifier.startsWith('@/')) return path.join(SRC, specifier.slice(2))
  if (specifier.startsWith('.'))
    return path.resolve(path.dirname(fromFile), specifier)
  if (specifier.startsWith('src/')) return path.join(ROOT, specifier.slice(4))
  return null
}

function lintFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  )
  const relative = toPosix(path.relative(ROOT, file))
  const allowEvents = relative.startsWith('src/services/bus/')
  const allowCommands =
    relative === 'src/services/cmds.ts' ||
    relative === 'src/services/bindings.ts'
  const allowInvoke = relative === 'src/services/bindings.ts'

  const report = (node, message) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line
    violations.push({ file: relative, line: line + 1, message })
  }

  const checkLayer = (node, specifier) => {
    const resolved = resolveModule(file, specifier)
    if (!resolved) return
    for (const zone of ZONES) {
      if (isWithin(file, zone.target) && isWithin(resolved, zone.from)) {
        report(
          node,
          `Import from '${specifier}' violates layer direction (${zone.source.target} must not import ${zone.source.from}).`,
        )
      }
    }
  }

  const checkStatic = (node, specifier, names, isTypeOnly) => {
    checkLayer(node, specifier)
    if (isTypeOnly) return
    if (specifier === TAURI_CORE && !allowInvoke) {
      for (const name of names) {
        if (INVOKE_IMPORTS.has(name)) {
          report(node, 'Invoke backend commands through services/cmds.')
        }
      }
    }
    if (specifier === TAURI_EVENT && !allowEvents) {
      for (const name of names) {
        if (EVENT_IMPORTS.has(name)) {
          report(
            node,
            'The event bus owns Tauri event subscriptions and emissions.',
          )
        }
      }
    }
    if (BINDINGS_MODULE.test(specifier) && !allowCommands) {
      for (const name of names) {
        if (name === 'commands') {
          report(
            node,
            'Only services/cmds may import generated command implementations.',
          )
        }
      }
    }
  }

  const checkDynamic = (node, specifier) => {
    checkLayer(node, specifier)
    if (specifier === TAURI_CORE && !allowInvoke) {
      report(
        node,
        'Use the owned IPC service boundary instead of dynamically importing Tauri APIs.',
      )
    }
    if (specifier === TAURI_EVENT && !allowEvents) {
      report(
        node,
        'Use the owned IPC service boundary instead of dynamically importing Tauri APIs.',
      )
    }
    if (BINDINGS_MODULE.test(specifier) && !allowCommands) {
      report(
        node,
        'Only services/cmds may load generated command implementations.',
      )
    }
  }

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkStatic(
        node,
        node.moduleSpecifier.text,
        namedImports(node),
        node.importClause?.isTypeOnly === true,
      )
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkStatic(
        node,
        node.moduleSpecifier.text,
        namedExports(node),
        node.isTypeOnly === true,
      )
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      checkDynamic(node, node.moduleReference.expression.text)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      checkDynamic(node, node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

for (const file of sourceFiles(SRC)) lintFile(file)

violations.sort(
  (left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line,
)
for (const violation of violations) {
  console.error(
    `[arch] ${violation.file}:${violation.line}: ${violation.message}`,
  )
}
if (violations.length) process.exitCode = 1
else console.log('[arch] no violations')
