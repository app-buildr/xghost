import type { ProfileCache } from '@/features/followers-sync/repository';
import { t } from '@/shared/i18n';
import type { FollowEvent } from '@/shared/types';

/** Nom affiché d'un compte : nom de profil connu, sinon @handle. */
export function displayName(e: FollowEvent, profiles: ProfileCache | undefined): string {
  const name = profiles?.[e.profileId]?.name;
  return typeof name === 'string' && name ? name : `@${e.handle}`;
}

/** Libellé d'un compte qui n'est plus actif (suspendu, supprimé), sinon rien. */
export function statusLabel(e: FollowEvent): string | undefined {
  if (e.status === 'suspended') return t('dashboard.row.suspended');
  if (e.status === 'gone') return t('dashboard.row.gone');
  return undefined;
}

/** Morceaux d'information assemblés avec le séparateur de la langue (« @x · suivi pendant 3 mois »). */
export const joinParts = (parts: readonly (string | undefined)[]) =>
  parts.filter(Boolean).join(t('format.separator'));
