import { loadSettings } from '@/features/settings/repository';
import { t } from '@/shared/i18n';
import { formatList } from '@/shared/utils/format';
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
    title: single
      ? t('common.notifications.departureOne', { handle: first.handle, account: accountHandle })
      : t('common.notifications.departureMany', { count: departures.length, account: accountHandle }),
    message: single
      ? t('common.notifications.detectedNow')
      : rest > 0
        ? t('common.notifications.andOthers', { list: shown.join(t('format.listSeparator')), count: rest })
        : formatList(shown),
    priority: 1,
  });
}

/** Nouveau compte X détecté (son @handle n'est pas encore connu à ce moment-là). */
export async function notifyAccountAdded(): Promise<void> {
  await chrome.notifications.create(`account:${Date.now()}`, {
    type: 'basic',
    iconUrl: ICON,
    title: t('common.notifications.accountAddedTitle'),
    message: t('common.notifications.accountAddedText'),
    priority: 0,
  });
}

export function onNotificationClick(open: () => void): void {
  chrome.notifications.onClicked.addListener((id) => {
    void chrome.notifications.clear(id);
    open();
  });
}
