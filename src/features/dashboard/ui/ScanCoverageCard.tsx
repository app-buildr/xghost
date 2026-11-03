import { joinParts } from '@/features/events/ui/display';
import { remainingLabel } from '@/features/followers-sync/estimate';
import type { ScanProgress } from '@/features/followers-sync/repository';
import { pauseMessage, rateLimitText, scanTabHint, stallText } from '@/features/scan-status/messages';
import { scanCoverage } from '@/features/scan-status/progress';
import { ScanProgressBar } from '@/features/scan-status/ui/ScanProgressBar';
import { ShowScanTabButton } from '@/features/scan-status/ui/ShowScanTabButton';
import { useStartScan } from '@/features/scan-status/ui/useStartScan';
import { useNow } from '@/shared/hooks/useNow';
import { t } from '@/shared/i18n';
import type { ScanReason, TrackedAccount } from '@/shared/types';
import { ProgressBar } from '@/shared/ui/primitives';
import {
  formatCountdown,
  formatDayOrDate,
  formatElapsedShort,
  formatNumber,
  formatPercent,
  formatProgressCount,
} from '@/shared/utils/format';

/** Pourquoi le scan complet en cours a été lancé (témoin pour l'utilisateur). */
const REASONS: Partial<Record<ScanReason, () => string>> = {
  baseline: () => t('dashboard.coverage.reasons.baseline'),
  'new-account': () => t('dashboard.coverage.reasons.newAccount'),
  user: () => t('dashboard.coverage.reasons.user'),
  missing: () => t('dashboard.coverage.reasons.missing'),
  overflow: () => t('dashboard.coverage.reasons.overflow'),
  incomplete: () => t('dashboard.coverage.reasons.incomplete'),
  safety: () => t('dashboard.coverage.reasons.safety'),
  recheck: () => t('dashboard.coverage.reasons.recheck'),
};

/** Sans nouvel abonné depuis ce délai pendant un scan en cours, on le signale comme bloqué. */
const STUCK_MS = 45_000;

type LiveState =
  | { kind: 'running' }
  | { kind: 'stuck'; since: number }
  | { kind: 'rate-limit'; resumeAt?: number }
  | { kind: 'interrupted'; text: string };

function liveState(p: ScanProgress, now: number): LiveState {
  if (p.status === 'paused') {
    if (p.pausedReason === 'rate-limit') return { kind: 'rate-limit', resumeAt: p.resumeAt };
    if (p.pausedReason === 'needs-focus') return { kind: 'stuck', since: p.lastProgressAt ?? p.updatedAt };
    return { kind: 'interrupted', text: pauseMessage(p) };
  }
  const last = p.lastProgressAt ?? p.startedAt;
  return now - last > STUCK_MS ? { kind: 'stuck', since: last } : { kind: 'running' };
}

function StateTag({ state, complete, hasLast }: { state?: LiveState; complete: boolean; hasLast: boolean }) {
  if (state?.kind === 'running') return <span className="xg-tag xg-tag--follow">{t('dashboard.coverage.tag.running')}</span>;
  if (state?.kind === 'rate-limit') return <span className="xg-tag xg-tag--muted">{t('dashboard.coverage.tag.paused')}</span>;
  if (state) {
    return (
      <span className="xg-tag xg-tag--new">
        {state.kind === 'stuck' ? t('dashboard.coverage.tag.stuck') : t('dashboard.coverage.tag.interrupted')}
      </span>
    );
  }
  if (!hasLast) return null;
  return complete ? (
    <span className="xg-tag xg-tag--ok">{t('dashboard.coverage.tag.complete')}</span>
  ) : (
    <span className="xg-tag xg-tag--new">{t('dashboard.coverage.tag.incomplete')}</span>
  );
}

/**
 * Carte « Dernier scan » (§ 3.4, 4.7) : abonnés détectés sur X face aux abonnés scannés.
 * Pendant un scan complet, elle suit le scan en direct.
 */
