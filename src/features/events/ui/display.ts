import type { FollowEvent, ProfileCache } from '@/shared/types';

/** Nom affiché d'un compte : nom de profil connu, sinon @handle. */
export function displayName(e: FollowEvent, profiles: ProfileCache | undefined): string {
  const name = profiles?.[e.profileId]?.name;
  return typeof name === 'string' && name ? name : `@${e.handle}`;
}
