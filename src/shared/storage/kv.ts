/**
 * Accès clé/valeur au stockage Chrome.
 *
 * `syncKv` écrit dans `storage.sync` et bascule clé par clé sur `storage.local`
 * quand la sync est indisponible ou pleine (§ 5.3, « Repli »). Les lectures
 * cherchent d'abord en sync, puis en local.
 */

type Items = Record<string, unknown>;

export const localKv = {
  async get<T>(key: string): Promise<T | undefined> {
    const res = await chrome.storage.local.get(key);
    return res[key] as T | undefined;
  },
  async getMany(keys: string[]): Promise<Items> {
    if (keys.length === 0) return {};
    return chrome.storage.local.get(keys);
  },
  async set(items: Items): Promise<void> {
    await chrome.storage.local.set(items);
  },
  async remove(keys: string | string[]): Promise<void> {
    await chrome.storage.local.remove(keys);
  },
};

export const syncKv = {
  async get<T>(key: string): Promise<T | undefined> {
    const items = await syncKv.getMany([key]);
    return items[key] as T | undefined;
  },

  async getMany(keys: string[]): Promise<Items> {
    if (keys.length === 0) return {};
    let fromSync: Items = {};
    try {
      fromSync = await chrome.storage.sync.get(keys);
    } catch {
      // sync indisponible : on lit tout en local.
    }
    const missing = keys.filter((k) => !(k in fromSync));
    const fromLocal = missing.length ? await chrome.storage.local.get(missing) : {};
    return { ...fromLocal, ...fromSync };
  },

  /** Écrit en sync ; en cas d'échec (quota, sync coupée), écrit en local. */
  async set(items: Items): Promise<'sync' | 'local'> {
    const keys = Object.keys(items);
    if (keys.length === 0) return 'sync';
    try {
      await chrome.storage.sync.set(items);
      // Évite qu'une ancienne copie locale masque la valeur synchronisée.
      await chrome.storage.local.remove(keys);
      return 'sync';
    } catch {
      await chrome.storage.local.set(items);
      await chrome.storage.sync.remove(keys).catch(() => undefined);
      return 'local';
    }
  },

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await Promise.all([
      chrome.storage.sync.remove(keys).catch(() => undefined),
      chrome.storage.local.remove(keys),
    ]);
  },

  async bytesInUse(): Promise<number> {
    try {
      return await chrome.storage.sync.getBytesInUse(null);
    } catch {
      return 0;
    }
  },
};

/** Abonnement aux changements des deux zones, filtré par prédicat de clé. */
export function onStorageChange(match: (key: string) => boolean, cb: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync' && area !== 'local') return;
    if (Object.keys(changes).some(match)) cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export const SYNC_QUOTA_BYTES = 102_400;
export const SYNC_QUOTA_BYTES_PER_ITEM = 8_192;
