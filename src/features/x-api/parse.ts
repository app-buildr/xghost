import type { AccountStatus, Profile } from '@/shared/types';

/** Analyse pure des réponses GraphQL de X, tolérante aux variations de format. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface FollowersPage {
  users: Profile[];
  nextCursor?: string;
  done: boolean;
}

export interface UserLookup {
  status: AccountStatus;
  profile?: Profile & { followersCount?: number };
}

/** Opérations GraphQL de x.com lues par xGhost. */
const WATCHED_PATH = /^\/i\/api\/graphql\/[^/]+\/(Followers|UserByRestId|UserByScreenName)$/;

/** Nom de l'opération si `url` est un appel GraphQL de x.com suivi par xGhost (sinon `undefined`). */
export function watchedOperation(url: string): string | undefined {
  try {
    const u = new URL(url, 'https://x.com');
    return u.origin === 'https://x.com' ? WATCHED_PATH.exec(u.pathname)?.[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Formats X acceptés (aussi utilisés pour valider une sauvegarde importée). */
export const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export const ID = /^\d{1,20}$/;
export const AVATAR = /^https:\/\/(pbs|abs)\.twimg\.com\//;

function parseUser(r: Json): (Profile & { followersCount?: number }) | null {
  if (!r || r.__typename !== 'User' || !r.rest_id) return null;
  // Valeurs reprises dans des URL et des <img> : on n'accepte que des formats X valides.
  const id = String(r.rest_id);
  const handle: unknown = r.core?.screen_name ?? r.legacy?.screen_name;
  if (!ID.test(id) || typeof handle !== 'string' || !HANDLE.test(handle)) return null;
  const avatar: unknown = r.avatar?.image_url ?? r.legacy?.profile_image_url_https;
  const followersCount: unknown = r.legacy?.followers_count ?? r.relationship_counts?.followers;
  return {
    id,
    handle,
    name: String(r.core?.name ?? r.legacy?.name ?? handle).slice(0, 100),
    avatar: typeof avatar === 'string' && AVATAR.test(avatar) ? avatar : undefined,
    following: Boolean(r.relationship_perspectives?.following ?? r.legacy?.following ?? false),
    followersCount: typeof followersCount === 'number' && followersCount >= 0 ? followersCount : undefined,
  };
}

function* timelineEntries(data: Json): Generator<Json> {
  const timeline = data?.data?.user?.result?.timeline?.timeline ?? data?.data?.user?.result?.timeline_v2?.timeline;
  for (const instruction of timeline?.instructions ?? []) {
    if (Array.isArray(instruction.entries)) yield* instruction.entries;
    if (instruction.entry) yield instruction.entry;
  }
}

export function parseFollowersPage(data: Json, previousCursor?: string): FollowersPage {
  const users: Profile[] = [];
  let nextCursor: string | undefined;
  for (const entry of timelineEntries(data)) {
    const content = entry?.content;
    if (content?.cursorType === 'Bottom' || String(entry?.entryId ?? '').startsWith('cursor-bottom')) {
      nextCursor = content?.value;
      continue;
    }
    const user = parseUser(content?.itemContent?.user_results?.result);
    if (user) {
      const { followersCount: _ignored, ...profile } = user;
      users.push(profile);
    }
  }
  // Fin de liste : plus de curseur suivant (ou curseur inchangé, ou « 0|… »). Une page vide qui
  // annonce encore une suite n'est pas la fin : x.com la saute et charge la suivante.
  const done = !nextCursor || nextCursor === previousCursor || /^0\|/.test(nextCursor);
  return { users, nextCursor, done };
}

export function parseUserLookup(data: Json): UserLookup {
  const r = data?.data?.user?.result;
  if (!r) return { status: 'gone' };
  if (r.__typename === 'UserUnavailable') {
    return { status: /suspend/i.test(String(r.reason ?? r.unavailable_message?.text ?? '')) ? 'suspended' : 'gone' };
  }
  const profile = parseUser(r);
  return profile ? { status: 'active', profile } : { status: 'gone' };
}

/** Réponse de X signalant la limite de requêtes (HTTP 429, ou erreur 88 « Rate limit exceeded »). */
export function isRateLimited(status: number, body: string): boolean {
  if (status === 429 || status === 420) return true;
  if (!body.includes('ate limit')) return false;
  try {
    const errors = (JSON.parse(body) as Json)?.errors;
    return Array.isArray(errors) && errors.some((e: Json) => e?.code === 88 || /rate limit/i.test(String(e?.message)));
  } catch {
    return /rate limit exceeded/i.test(body);
  }
}

/** Variables GraphQL d'une URL interceptée (`userId`, `cursor`…). */
export function variablesOf(url: string): { userId?: string; cursor?: string; screen_name?: string } {
  try {
    const raw = new URL(url, 'https://x.com').searchParams.get('variables');
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
