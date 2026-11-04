import type { TrackedAccount } from '@/shared/types';

/** Règles pures sur les comptes suivis (sans stockage : importables par les interfaces). */

export type AccountsMap = Record<string, TrackedAccount>;

/**
 * Choix de démarrage fait (§ 3.3) : un compte au moins a sa référence, obtenue par une
 * synchronisation ou par l'import d'une sauvegarde. Seule définition, partagée par le service
 * worker, l'onboarding et la popup.
 */
export const isOnboarded = (accounts: readonly Pick<TrackedAccount, 'baselineAt'>[] | AccountsMap): boolean =>
  (Array.isArray(accounts) ? accounts : Object.values(accounts)).some((a) => !!a.baselineAt);

/** Le @handle est connu (avant la première lecture du profil, `handle` vaut l'id du compte). */
export const hasKnownHandle = (a: Pick<TrackedAccount, 'id' | 'handle'>) => !!a.handle && a.handle !== a.id;
