import type { ProfileCache } from '@/features/followers-sync/repository';
import type { FollowEvent } from '@/shared/types';

export function displayName(e: FollowEvent, profiles: ProfileCache | undefined): string {
  return profiles?.[e.profileId]?.name ?? `@${e.handle}`;
}

export function statusLabel(e: FollowEvent): string | undefined {
  if (e.status === 'suspended') return 'compte suspendu';
  if (e.status === 'gone') return 'compte supprimé ou désactivé';
  return undefined;
}
