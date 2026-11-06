import { remainingLabel } from '@/features/followers-sync/estimate';
import type { ScanProgress } from '@/features/followers-sync/model';
import { t } from '@/shared/i18n';
import type { GlobalStatus, TrackedAccount } from '@/shared/types';
import { ExternalLink } from '@/shared/ui/ExternalLink';
import { Banner } from '@/shared/ui/primitives';
import { formatNumber, formatProgressCount } from '@/shared/utils/format';
import { X_LOGIN_URL } from '@/shared/x-urls';
import { pauseMessage, scanTabHint, stallText } from '../messages';
import { ScanProgressBar } from './ScanProgressBar';
import { ShowScanTabButton } from './ShowScanTabButton';
import { StopScanButton } from './StopScanButton';
import { useStartScan } from './useStartScan';

/** Contrôles légers abandonnés d'affilée à partir desquels l'utilisateur est prévenu. */
const QUICK_FAILURES_SHOWN = 3;

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
  const { start, busy } = useStartScan(account?.id);
  if (status?.session === 'disconnected') {
    return (
      <Banner>
        <span>{t('common.scanStatus.noSession')}</span>
        <ExternalLink className="xg-btn xg-btn--secondary" href={X_LOGIN_URL}>
          {t('common.openX')}
        </ExternalLink>
      </Banner>
    );
  }
  // Le contrôle léger dure quelques secondes, en arrière-plan : rien à afficher.
  const live = progress?.kind === 'quick' ? undefined : progress;

  if (!live && account?.pending) {
    const { count, full } = account.pending;
    return (
      <Banner>
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
      </Banner>
    );
  }
  // Contrôles légers sans réponse d'affilée : la détection est arrêtée, il faut le dire.
  if (!live && (account?.quickFailures ?? 0) >= QUICK_FAILURES_SHOWN) {
    return (
      <Banner>
        <span>{t('common.scanStatus.checksFailing')}</span>
      </Banner>
    );
  }
  if (!live) return null;

  if (live.status === 'paused' && live.pausedReason === 'needs-focus' && account) {
    return (
      <Banner>
        <span>{stallText()}</span>
        <span className="xg-banner__actions">
          <ShowScanTabButton accountId={account.id} />
          <StopScanButton accountId={account.id} />
        </span>
      </Banner>
    );
  }

  // Tableau de bord : la carte « Dernier scan » montre déjà l'état du scan (en cours, pause, blocage).
  if (!compact) return null;
  if (live.status === 'running') {
    const remaining = remainingLabel(live, now);
    return (
      <Banner tone="info" stacked>
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
      </Banner>
    );
  }

  return (
    <Banner>
      <span>{pauseMessage(live, account)}</span>
    </Banner>
  );
}
