import type { ScanProgress } from '@/features/followers-sync/repository';
import { send } from '@/shared/messaging/client';
import type { GlobalStatus, TrackedAccount } from '@/shared/types';
import { ProgressBar } from '@/shared/ui/primitives';
import { remainingLabel } from '@/features/followers-sync/estimate';
import { formatNumber, plural } from '@/shared/utils/format';
import { pauseMessage, SCAN_TAB_HINT, STALL_TEXT } from '../messages';

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
  if (status?.session === 'disconnected') {
    return (
      <div className="xg-banner xg-banner--warn" role="status">
        <span>Aucune session X trouvée. Connecte-toi à X pour reprendre la vérification.</span>
        <a className="xg-btn xg-btn--secondary" href="https://x.com/login" target="_blank" rel="noreferrer">
          Ouvrir x.com
        </a>
      </div>
    );
  }
  // Le contrôle léger dure quelques secondes, en arrière-plan : rien à afficher.
  if (progress?.kind === 'quick') progress = undefined;

  if (!progress && account?.pending) {
    const { count, full } = account.pending;
    return (
      <div className="xg-banner xg-banner--warn" role="status">
        <span>
          {count > 0
            ? `X indique ${plural(count, 'abonné')} en moins. Lance une vérification pour savoir qui est parti.`
            : full
              ? 'Beaucoup de nouveaux abonnés : une vérification complète est nécessaire.'
              : 'Une vérification complète est nécessaire.'}
        </span>
        <button type="button" className="xg-btn xg-btn--primary" onClick={() => void send('scan:start', { full: true })}>
          Identifier
        </button>
      </div>
    );
  }
  if (!progress) return null;

  if (progress.status === 'paused' && progress.pausedReason === 'needs-focus' && account) {
    return (
      <div className="xg-banner xg-banner--warn" role="status">
        <span>{STALL_TEXT}</span>
        <button
          type="button"
          className="xg-btn xg-btn--secondary"
          onClick={() => void send('scan:focus', { accountId: account.id })}
        >
          Afficher
        </button>
      </div>
    );
  }

  // Tableau de bord : la carte « Dernier scan » montre déjà l'état du scan (en cours, pause, blocage).
  if (!compact) return null;
  if (progress.status === 'running') {
    const label =
      progress.kind === 'baseline'
        ? 'Scan de référence en cours'
        : 'Vérification en cours';
    return (
      <div className="xg-banner xg-banner--info" role="status" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <strong>{label}</strong>
          <span>
            {formatNumber(progress.collected)}
            {progress.expected > 0 ? ` / ${formatNumber(progress.expected)}` : ''}
          </span>
        </div>
        <ProgressBar value={progress.collected} max={progress.expected || progress.collected + 1} />
        <span>
          {SCAN_TAB_HINT}
          {remainingLabel(progress, now) ? ` ${remainingLabel(progress, now)}.` : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="xg-banner xg-banner--warn" role="status">
      <span>{pauseMessage(progress, account)}</span>
    </div>
  );
}
