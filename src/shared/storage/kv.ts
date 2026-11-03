/**
 * Accès clé/valeur au stockage local de Chrome (seule zone utilisée : la synchronisation
 * Chrome est trop petite pour l'historique ; l'export/import de sauvegarde la remplace).
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

/** Abonnement aux changements du stockage, filtré par prédicat de clé. */
export function onStorageChange(match: (key: string) => boolean, cb: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some(match)) cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
