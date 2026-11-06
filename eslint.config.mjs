import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Fonctions qui écrivent les données : réservées au service worker (invariant du produit). */
const WRITERS = [
  { name: '@/features/accounts/repository', importNames: ['updateAccounts', 'patchAccount', 'setIgnored', 'setSelectedAccountId', 'selectAccount'] },
  { name: '@/features/events/repository', importNames: ['updateEvents', 'updateRemoved', 'refreshUnseen', 'forgetUnseen'] },
  {
    name: '@/features/followers-sync/repository',
    importNames: ['saveSnapshot', 'saveProfiles', 'recordTotal', 'savePartial', 'clearPartial', 'saveJob', 'saveProgressOnly', 'clearJob', 'deleteAccountData'],
  },
  { name: '@/features/settings/repository', importNames: ['saveSettings'] },
  { name: '@/features/scheduler/status', importNames: ['saveStatus'] },
].map((path) => ({ ...path, message: 'Les interfaces envoient un message : seul le service worker écrit.' }));

export default tseslint.config(
  { ignores: ['dist/', '.wxt/', 'node_modules/', 'resources/', 'release/', 'docs/', 'scripts/', '*.config.*', 'src/shared/i18n/no-hardcoded-text.test.ts', 'src/shared/manifest.test.ts', 'src/shared/ui/tokens.test.ts'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.base],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Le domaine est pur : ni navigateur, ni stockage, ni fonctionnalités.
    files: ['src/domain/**/*.ts'],
    ignores: ['src/domain/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'chrome', message: 'Le domaine ne touche pas au navigateur.' }],
      'no-restricted-imports': ['error', { patterns: [{ group: ['@/features/*', '@/shared/storage/*', '@/shared/messaging/*', '@/shared/i18n'], message: 'Le domaine ne dépend que des types et utilitaires.' }] }],
    },
  },
  {
    // `shared` ne connaît pas les fonctionnalités.
    files: ['src/shared/**/*.{ts,tsx}'],
    ignores: ['src/shared/**/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@/features/*', '@/domain/*'], message: '`shared` ne dépend pas des fonctionnalités.' }] }] },
  },
  {
    // Écrans : lecture du stockage et messages, jamais d'écriture.
    files: ['src/features/**/ui/**/*.{ts,tsx}', 'src/features/app-state/**/*.{ts,tsx}', 'src/entrypoints/{popup,options,onboarding}/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { paths: WRITERS }] },
  },
);
