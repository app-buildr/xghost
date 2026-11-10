/**
 * Faux `chrome` en mémoire pour les tests (stockage, alarmes, notifications, icône). Les valeurs
 * sont copiées à l'écriture et à la lecture, comme le ferait le vrai stockage.
 */

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

export interface FakeChrome {
  store: Map<string, unknown>;
  alarms: Map<string, { name: string; scheduledTime: number; periodInMinutes?: number }>;
  notifications: { id: string; options: unknown }[];
  /** Fait échouer la prochaine écriture (retour arrière d'un import…). */
  failNextSet: () => void;
  /** Onglets ouverts, commandes reçues par eux, cookies de session. */
  tabs: Map<number, { id: number; url: string; pinned?: boolean; active?: boolean }>;
  commands: { tabId: number; message: unknown }[];
  cookies: Map<string, string>;
  /** Réponse des onglets aux commandes (par défaut `{ ok: true }`). */
  reply: { value: unknown };
}

const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export function installFakeChrome(): FakeChrome {
  const store = new Map<string, unknown>();
  const alarms: FakeChrome['alarms'] = new Map();
  const notifications: FakeChrome['notifications'] = [];
  const listeners = new Set<Listener>();
  let failSet = false;
  const tabs: FakeChrome['tabs'] = new Map();
  const commands: FakeChrome['commands'] = [];
  const cookies: FakeChrome['cookies'] = new Map();
  const reply: FakeChrome['reply'] = { value: { ok: true } };
  let nextTab = 100;

  const local = {
    async get(keys?: string | string[] | null) {
      const wanted = keys === null || keys === undefined ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((k) => store.has(k)).map((k) => [k, copy(store.get(k))]));
    },
    async getKeys() {
      return [...store.keys()];
    },
    async set(items: Record<string, unknown>) {
      if (failSet) {
        failSet = false;
        throw new Error('write-refused');
      }
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: copy(store.get(k)), newValue: copy(v) };
        store.set(k, copy(v));
      }
      listeners.forEach((l) => l(changes, 'local'));
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };

  const action = Object.fromEntries(
    ['setIcon', 'setBadgeBackgroundColor', 'setBadgeTextColor', 'setBadgeText', 'setTitle'].map((m) => [m, async () => undefined]),
  );

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local,
      onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
    alarms: {
      async create(name: string, info: { when?: number; periodInMinutes?: number }) {
        alarms.set(name, { name, scheduledTime: info.when ?? Date.now(), periodInMinutes: info.periodInMinutes });
      },
      async clear(name: string) {
        return alarms.delete(name);
      },
      async get(name: string) {
        return alarms.get(name);
      },
    },
    notifications: {
      async create(id: string, options: unknown) {
        notifications.push({ id, options });
        return id;
      },
    },
    action,
    runtime: { id: 'test', getManifest: () => ({ version: '1.0.5' }), getURL: (p: string) => `chrome-extension://test${p}` },
    i18n: { getUILanguage: () => 'fr' },
    cookies: { get: async ({ name }: { name: string }) => (cookies.has(name) ? { value: cookies.get(name) } : null) },
    windows: { getLastFocused: async () => ({ id: 1 }), update: async () => undefined },
    tabs: {
      async create({ url, pinned }: { url: string; pinned?: boolean }) {
        const tab = { id: nextTab++, url, pinned };
        tabs.set(tab.id, tab);
        return tab;
      },
      async get(id: number) {
        const tab = tabs.get(id);
        if (!tab) throw new Error('no-tab');
        return tab;
      },
      async update(id: number, patch: { url?: string }) {
        const tab = tabs.get(id);
        if (!tab) throw new Error('no-tab');
        if (patch.url) tab.url = patch.url;
        return tab;
      },
      async reload() {},
      async remove(id: number) {
        tabs.delete(id);
      },
      /** Filtres utilisés par l'extension : épinglé, affiché, adresses exactes. */
      async query(q: { pinned?: boolean; active?: boolean; url?: string[] } = {}) {
        return [...tabs.values()].filter(
          (t) =>
            (q.pinned === undefined || Boolean(t.pinned) === q.pinned) &&
            (q.active === undefined || Boolean(t.active) === q.active) &&
            (q.url === undefined || q.url.includes(t.url)),
        );
      },
      async sendMessage(tabId: number, message: unknown) {
        commands.push({ tabId, message });
        return reply.value;
      },
    },
  };

  return { store, alarms, notifications, failNextSet: () => (failSet = true), tabs, commands, cookies, reply };
}
