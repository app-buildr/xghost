import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  // Build directement dans dist/, à côté de src/.
  outDir: 'dist',
  outDirTemplate: '',
  modules: ['@wxt-dev/module-react'],
  // Simulation d'une release plus récente, voir features/updates/check.ts.
  vite: () => ({
    define: {
      __FAKE_LATEST_VERSION__: JSON.stringify(
        (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FAKE_LATEST_VERSION ?? '',
      ),
    },
  }),
  manifest: {
    name: 'xGhost',
    description: 'Détecte les comptes X qui ont arrêté de te suivre, et te prévient.',
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
