import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Build directement dans dist/, à côté de src/.
  outDir: 'dist',
  outDirTemplate: '',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    // Nom et description traduits par Chrome (public/_locales), anglais par défaut.
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // `chrome.runtime.getContexts` (ouverture des pages de l'extension).
    minimum_chrome_version: '116',
    // Défense en profondeur : les pages ne parlent qu'à elles-mêmes et aux images de X. Hors
    // production, WXT a besoin de son serveur de développement.
    ...(mode === 'production'
      ? {
          content_security_policy: {
            extension_pages:
              "script-src 'self'; object-src 'self'; img-src 'self' data: https://pbs.twimg.com https://abs.twimg.com; connect-src 'self'",
          },
        }
      : {}),
    permissions: [
      'storage',
      'unlimitedStorage',
      'alarms',
      'notifications',
      'cookies',
    ],
    // Lecture de la session X et des réponses de x.com dans l'onglet de scan.
    host_permissions: ['https://x.com/*'],
    // Logo de l'overlay et du favicon de l'onglet de scan.
    // URL dynamique (`use_dynamic_url`) : x.com ne peut pas tester la présence de l'extension.
    // Script isolé déclaré ici, sans le contexte de WXT (voir `entrypoints/x.ts`).
    content_scripts: [{ matches: ['https://x.com/*'], js: ['x.js'], run_at: 'document_start' }],
    web_accessible_resources: [{ resources: ['icon/128.png'], matches: ['https://x.com/*'], use_dynamic_url: true }],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: 'xGhost',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
      },
    },
  }),
});
