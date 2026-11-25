import type { monaco as MonacoApi } from '@/services/monaco-editor'

type MonacoModule = typeof MonacoApi
type MonacoFullModule = typeof import('monaco-editor')
type MonacoEditorPackage = typeof import('@monaco-editor/react')

type MonacoEditorBundle = {
  Editor: MonacoEditorPackage['default']
  beforeEditorMount: () => void
}

let loadPromise: Promise<MonacoEditorBundle> | undefined
let monacoConfigured = false

const patchCreateWebWorker = (monaco: MonacoModule) => {
  const createWebWorker = monaco.editor.createWebWorker

  type CreateWebWorker = typeof createWebWorker
  type InternalWorkerOptions = Parameters<CreateWebWorker>[0]
  type LegacyWorkerOptions = Omit<InternalWorkerOptions, 'worker'> & {
    createData?: unknown
    label?: string
    moduleId?: string
  }

  monaco.editor.createWebWorker = ((
    options: InternalWorkerOptions | LegacyWorkerOptions,
  ) => {
    if ('worker' in options) return createWebWorker(options)

    const getWorker = self.MonacoEnvironment?.getWorker
    if (!getWorker) {
      throw new Error('MonacoEnvironment.getWorker is not configured')
    }

    const worker = Promise.resolve(
      getWorker('workerMain.js', options.label ?? 'monaco-editor-worker'),
    ).then((instance) => {
      instance.postMessage('ignore')
      instance.postMessage(options.createData)
      return instance
    })

    return createWebWorker({
      worker,
      host: options.host,
      keepIdleModels: options.keepIdleModels,
    })
  }) as CreateWebWorker
}

export const loadMonacoEditor = () => {
  loadPromise ??= Promise.all([
    import('@monaco-editor/react'),
    import('@/services/monaco-editor'),
    import('monaco-editor/editor/editor.worker?worker'),
    import('monaco-editor/language/css/css.worker?worker'),
    import('monaco-editor/language/typescript/ts.worker?worker'),
    import('monaco-editor/languages/features/json/json.worker?worker'),
    import('monaco-yaml'),
    import('meta-json-schema/schemas/meta-json-schema.json'),
    import('types-pac/pac.d.ts?raw'),
    import('@/utils/yaml.worker?worker'),
  ]).then(
    ([
      editorModule,
      slimMonaco,
      { default: EditorWorker },
      { default: CssWorker },
      { default: TsWorker },
      { default: JsonWorker },
      { configureMonacoYaml },
      { default: metaSchema },
      { default: pac },
      { default: YamlWorker },
    ]) => {
      const { monaco } = slimMonaco
      const workers = {
        css: CssWorker,
        less: CssWorker,
        scss: CssWorker,
        typescript: TsWorker,
        javascript: TsWorker,
        json: JsonWorker,
        jsonc: JsonWorker,
        yaml: YamlWorker,
      }

      self.MonacoEnvironment = {
        getWorker(_, label) {
          return new (workers[label as keyof typeof workers] ?? EditorWorker)()
        },
      }

      editorModule.loader.config({
        monaco: monaco as unknown as MonacoFullModule,
      })

      return {
        Editor: editorModule.default,
        beforeEditorMount: () => {
          if (monacoConfigured) return

          patchCreateWebWorker(monaco)
          slimMonaco.typescript.javascriptDefaults.addExtraLib(pac, 'pac.d.ts')

          configureMonacoYaml(monaco as unknown as MonacoFullModule, {
            validate: true,
            enableSchemaRequest: true,
            completion: true,
            schemas: [
              {
                uri: 'http://example.com/meta-json-schema.json',
                fileMatch: ['**/*.yaml', '**/*.yml'],
                schema:
                  metaSchema as unknown as import('monaco-yaml').JSONSchema,
              },
            ],
          })

          monacoConfigured = true
        },
      }
    },
  )

  return loadPromise
}
