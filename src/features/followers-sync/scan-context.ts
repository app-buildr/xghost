import { createSerialQueue } from '@/shared/utils/serial';
import type { FollowCheckResult, ScanJob } from '@/shared/types';

/** Ce que le moteur de scan attend de l'orchestrateur, et sa file d'événements. */

export interface ScanHooks {
  onComplete: (job: ScanJob) => Promise<void>;
  /** Après la fermeture de l'onglet et l'effacement du scan (enchaînement d'un autre scan). */
  onFinished: (job: ScanJob) => Promise<void>;
  /** Scan complet interrompu (onglet fermé) : marqué incomplet (§ 4.3). */
  onInterrupted: (job: ScanJob) => Promise<void>;
  onStateChange: () => Promise<void>;
  scheduleResume: (accountId: string, at: number) => Promise<void>;
  /** Total annoncé par X au-delà de la limite (§ 4.9) : scan arrêté, onglet fermé. */
  onFollowerLimit: (job: ScanJob, count: number) => Promise<void>;
  /** Total revenu sous la limite d'un compte qui l'avait dépassée : le scan continue. */
  onFollowerLimitCleared: (accountId: string) => Promise<void>;
  /**
   * Fin d'une passe de vérification du follow back : résultats à appliquer aux départs, et date
   * de la passe suivante (`undefined` : plus rien en attente).
   */
  onFollowCheckDone: (accountId: string, results: FollowCheckResult[], nextAt?: number) => Promise<void>;
}

let hooks: ScanHooks | undefined;
export const setScanHooks = (h: ScanHooks) => (hooks = h);

/** Crochets du moteur. Sans eux, un scan serait effacé sans analyse : l'erreur doit se voir. */
export function scanHooks(): ScanHooks {
  if (!hooks) throw new Error('scan-hooks-missing');
  return hooks;
}

// Les événements d'onglet arrivent vite : on les traite un par un.
const tabEvents = createSerialQueue();
export const serial = <T>(fn: () => Promise<T>): Promise<T> => tabEvents.run(fn);
