import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import type { TranslationResources } from '@/types/generated/i18n-resources'

export const supportedLanguages = [
  'en',
  'ru',
  'zh',
  'fa',
  'tt',
  'id',
  'ar',
  'ko',
  'tr',
  'de',
  'es',
  'jp',
  'zhtw',
  'pt',
]

export const FALLBACK_LANGUAGE = 'zh'
const LANGUAGE_STORAGE_KEY = 'verge-language'

const normalizeLanguage = (language?: string) =>
  language?.toLowerCase().replace(/_/g, '-')

/**
 * Bundles whose ISO code or script does not match the shipped locale folder.
 * Checked before the generic base-language fallback so `ja-JP` never degrades
 * to `zh` and traditional Chinese variants keep traditional glyphs.
 */
const resolveLanguageAlias = (normalized: string) => {
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'jp'

  const traditionalChinese = ['zh-hant', 'zh-hk', 'zh-mo']
  if (
    traditionalChinese.some(
      (alias) => normalized === alias || normalized.startsWith(`${alias}-`),
    )
  ) {
    return 'zhtw'
  }

  return undefined
}

export const resolveLanguage = (language?: string) => {
  const normalized = normalizeLanguage(language)
  if (!normalized) {
    return FALLBACK_LANGUAGE
  }

  if (normalized === 'zh-tw') return 'zhtw'
  if (normalized === 'zh-cn') return 'zh'

  if (supportedLanguages.includes(normalized)) {
    return normalized
  }

  const alias = resolveLanguageAlias(normalized)
  if (alias) return alias

  const baseLanguage = normalized.split('-')[0]
  if (supportedLanguages.includes(baseLanguage)) {
    return baseLanguage
  }

  return FALLBACK_LANGUAGE
}

const getLanguageStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const cacheLanguage = (language: string) => {
  const storage = getLanguageStorage()
  if (!storage) return

  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, resolveLanguage(language))
  } catch (error) {
    console.warn('[i18n] Failed to cache language:', error)
  }
}

export const getCachedLanguage = () => {
  const storage = getLanguageStorage()
  if (!storage) return undefined

  try {
    const cached = storage.getItem(LANGUAGE_STORAGE_KEY)
    return cached ? resolveLanguage(cached) : undefined
  } catch (error) {
    console.warn('[i18n] Failed to read cached language:', error)
    return undefined
  }
}

type LocaleModule = {
  default: Record<string, unknown>
}

/** Top-level section names of the bundled `src/locales/<lng>/*.json` files. */
export type LanguageSection = keyof TranslationResources['translation']

/**
 * Sections the first render needs: `layout` and `shared` back the app shell and
 * the base components, `settings` carries the notice/error strings
 * `handleNotice` can fire from anywhere, and the home screen is rendered
 * eagerly, so `home` plus the sections its cards cross-link into stay here too:
 * `current-proxy-card` renders `proxies.*` tooltips, `home-profile-card`
 * renders `profiles.*` in its empty state and `test-card` renders `tests.*`.
 * Sections only reachable from a split page are awaited by that page's route —
 * see `PAGE_LANGUAGE_SECTIONS` in `src/app/route-pages.ts`.
 */
const STARTUP_LANGUAGE_SECTIONS = [
  'layout',
  'home',
  'shared',
  'settings',
  'profiles',
  'proxies',
  'tests',
] as const

const localeModules = import.meta.glob<LocaleModule>('@/locales/*/*.json')

const localeLoaders = Object.entries(localeModules).reduce<
  Record<string, Record<string, () => Promise<LocaleModule>>>
>((acc, [path, loader]) => {
  const match = path.match(/[/\\]locales[/\\]([^/\\]+)[/\\]([^/\\]+)\.json$/)
  if (match) {
    const [, language, section] = match
    acc[language] ??= {}
    acc[language][section] = loader
  }
  return acc
}, {})

const loadLanguageSections = async (
  language: string,
  sections: readonly string[],
) => {
  try {
    const entries = await Promise.all(
      sections.map(async (section) => {
        const loader = localeLoaders[language]?.[section]
        if (!loader) {
          throw new Error(
            `Locale loader not found for language "${language}" section "${section}"`,
          )
        }

        const module = await loader()
        return [section, module.default] as const
      }),
    )

    return Object.fromEntries(entries)
  } catch (error) {
    if (language !== FALLBACK_LANGUAGE) {
      console.warn(
        `Failed to load language ${language}, fallback to ${FALLBACK_LANGUAGE}, ${error}`,
      )
      return loadLanguageSections(FALLBACK_LANGUAGE, sections)
    }
    throw error
  }
}

const getLoadedLanguageSections = (language: string) =>
  Object.keys(i18n.getResourceBundle(language, 'translation') ?? {})

i18n.use(initReactI18next).init({
  resources: {},
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
})

/**
 * In-flight section bundles, so concurrent callers (a hover preload racing the
 * navigation that follows it) share one import per language and section.
 */
const pendingLanguageSections = new Map<string, Promise<void>>()

const loadLanguageSection = (language: string, section: string) => {
  const key = `${language}:${section}`
  const pending = pendingLanguageSections.get(key)
  if (pending) {
    return pending
  }

  const promise = loadLanguageSections(language, [section])
    .then((resources) => {
      i18n.addResourceBundle(language, 'translation', resources, true, true)
    })
    .finally(() => {
      pendingLanguageSections.delete(key)
    })

  pendingLanguageSections.set(key, promise)
  return promise
}

/**
 * Makes `sections` available for `language`, loading only the ones that are not
 * resident yet.
 */
export const ensureLanguageSections = async (
  sections: string | readonly string[],
  language: string = i18n.language || FALLBACK_LANGUAGE,
) => {
  const targetLanguage = resolveLanguage(language)
  const sectionList = Array.isArray(sections) ? sections : [sections]
  const loadedSections = new Set(getLoadedLanguageSections(targetLanguage))
  const missingSections = [...new Set(sectionList)].filter(
    (section) => !loadedSections.has(section),
  )

  if (!missingSections.length) {
    return
  }

  await Promise.all(
    missingSections.map((section) =>
      loadLanguageSection(targetLanguage, section),
    ),
  )
}

export const changeLanguage = async (language: string) => {
  const targetLanguage = resolveLanguage(language)
  const loadedSections = getLoadedLanguageSections(
    i18n.language || FALLBACK_LANGUAGE,
  )

  await ensureLanguageSections(
    [...new Set([...loadedSections, ...STARTUP_LANGUAGE_SECTIONS])],
    targetLanguage,
  )

  await i18n.changeLanguage(targetLanguage)
  cacheLanguage(targetLanguage)
}

export const initializeLanguage = async (
  initialLanguage: string = FALLBACK_LANGUAGE,
) => {
  await changeLanguage(initialLanguage)
}
