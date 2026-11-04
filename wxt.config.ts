import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Build directement dans dist/, à côté de src/.
  outDir: 'dist',
  outDirTemplate: '',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    // Nom et description traduits par Chrome (public/_locales), anglais par défaut.
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: [
      'storage',
      'unlimitedStorage',
      'alarms',
      'tabGroups',
      'notifications',
      'cookies',
    ],
    // Lecture de la session X et des réponses de x.com dans l'onglet de scan.
    host_permissions: ['https://x.com/*'],
    // Logo de l'overlay et du favicon de l'onglet de scan.
    // URL dynamique (`use_dynamic_url`) : x.com ne peut pas tester la présence de l'extension.
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
  },
});
