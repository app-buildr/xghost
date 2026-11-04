import type { TrackedAccount } from '@/shared/types';

/**
 * Limite d'abonnés (§ 4.9). Au-delà, le scan par défilement serait trop long et risquerait de
 * dépasser les limites de requêtes de X.
 *
 * - Compte jamais synchronisé (pas de référence) : aucune synchronisation au-delà de 15 000.
 * - Compte déjà suivi : les vérifications s'arrêtent au-delà de 20 000. La marge évite de couper
 *   un compte qui a commencé juste sous 15 000 et grandit, ou dont le total oscille.
 *
 * Le total testé est celui annoncé par X sur le profil, lu avant tout défilement.
 */
export const ENTRY_FOLLOWER_LIMIT = 15_000;
export const TRACKED_FOLLOWER_LIMIT = 20_000;

/** Limite qui s'applique au compte : 15 000 avant sa référence, 20 000 ensuite. */
export const followerLimitOf = (a: Pick<TrackedAccount, 'baselineAt'>): number =>
  a.baselineAt ? TRACKED_FOLLOWER_LIMIT : ENTRY_FOLLOWER_LIMIT;

/** Le total annoncé par X dépasse la limite du compte (total inconnu : jamais). */
export const exceedsFollowerLimit = (a: Pick<TrackedAccount, 'baselineAt'>, count: number | undefined): boolean =>
  count !== undefined && count > followerLimitOf(a);
