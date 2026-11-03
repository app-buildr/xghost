import { useEffect, useRef, useState } from 'react';
import type { ScanProgress } from '@/features/followers-sync/repository';
import { send } from '@/shared/messaging/client';
import { IconRefresh } from '@/shared/ui/icons';
import { useToast } from '@/shared/ui/toast';

const REASONS: Record<string, string> = {
  disconnected: 'Connecte-toi à X pour lancer une vérification',
  'already-running': 'Une vérification est déjà en cours',
  'rate-limit': 'Limite de X atteinte, la vérification reprendra automatiquement',
  'checked-elsewhere': 'Vérification déjà faite récemment sur un autre ordinateur',
};

/**
 * « Vérifier maintenant » : contrôle léger (total + abonnés les plus récents, quelques secondes).
 * S'il manque des abonnés, xGhost enchaîne tout seul un scan complet pour identifier les départs.
 * « Scan complet » relit toute la liste.
 */
export function CheckNowButton({ progress }: { progress?: ScanProgress }) {
  const [busy, setBusy] = useState(false);
  // Contrôle léger lancé ici : 'started' tant qu'il n'est pas apparu, 'seen' pendant qu'il tourne.
  const phase = useRef<'idle' | 'started' | 'seen'>('idle');
  const toast = useToast();
  const quickRunning = progress?.kind === 'quick';
  const fullRunning = !!progress && progress.kind !== 'quick';

  // Fin du contrôle léger lancé ici : on dit ce qu'il a trouvé.
  useEffect(() => {
    if (quickRunning) {
      if (phase.current === 'started') phase.current = 'seen';
      return;
    }
    if (phase.current !== 'seen') return;
    phase.current = 'idle';
    toast.show(fullRunning ? 'Il manque des abonnés : scan complet lancé pour savoir qui' : 'À jour : aucun départ détecté');
  }, [quickRunning, fullRunning, toast]);

  const start = async (full: boolean) => {
    setBusy(true);
    try {
      const res = await send('scan:start', { full });
      if (!res.started) toast.show(REASONS[res.reason ?? ''] ?? 'Vérification impossible pour le moment');
      else if (full) toast.show('Scan complet lancé dans l’onglet x.com épinglé');
      else phase.current = 'started';
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="xg-check">
      <button
        type="button"
        className="xg-btn xg-btn--primary xg-btn--lg"
        disabled={busy || quickRunning || fullRunning}
        onClick={() => void start(false)}
      >
        <IconRefresh size={18} /> {quickRunning ? 'Vérification…' : 'Vérifier maintenant'}
      </button>
      <button
        type="button"
        className="xg-link"
        disabled={busy || fullRunning}
        title="Relire toute la liste des abonnés"
        onClick={() => void start(true)}
      >
        Scan complet
      </button>
    </div>
  );
}
