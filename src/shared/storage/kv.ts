/**
 * Accès clé/valeur au stockage local de Chrome (seule zone utilisée : la synchronisation
 * Chrome est trop petite pour l'historique ; l'export/import de sauvegarde la remplace).
 */

type Items = Record<string, unknown>;

/**
 * Les grosses valeurs (historique, profils, scan en cours) sont stockées en texte JSON : Chrome
 * sérialise un objet imbriqué 3 à 5 fois plus lentement qu'une chaîne. Une valeur écrite avant ce
 * format, ou restaurée d'une sauvegarde, reste un objet : les deux formats sont lus.
 */
export const decodeStored = (value: unknown): unknown => (typeof value === 'string' ? (JSON.parse(value) as unknown) : value);
export const encodeStored = (value: unknown): string => JSON.stringify(value);

export const localKv = {
  async get<T>(key: string): Promise<T | undefined> {
    const res = await chrome.storage.local.get(key);
    return res[key] as T | undefined;
  },
  /** Grosse valeur (voir `encodeStored`). Un texte illisible lève une erreur : rien n'est réécrit par-dessus. */
  async getLarge<T>(key: string): Promise<T | undefined> {
    return decodeStored((await chrome.storage.local.get(key))[key]) as T | undefined;
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
