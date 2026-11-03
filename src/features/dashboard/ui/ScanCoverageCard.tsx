import { useState } from 'react';
import { remainingLabel } from '@/features/followers-sync/estimate';
import type { ScanProgress } from '@/features/followers-sync/repository';
import { pauseMessage, RATE_LIMIT_TEXT, SCAN_TAB_HINT, STALL_TEXT } from '@/features/scan-status/messages';
import { useNow } from '@/shared/hooks/useNow';
import { send } from '@/shared/messaging/client';
import type { TrackedAccount } from '@/shared/types';
import { ProgressBar } from '@/shared/ui/primitives';
import {
  formatCountdown,
  formatDayOrDate,
  formatElapsedShort,
  formatNumber,
  percentOf,
  plural,
  pluralS,
} from '@/shared/utils/format';

const coverage = (scanned: number, detected: number) => percentOf(scanned, detected, { emptyIsFull: true });

/**
 * Carte « Dernier scan » (§ 3.4, 4.7) : abonnés détectés sur X face aux abonnés scannés.
 * Pendant un scan complet, elle suit le scan en direct.
 */
/** Pourquoi le scan complet en cours a été lancé (témoin pour l'utilisateur). */
const REASONS: Record<string, string> = {
  baseline: 'Premier scan : il sert de référence.',
  'new-account': 'Nouveau compte X détecté sur x.com : premier scan de référence de ce compte.',
  user: 'Scan complet demandé.',
  missing: 'Le contrôle rapide a vu des abonnés en moins : scan complet pour savoir qui est parti.',
  overflow: 'Trop de nouveaux abonnés pour le contrôle rapide : scan complet.',
  incomplete: 'Le scan précédent était incomplet : on le continue.',
  safety: 'Scan de contrôle complet (tous les 10 contrôles rapides), pour rattraper ce qui aurait pu échapper.',
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

export function ScanCoverageCard({
  account,
  progress,
  now,
}: {
  account: TrackedAccount;
  progress?: ScanProgress;
  now: number;
}) {
  const [busy, setBusy] = useState(false);
  const live = progress && progress.kind !== 'quick' ? progress : undefined;
  const state = live ? liveState(live, now) : undefined;
  const tick = useNow(1000, !!state && state.kind !== 'running');
  const last = account.lastScan;
  // Pendant un nouveau scan, la carte garde les chiffres du dernier scan : rien n'est effacé,
  // l'instantané précédent reste la référence tant que le nouveau scan n'est pas complet.
  const shown = last ?? (live ? { detected: live.expected, scanned: live.collected, complete: false } : undefined);
  const detected = shown?.detected ?? 0;
  const scanned = shown?.scanned ?? 0;
  const complete = !!shown?.complete;
  const missing = Math.max(0, detected - scanned);
  const pct = coverage(scanned, detected);
  const livePct = live ? coverage(live.collected, live.expected) : 0;

  const tag = state ? (
    state.kind === 'running' ? (
      <span className="xg-tag xg-tag--follow">En cours</span>
    ) : state.kind === 'rate-limit' ? (
      <span className="xg-tag xg-tag--muted">Petite pause</span>
    ) : (
      <span className="xg-tag xg-tag--new">{state.kind === 'stuck' ? 'Bloqué' : 'Interrompu'}</span>
    )
  ) : !last ? null : complete ? (
    <span className="xg-tag xg-tag--ok">Complet</span>
  ) : (
    <span className="xg-tag xg-tag--new">Incomplet</span>
  );

  return (
    <div className={`xg-card xg-coverage${state?.kind === 'rate-limit' ? ' is-paused' : ''}`}>
      <div className="xg-coverage__head">
        <span className="xg-kpi__label">Dernier scan</span>
        {tag}
        <span className="xg-coverage__date">{last ? formatDayOrDate(last.at, now) : live ? 'en cours' : '—'}</span>
      </div>
      <div className="xg-coverage__figures">
        <div>
          <span className="xg-coverage__label">Détectés sur X</span>
          <strong className="xg-kpi__value">{detected ? formatNumber(detected) : '—'}</strong>
        </div>
        <div>
          <span className="xg-coverage__label">Scannés</span>
          <strong className="xg-kpi__value xg-kpi__value--primary">{formatNumber(scanned)}</strong>
        </div>
      </div>
      {/* Barre : progression du scan en cours s'il y en a un, sinon couverture du dernier scan. */}
      {live ? (
        <ProgressBar value={live.collected} max={live.expected || live.collected + 1} />
      ) : (
        <ProgressBar value={scanned} max={detected || scanned || 1} />
      )}
      {live && state ? (
        <div className="xg-coverage__foot">
          <div>
            {state.kind === 'running' && (
              <>
                <strong>
                  Nouveau scan : {formatNumber(live.collected)}
                  {live.expected > 0 ? ` / ${formatNumber(live.expected)} (${livePct} %)` : ''}
                  {remainingLabel(live, now) ? ` · ${remainingLabel(live, now)}` : ''}
                </strong>
                <span>
                  {REASONS[live.reason ?? ''] ?? SCAN_TAB_HINT}
                  {last ? ' Les chiffres ci-dessus restent ceux du dernier scan jusqu’à la fin de celui-ci.' : ''}
                </span>
              </>
            )}
            {state.kind === 'rate-limit' && (
              <>
                <strong>
                  Nouveau scan en pause à {formatNumber(live.collected)}
                  {live.expected > 0 ? ` / ${formatNumber(live.expected)}` : ''} · reprise {formatCountdown(state.resumeAt, tick)}
                </strong>
                <span>{RATE_LIMIT_TEXT}</span>
              </>
            )}
            {state.kind === 'stuck' && (
              <>
                <strong>Aucun nouvel abonné depuis {formatElapsedShort(state.since, tick)}</strong>
                <span>{STALL_TEXT}</span>
              </>
            )}
            {state.kind === 'interrupted' && <span>{state.text}</span>}
          </div>
          {state.kind === 'stuck' && (
            <button
              type="button"
              className="xg-btn xg-btn--secondary"
              onClick={() => void send('scan:focus', { accountId: account.id })}
            >
              Afficher l’onglet
            </button>
          )}
        </div>
      ) : !live && last && !complete ? (
        <div className="xg-coverage__foot">
          <div>
            <strong>
              {pct} % · {plural(missing, 'compte')} manquant{pluralS(missing)}
            </strong>
            <span>Les départs ne sont calculés qu’après un scan complet.</span>
          </div>
          <button
            type="button"
            className="xg-btn xg-btn--primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await send('scan:start', { full: true });
              } finally {
                setBusy(false);
              }
            }}
          >
            Continuer le scan
          </button>
        </div>
      ) : (
        <div className="xg-coverage__foot">
          <div>
            <strong>
              {pct} %{missing > 0 ? ` · ${formatNumber(missing)} non affiché${pluralS(missing)} par X` : ''}
              {last?.stoppedAt ? ` · arrêté après ${formatNumber(last.stoppedAt)} : la suite n’avait pas changé` : ''}
            </strong>
            <span>
              {live
                ? SCAN_TAB_HINT
                : last
                  ? 'X compte aussi des comptes qu’il n’affiche pas (suspendus, restreints).'
                  : 'Le premier scan n’est pas encore terminé.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
