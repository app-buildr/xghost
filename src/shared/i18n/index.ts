import { createInstance } from 'i18next';
import { en, fr } from './locales';

/** Langues de l'extension. L'anglais sert de repli pour toute autre langue du navigateur. */
const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Langue de l'interface du navigateur (service worker, pages, scripts de contenu). */
function browserLanguage(): string {
  try {
    return globalThis.chrome?.i18n?.getUILanguage?.() ?? globalThis.navigator?.language ?? 'en';
  } catch {
    return globalThis.navigator?.language ?? 'en';
  }
}

export function pickLanguage(tag: string): Language {
  const base = tag.toLowerCase().split(/[-_]/)[0];
  return (LANGUAGES as readonly string[]).includes(base ?? '') ? (base as Language) : 'en';
}

export const LANGUAGE: Language = pickLanguage(browserLanguage());

/** Locale des formats Intl (nombres, dates). */
export const LOCALE = LANGUAGE === 'fr' ? 'fr-FR' : 'en-US';

const resources = {
  fr: { translation: fr },
  en: { translation: en },
} as const;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof fr };
  }
}

/**
 * Instance commune au service worker, aux pages et aux scripts de contenu.
 * Initialisée de façon synchrone à l'import : les textes sont embarqués, rien à charger.
 */
const i18n = createInstance();
void i18n.init({
  lng: LANGUAGE,
  fallbackLng: 'en',
  resources,
  initAsync: false,
  // React échappe déjà le texte ; ailleurs les messages vont dans textContent, jamais en HTML.
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const t = i18n.t.bind(i18n) as typeof i18n.t;
