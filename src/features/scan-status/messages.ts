import type { ScanJob, TrackedAccount } from '@/shared/types';
import { formatTime } from '@/shared/utils/format';

/** Textes d'état du scan, partagés par l'overlay, l'onboarding, la popup et le tableau de bord. */

export const SCAN_TAB_HINT = 'Le scan se fait dans un onglet x.com épinglé : ne le ferme pas, il se fermera tout seul.';
export const RATE_LIMIT_TITLE = 'Petite pause…';
export const RATE_LIMIT_TEXT = 'X limite le nombre de requêtes. Le scan reprend tout seul, garde l’onglet ouvert.';
export const STALL_TEXT = 'Le chargement s’est arrêté dans l’onglet x.com. Affiche-le quelques secondes pour le relancer.';

/** Message d'un scan en pause, quelle qu'en soit la raison. */
export function pauseMessage(
  p: Pick<ScanJob, 'pausedReason' | 'resumeAt' | 'error'>,
  account?: Pick<TrackedAccount, 'handle'>,
): string {
  const at = p.resumeAt ? ` à ${formatTime(p.resumeAt)}` : '';
  switch (p.pausedReason) {
    case 'rate-limit':
      return `Limite de requêtes X atteinte : reprise automatique${at}.`;
    case 'needs-focus':
      return STALL_TEXT;
    case 'disconnected':
      return 'Session X absente : reconnecte-toi à x.com, le scan reprendra.';
    case 'account-switched':
      return `Un autre compte est connecté sur x.com : reviens sur @${account?.handle ?? '…'} pour terminer le scan.`;
    default:
      return `Erreur${p.error ? ` (${p.error})` : ''}, nouvel essai automatique${at}.`;
  }
}
