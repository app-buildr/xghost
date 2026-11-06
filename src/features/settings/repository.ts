import { createSerialQueue } from '@/shared/utils/serial';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';
import { sanitizeSettings } from './sanitize';

/** Réglages enregistrés, nettoyés : une valeur absente ou invalide reprend sa valeur par défaut. */
export async function loadSettings(): Promise<Settings> {
  const stored = await localKv.get<unknown>(keys.settings);
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(stored) };
}

const writes = createSerialQueue();

/** Enregistre un changement de réglages, l'un après l'autre (deux changements rapprochés ne s'écrasent pas). */
export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return writes.run(async () => {
    const next = { ...(await loadSettings()), ...sanitizeSettings(patch) };
    await localKv.set({ [keys.settings]: next });
    return next;
  });
}
