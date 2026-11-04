import { createSerialQueue } from '@/shared/utils/serial';
import { localKv } from '@/shared/storage/kv';
import { isRecord } from '@/shared/utils/guards';
import { FREQUENCIES } from './model';
import { keys } from '@/shared/storage/keys';
import { DASHBOARD_CHARTS, DEFAULT_SETTINGS, type DashboardChart, type Frequency, type Settings } from '@/shared/types';

/** Réglages enregistrés, nettoyés : une valeur absente ou invalide reprend sa valeur par défaut. */
export async function loadSettings(): Promise<Settings> {
  const stored = await localKv.get<unknown>(keys.settings);
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(stored) };
}

/** Ne garde que les réglages connus, avec le bon type (toute autre valeur est ignorée). */
export function sanitizeSettings(raw: unknown): Partial<Settings> {
  const clean: Partial<Settings> = {};
  if (!isRecord(raw)) return clean;
  const patch = raw;
  if (FREQUENCIES.includes(patch.frequencyHours as Frequency)) clean.frequencyHours = patch.frequencyHours as Frequency;
  for (const key of ['trackFollowing', 'badge', 'notifications'] as const) {
    const value = patch[key];
    if (typeof value === 'boolean') clean[key] = value;
  }
  if (Array.isArray(patch.hiddenCharts)) {
    clean.hiddenCharts = DASHBOARD_CHARTS.filter((c) => (patch.hiddenCharts as unknown[]).includes(c as DashboardChart));
  }
  return clean;
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
