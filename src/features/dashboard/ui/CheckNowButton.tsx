import { useEffect, useRef, useState } from 'react';
import type { ScanProgress } from '@/features/followers-sync/model';
import { useStartScan } from '@/features/scan-status/ui/useStartScan';
import { t } from '@/shared/i18n';
import type { TrackedAccount } from '@/shared/types';
import { RefreshCw } from 'lucide-react';
import { Tooltip } from '@/shared/ui/Tooltip';
import { useToast } from '@/shared/ui/toast';
import { quickSummary } from './quickSummary';
import { MINUTE, SECOND } from '@/shared/utils/time';

/** Au-delà, un contrôle lancé ici sans résultat est oublié (échec, fermeture) : pas de toast tardif. */
const RESULT_TIMEOUT_MS = 3 * MINUTE;
/** Contrôle si rapide qu'il s'est terminé avant d'être vu tourner. */
const FAST_RESULT_MS = 30 * SECOND;
/** Démarrage demandé sans scan visible au bout de ce délai : l'icône arrête de tourner. */
const START_GRACE_MS = 15 * SECOND;

/**
 * « Vérifier maintenant » : contrôle léger (total + abonnés les plus récents, quelques secondes).
 * S'il manque des abonnés, xGhost enchaîne tout seul un scan complet pour identifier les départs.
 * « Scan complet » relit toute la liste.
 */
export function CheckNowButton({ account, progress }: { account: TrackedAccount; progress?: ScanProgress }) {
  const { start, busy } = useStartScan(account.id);
  const toast = useToast();
  // Contrôle léger lancé ici : heure du clic, et s'il a été vu tourner. Seul ce contrôle-là
  // donne un toast (pas un contrôle automatique qui se terminerait juste après).
  const pending = useRef<{ since: number; seen: boolean } | undefined>(undefined);
  const quickRunning = progress?.kind === 'quick';
  const fullRunning = !!progress && progress.kind !== 'quick';
  const quickAt = account.lastQuick?.at;
  // L'icône tourne tant qu'une vérification tourne (contrôle léger, scan complet enchaîné ou lancé
  // ailleurs), et entre le clic et l'apparition du scan, pour ne pas s'arrêter entre les deux.
  const running = progress?.status === 'running';
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!starting) return;
    if (running) return setStarting(false);
    const timer = setTimeout(() => setStarting(false), START_GRACE_MS);
    return () => clearTimeout(timer);
  }, [starting, running, quickAt]);
  useEffect(() => setStarting(false), [quickAt]);

  // Résultat du contrôle léger lancé ici : arrivées, départs récents, écart (même texte que l'en-tête).
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    if (quickRunning) {
      p.seen = true;
      return;
    }
    const expired = Date.now() - p.since > RESULT_TIMEOUT_MS;
    // Le clic a lancé un scan complet (dernier scan incomplet) ou repris un scan : pas de contrôle léger.
    if (expired || (fullRunning && !p.seen)) {
      pending.current = undefined;
      return;
    }
    const answered = !!quickAt && quickAt >= p.since && (p.seen || quickAt - p.since < FAST_RESULT_MS);
    if (!answered) {
      // Contrôle terminé sans résultat (ignoré, échec) : on n'attend plus.
      if (p.seen) pending.current = undefined;
      return;
    }
    pending.current = undefined;
    const summary = quickSummary(account);
    if (summary) toast.show(t('dashboard.check.result', { summary }));
  }, [account, quickAt, quickRunning, fullRunning, toast]);

  const check = async () => {
    // Noté avant l'envoi : le résultat peut être enregistré avant la réponse du service worker.
    pending.current = { since: Date.now() - SECOND, seen: false };
    if (await start()) setStarting(true);
    else pending.current = undefined;
  };

  // Limite d'abonnés dépassée (§ 4.9) : plus de vérification à la demande, ni de scan complet.
  const limited = !!account.limit;
  return (
    <div className="xg-check">
      <button
        type="button"
        className={`xg-btn xg-btn--primary xg-btn--lg${limited ? ' is-stopped' : ''}`}
        disabled={limited || busy || quickRunning || fullRunning}
        onClick={() => void check()}
      >
        <RefreshCw size={18} className={!limited && (busy || starting || running) ? 'xg-spin' : undefined} />{' '}
        {quickRunning && !limited ? t('dashboard.check.checking') : t('common.checkNow')}
      </button>
      {!limited && (
        <Tooltip label={t('dashboard.check.fullScanTitle')} side="bottom" align="end">
          <button type="button" className="xg-link" disabled={busy || fullRunning} onClick={() => void start({ full: true })}>
            {t('dashboard.check.fullScan')}
          </button>
        </Tooltip>
      )}
    </div>
  );
}
