import type { ScanJob, TrackedAccount } from '@/shared/types';
import { t } from '@/shared/i18n';
import { formatTime } from '@/shared/utils/format';

/** Textes d'état du scan, partagés par l'overlay, l'onboarding, la popup et le tableau de bord. */

export const scanTabHint = () => t('common.scan.tabHint');
export const rateLimitTitle = () => t('common.scan.rateLimitTitle');
export const rateLimitText = () => t('common.scan.rateLimitText');
export const stallText = () => t('common.scan.stallText');

/** Message d'un scan en pause, quelle qu'en soit la raison (phrases complètes, avec ou sans heure). */
export function pauseMessage(
  p: Pick<ScanJob, 'pausedReason' | 'resumeAt' | 'error'>,
  account?: Pick<TrackedAccount, 'handle'>,
): string {
  const time = p.resumeAt ? formatTime(p.resumeAt) : undefined;
  switch (p.pausedReason) {
    case 'rate-limit':
      return time ? t('common.scan.pause.rateLimitAt', { time }) : t('common.scan.pause.rateLimit');
    case 'needs-focus':
      return stallText();
    case 'disconnected':
      return t('common.scan.pause.disconnected');
    case 'account-switched':
      return t('common.scan.pause.accountSwitched', { handle: account?.handle ?? '…' });
    default:
      if (p.error) {
        return time
          ? t('common.scan.pause.errorDetailAt', { detail: p.error, time })
          : t('common.scan.pause.errorDetail', { detail: p.error });
      }
      return time ? t('common.scan.pause.errorAt', { time }) : t('common.scan.pause.error');
  }
}
