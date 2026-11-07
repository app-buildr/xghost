/** Langue fixée pour les tests : les textes attendus sont en français, quelle que soit la machine. */
(globalThis as unknown as { chrome: unknown }).chrome = { i18n: { getUILanguage: () => 'fr' } };
