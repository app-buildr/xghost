import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import { RELEASES_URL, UPDATE_CHECK_MINUTES } from './config';
import { parseVersion } from './version';

/**
 * Simulation pour tester l'alerte : `FAKE_LATEST_VERSION=9.9.9 npm run build` fait passer
 * cette version pour la dernière release. Vide dans un build normal.
 */
declare const __FAKE_LATEST_VERSION__: string;

export const ALARM_UPDATE = 'xg:update-check';

/**
 * Relève la dernière version publiée sur GitHub (service worker).
 * Hors ligne ou réponse illisible : la version déjà relevée reste.
 * Aucune release publiée (404) : rien à signaler.
 */
export async function checkLatestVersion(): Promise<void> {
  const fake = parseVersion(__FAKE_LATEST_VERSION__);
  if (fake) return localKv.set({ [keys.latestVersion]: fake });
  let body: unknown;
  try {
    const response = await fetch(RELEASES_URL, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
    if (response.status === 404) return localKv.remove(keys.latestVersion);
    if (!response.ok) return;
    body = await response.json();
  } catch {
    return;
  }
  const latest = parseVersion((body as { tag_name?: unknown } | null)?.tag_name);
  if (latest) await localKv.set({ [keys.latestVersion]: latest });
}

/** Vérification au démarrage, puis toutes les quelques heures. */
export async function scheduleUpdateChecks(): Promise<void> {
  if (!(await chrome.alarms.get(ALARM_UPDATE))) {
    await chrome.alarms.create(ALARM_UPDATE, { periodInMinutes: UPDATE_CHECK_MINUTES });
  }
  await checkLatestVersion();
}
