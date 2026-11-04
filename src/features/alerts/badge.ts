import { createSerialQueue } from '@/shared/utils/serial';
import type { AccountsMap } from '@/features/accounts/model';
import { loadAccounts } from '@/features/accounts/repository';
import { unseenCountsByAccount } from '@/features/events/unseen';
import { loadSettings } from '@/features/settings/repository';
import { loadProgresses } from '@/features/followers-sync/repository';
import { loadStatus } from '@/features/scheduler/status';
import { t } from '@/shared/i18n';
import { COLORS } from '@/shared/ui/tokens';
import { formatBadgeCount } from '@/shared/utils/format';

/**
 * Icône et badge (§ 3.1) : au calme, alerte, scan en cours, déconnecté.
 * Le badge compte les départs non vus, tous comptes confondus.
 */

const iconSet = (dir: string) => ({
  16: `/${dir}/16.png`,
  32: `/${dir}/32.png`,
  48: `/${dir}/48.png`,
  128: `/${dir}/128.png`,
});

/** Total affiché par le badge : départs non vus et départs repérés pas encore identifiés. */
async function totalUnseen(accounts: AccountsMap): Promise<number> {
  const counts = await unseenCountsByAccount(Object.values(accounts));
  return Object.values(accounts).reduce((sum, a) => sum + (counts[a.id] ?? 0) + (a.pending?.count ?? 0), 0);
}

async function anyScanRunning(accountIds: string[]): Promise<boolean> {
  const progresses = await loadProgresses(accountIds);
  return progresses.some(
    (p) => p?.status === 'running' || p?.pausedReason === 'needs-focus' || p?.pausedReason === 'rate-limit',
  );
}

// Les mises à jour s'exécutent l'une après l'autre : chacune relit l'état au moment où elle
// passe, si bien que la dernière demandée gagne toujours (pas d'icône « au calme » qui
// écraserait l'icône « scan en cours » en finissant après elle).
const updates = createSerialQueue();
export const refreshBadge = (): Promise<void> => updates.run(applyBadge);

async function applyBadge(): Promise<void> {
  const [accounts, settings, status] = await Promise.all([
    loadAccounts(),
    loadSettings(),
    loadStatus(),
  ]);
  const disconnected = status?.session === 'disconnected';

  if (disconnected) {
    await chrome.action.setIcon({ path: iconSet('icon-off') });
    await chrome.action.setBadgeBackgroundColor({ color: COLORS.textSubtle });
    await chrome.action.setBadgeTextColor({ color: COLORS.surface });
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: t('common.badge.noSession') });
    return;
  }

  const scanning = await anyScanRunning(Object.keys(accounts));
  await chrome.action.setIcon({ path: iconSet(scanning ? 'icon-scan' : 'icon') });

  const unseen = settings.badge ? await totalUnseen(accounts) : 0;
  await chrome.action.setBadgeBackgroundColor({ color: COLORS.danger });
  await chrome.action.setBadgeTextColor({ color: COLORS.surface });
  await chrome.action.setBadgeText({ text: formatBadgeCount(unseen) });
  const state = scanning ? t('common.badge.scanning') : unseen ? t('common.badge.unseen', { count: unseen }) : undefined;
  await chrome.action.setTitle({ title: state ? t('common.badge.title', { parts: state }) : t('common.appName') });
}
