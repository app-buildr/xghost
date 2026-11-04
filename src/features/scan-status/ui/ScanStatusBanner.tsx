import { remainingLabel } from '@/features/followers-sync/estimate';
import type { ScanProgress } from '@/features/followers-sync/repository';
import { t } from '@/shared/i18n';
import type { GlobalStatus, TrackedAccount } from '@/shared/types';
import { ExternalLink } from '@/shared/ui/ExternalLink';
import { formatNumber, formatProgressCount } from '@/shared/utils/format';
import { X_LOGIN_URL } from '@/shared/x-urls';
import { pauseMessage, scanTabHint, stallText } from '../messages';
import { ScanProgressBar } from './ScanProgressBar';
import { ShowScanTabButton } from './ShowScanTabButton';
import { StopScanButton } from './StopScanButton';
import { useStartScan } from './useStartScan';

/** Bandeau d'état : session, scan en cours, pause (limite, onglet requis, autre compte). */
export function ScanStatusBanner({
  account,
  progress,
  status,
  now,
  compact = false,
}: {
  account?: TrackedAccount;
  progress?: ScanProgress;
  status?: GlobalStatus;
  now: number;
  compact?: boolean;
}) {
  const { start, busy } = useStartScan();
  if (status?.session === 'disconnected') {
    return (
      <div className="xg-banner xg-banner--warn" role="status">
        <span>{t('common.scanStatus.noSession')}</span>
        <ExternalLink className="xg-btn xg-btn--secondary" href={X_LOGIN_URL}>
          {t('common.openX')}
        </ExternalLink>
      </div>
    );
  }
  // Le contrôle léger dure quelques secondes, en arrière-plan : rien à afficher.
  const live = progress?.kind === 'quick' ? undefined : progress;

  if (!live && account?.pending) {
    const { count, full } = account.pending;
    return (
      <div className="xg-banner xg-banner--warn" role="status">
        <span>
          {count > 0
            ? t('common.scanStatus.pendingCount', { count, n: formatNumber(count) })
            : full
              ? t('common.scanStatus.pendingManyArrivals')
              : t('common.scanStatus.pendingFull')}
        </span>
        <button type="button" className="xg-btn xg-btn--primary" disabled={busy} onClick={() => void start({ full: true })}>
          {t('common.scanStatus.identify')}
        </button>
      </div>
    );
  }
  if (!live) return null;

  if (live.status === 'paused' && live.pausedReason === 'needs-focus' && account) {
    return (
      <div className="xg-banner xg-banner--warn" role="status">
        <span>{stallText()}</span>
        <span className="xg-banner__actions">
          <ShowScanTabButton accountId={account.id} />
          <StopScanButton accountId={account.id} />
        </span>
      </div>
    );
  }

  // Tableau de bord : la carte « Dernier scan » montre déjà l'état du scan (en cours, pause, blocage).
  if (!compact) return null;
  if (live.status === 'running') {
    const remaining = remainingLabel(live, now);
    return (
      <div className="xg-banner xg-banner--info xg-banner--stacked" role="status">
        <div className="xg-banner__row">
          <strong>
            {live.kind === 'baseline' ? t('common.scanStatus.baselineRunning') : t('common.scanStatus.checkRunning')}
          </strong>
          <span>{formatProgressCount(live.collected, live.expected)}</span>
        </div>
        <ScanProgressBar progress={live} />
        <span>
          {remaining
            ? t('common.scanStatus.hintWithRemaining', { hint: scanTabHint(), remaining })
            : scanTabHint()}
        </span>
      </div>
    );
  }

  return (
    <div className="xg-banner xg-banner--warn" role="status">
      <span>{pauseMessage(live, account)}</span>
    </div>
  );
}