export function ScanCoverageCard({
  account,
  progress,
  now,
}: {
  account: TrackedAccount;
  progress?: ScanProgress;
  now: number;
}) {
  const { start, busy } = useStartScan();
  const live = progress && progress.kind !== 'quick' ? progress : undefined;
  // Horloge propre à la carte pendant un scan : l'état « bloqué » apparaît sans attendre le parent.
  const clock = useNow(5_000, !!live);
  const state = live ? liveState(live, Math.max(now, clock)) : undefined;
  const tick = useNow(1000, !!state && state.kind !== 'running');
  const last = account.lastScan;
  // Pendant un nouveau scan, la carte garde les chiffres du dernier scan : rien n'est effacé,
  // l'instantané précédent reste la référence tant que le nouveau scan n'est pas complet.
  const shown = last ?? (live ? { detected: live.expected, scanned: live.collected, complete: false } : undefined);
  const detected = shown?.detected ?? 0;
  const scanned = shown?.scanned ?? 0;
  const complete = !!shown?.complete;
  const missing = Math.max(0, detected - scanned);
  const pct = scanCoverage({ scanned, detected });

  return (
    <div className={`xg-card xg-coverage${state?.kind === 'rate-limit' ? ' is-paused' : ''}`}>
      <div className="xg-coverage__head">
        <span className="xg-stat__label">{t('dashboard.coverage.title')}</span>
        <StateTag state={state} complete={complete} hasLast={!!last} />
        <span className="xg-coverage__date">
          {last ? formatDayOrDate(last.at, now) : live ? t('dashboard.coverage.inProgress') : '—'}
        </span>
      </div>
      <div className="xg-coverage__figures">
        <div>
          <span className="xg-coverage__label">{t('dashboard.coverage.detected')}</span>
          <strong className="xg-stat__value">{detected ? formatNumber(detected) : '—'}</strong>
        </div>
        <div>
          <span className="xg-coverage__label">{t('dashboard.coverage.scanned')}</span>
          <strong className="xg-stat__value xg-stat__value--primary">{formatNumber(scanned)}</strong>
        </div>
      </div>
      {/* Barre : progression du scan en cours s'il y en a un, sinon couverture du dernier scan. */}
      {live ? (
        <ScanProgressBar progress={live} />
      ) : (
        <ProgressBar value={scanned} max={detected || scanned || 1} label={t('dashboard.coverage.title')} />
      )}
      {live && state ? (
        <div className="xg-coverage__foot">
          <div>
            {state.kind === 'running' && (
              <>
                <strong>
                  {joinParts([
                    live.expected > 0
                      ? t('dashboard.coverage.newScanPct', {
                          progress: formatProgressCount(live.collected, live.expected),
                          pct: formatPercent(scanCoverage({ scanned: live.collected, detected: live.expected })),
                        })
                      : t('dashboard.coverage.newScan', { progress: formatProgressCount(live.collected, 0) }),
                    remainingLabel(live, now),
                  ])}
                </strong>
                <span>
                  {last
                    ? t('dashboard.coverage.keepsLast', { reason: REASONS[live.reason as ScanReason]?.() ?? scanTabHint() })
                    : (REASONS[live.reason as ScanReason]?.() ?? scanTabHint())}
                </span>
              </>
            )}
            {state.kind === 'rate-limit' && (
              <>
                <strong>
                  {joinParts([
                    t('dashboard.coverage.pausedAt', { progress: formatProgressCount(live.collected, live.expected) }),
                    t('dashboard.coverage.resume', { countdown: formatCountdown(state.resumeAt, tick) }),
                  ])}
                </strong>
                <span>{rateLimitText()}</span>
              </>
            )}
            {state.kind === 'stuck' && (
              <>
                <strong>{t('dashboard.coverage.stuckSince', { elapsed: formatElapsedShort(state.since, tick) })}</strong>
                <span>{stallText()}</span>
              </>
            )}
            {state.kind === 'interrupted' && <span>{state.text}</span>}
          </div>
          {state.kind === 'stuck' && <ShowScanTabButton accountId={account.id} />}
        </div>
      ) : !live && last && !complete ? (
        <div className="xg-coverage__foot">
          <div>
            <strong>
              {joinParts([
                formatPercent(pct),
                t('dashboard.coverage.missingAccounts', { count: missing, n: formatNumber(missing) }),
              ])}
            </strong>
            <span>{t('dashboard.coverage.departuresAfterComplete')}</span>
          </div>
          <button
            type="button"
            className="xg-btn xg-btn--primary"
            disabled={busy}
            onClick={() => void start({ full: true, announce: false })}
          >
            {t('common.continueScan')}
          </button>
        </div>
      ) : (
        <div className="xg-coverage__foot">
          <div>
            <strong>
              {joinParts([
                formatPercent(pct),
                missing > 0 ? t('dashboard.coverage.notShown', { count: missing, n: formatNumber(missing) }) : undefined,
                last?.stoppedAt ? t('dashboard.coverage.stoppedAt', { n: formatNumber(last.stoppedAt) }) : undefined,
              ])}
            </strong>
            <span>
              {live ? scanTabHint() : last ? t('dashboard.coverage.hiddenAccounts') : t('dashboard.coverage.firstNotDone')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
