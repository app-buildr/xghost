import { loadSettings } from '@/features/settings/repository';
import type { FollowEvent } from '@/shared/types';

/** Notifications système : une seule par vérification, groupée (§ 8, question 3). */

const ICON = '/icon/128.png';

export async function notifyDepartures(accountHandle: string, departures: FollowEvent[]): Promise<void> {
  if (departures.length === 0 || !(await loadSettings()).notifications) return;
  const [first] = departures;
  const single = departures.length === 1 && first;
  const shown = departures.slice(0, 5).map((d) => `@${d.handle}`);
  const rest = departures.length - shown.length;
  await chrome.notifications.create(`departures:${Date.now()}`, {
    type: 'basic',
    iconUrl: ICON,
    title: single ? `@${first.handle} ne suit plus @${accountHandle}` : `${departures.length} comptes ne suivent plus @${accountHandle}`,
    message: single ? 'Détecté à l’instant par xGhost.' : `${shown.join(', ')}${rest > 0 ? ` et ${rest} autre(s)` : ''}`,
    priority: 1,
  });
}

/** Nouveau compte X détecté (son @handle n'est pas encore connu à ce moment-là). */
export async function notifyAccountAdded(): Promise<void> {
  await chrome.notifications.create(`account:${Date.now()}`, {
    type: 'basic',
    iconUrl: ICON,
    title: 'Nouveau compte suivi',
    message: 'Un nouveau compte X est maintenant suivi par xGhost.',
    priority: 0,
  });
}

export function onNotificationClick(open: () => void): void {
  chrome.notifications.onClicked.addListener((id) => {
    chrome.notifications.clear(id);
    open();
  });
}
