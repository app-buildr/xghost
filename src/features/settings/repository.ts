import { syncKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import { DEFAULT_SETTINGS, type Frequency, type Settings } from '@/shared/types';

export async function loadSettings(): Promise<Settings> {
  const stored = await syncKv.get<Partial<Settings>>(keys.settings);
  return { ...DEFAULT_SETTINGS, ...stored };
}

const FREQUENCIES: readonly Frequency[] = [1, 6, 12, 24];

/** Ne garde que les réglages connus, avec le bon type. */
function sanitize(patch: Partial<Settings>): Partial<Settings> {
  const clean: Partial<Settings> = {};
  if (FREQUENCIES.includes(patch.frequencyHours as Frequency)) clean.frequencyHours = patch.frequencyHours;
  for (const key of ['trackFollowing', 'badge', 'notifications', 'ignoreSuspended'] as const) {
    if (typeof patch[key] === 'boolean') clean[key] = patch[key];
  }
  return clean;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...sanitize(patch) };
  await syncKv.set({ [keys.settings]: next });
  return next;
}
