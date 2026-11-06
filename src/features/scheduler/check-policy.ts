import type { AccountsMap } from '@/domain/accounts/model';
import { SAFETY_EVERY } from '@/features/followers-sync/model';
import type { ScanKind, ScanReason, TrackedAccount } from '@/shared/types';
import { HOUR, MINUTE } from '@/shared/utils/time';

/**
 * Origine d'une vérification :
 * - `user` : « Vérifier maintenant » → contrôle léger (abonnés les plus récents + total) ;
 * - `user-full` : « Scan complet », « Continuer le scan » → scan complet ;
 * - `schedule` : alarme périodique → contrôle léger, ou scan complet si le dernier est incomplet ;
 * - `auto` : reprise, nouveau compte, ou départs repérés par le contrôle léger → idem `schedule` ;
 * - `followup` : le contrôle léger a vu le total baisser → scan complet immédiat ;
 * - `retry` : nouvel essai d'un scan complet au résultat suspect → scan complet.
 *
 * Tout scan complet a lieu dans l'onglet x.com épinglé en arrière-plan (§ 4.6).
 */
export type CheckOrigin = 'user' | 'user-full' | 'schedule' | 'auto' | 'followup' | 'retry';

/** Scan de référence automatique qui n'aboutit pas : attente avant le suivant, doublée à chaque essai. */
const BASELINE_RETRY_MS = 15 * MINUTE;
const BASELINE_RETRY_MAX_MS = 12 * HOUR;

export interface CheckPlan {
  kind: ScanKind;
  reason: ScanReason;
  /** Écart repéré par le contrôle léger : le scan s'arrête dès que ces départs sont trouvés. */
  target?: number;
  /** Scan de référence automatique : `wait` s'il est trop tôt, sinon l'essai à enregistrer. */
  backoff?: 'wait' | NonNullable<TrackedAccount['baselineRetry']>;
}

/** Raison affichée d'un scan (tableau de bord), selon son type et son origine. */
function scanReason(kind: ScanKind, origin: CheckOrigin, account: TrackedAccount, accounts: AccountsMap, incomplete: boolean): ScanReason {
  if (kind === 'quick') return 'quick';
  if (kind === 'baseline') {
    return Object.values(accounts).some((a) => a.id !== account.id && a.baselineAt) ? 'new-account' : 'baseline';
  }
  if (origin === 'user-full') return 'user';
  if (origin === 'followup') return account.pending?.count ? 'missing' : 'overflow';
  if (origin === 'retry') return 'recheck';
  if (incomplete) return 'incomplete';
  return 'safety'; // scan de contrôle périodique
}

/** Quel scan lancer pour un compte sans scan en cours (fonction pure). */
export function planCheck(a: {
  origin: CheckOrigin;
  account: TrackedAccount;
  accounts: AccountsMap;
  hasSnapshot: boolean;
  now: number;
}): CheckPlan {
  const { origin, account, accounts, hasSnapshot, now } = a;
  // Dernier scan incomplet : on le continue (union) au lieu d'un simple contrôle léger (§ 4.7).
  const incomplete = account.lastScan ? !account.lastScan.complete : false;
  // Liste classée du plus récent au plus ancien : le contrôle léger suffit tant que le total
  // ne baisse pas ; sinon il enchaîne lui-même un scan complet (`followup`).
  // Scan de contrôle : après SAFETY_EVERY contrôles légers sans scan relu de bout en bout
  // (un scan complet manuel remet le compteur à zéro), pour rattraper ce qui aurait échappé.
  const safety = origin !== 'user' && (account.quickSinceFull ?? 0) >= SAFETY_EVERY;
  const full = origin === 'user-full' || origin === 'followup' || origin === 'retry' || incomplete || safety;
  // Pas de référence (instantané, ou compte sans date de référence) : scan de référence.
  const kind: ScanKind = !hasSnapshot || !account.baselineAt ? 'baseline' : full ? 'check' : 'quick';
  const reason = scanReason(kind, origin, account, accounts, incomplete);
  const target = reason === 'missing' && !account.pending?.full ? account.pending?.count : undefined;

  // Scan de référence automatique : jamais en boucle (onglet fermé par l'utilisateur, compte
  // inaccessible…). Chaque essai qui n'aboutit pas double l'attente avant le suivant.
  if (kind !== 'baseline' || origin !== 'auto') return { kind, reason, target };
  const retry = account.baselineRetry;
  const wait = retry ? Math.min(BASELINE_RETRY_MS * 2 ** (retry.attempts - 1), BASELINE_RETRY_MAX_MS) : 0;
  if (retry && now - retry.at < wait) return { kind, reason, target, backoff: 'wait' };
  return { kind, reason, target, backoff: { attempts: (retry?.attempts ?? 0) + 1, at: now } };
}
