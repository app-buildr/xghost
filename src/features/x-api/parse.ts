import { WATCHED_OPERATIONS, type WatchedOperation } from '@/shared/messaging/protocol';
import type { AccountStatus, Profile } from '@/shared/types';
import { AVATAR, HANDLE, ID, X_ORIGIN } from '@/shared/x-urls';

/** Analyse pure des réponses GraphQL de X, tolérante aux variations de format. */

/** Réponses de X non typées : lues prudemment, champ par champ. */
type Json = any;

export interface FollowersPage {
  users: Profile[];
  /** Comptes de la page que xGhost n'a pas su lire (format de X modifié). */
  skipped: number;
  nextCursor?: string;
  done: boolean;
}

export interface UserLookup {
  status: AccountStatus;
  profile?: Profile & { followersCount?: number };
  /** « Je le suis », seulement si la réponse le dit (absent : inconnu). */
  following?: boolean;
  /** « Il me suit », seulement si la réponse le dit (absent : inconnu). */
  followedBy?: boolean;
}

const WATCHED_PATH = new RegExp(`^/i/api/graphql/[^/]+/(${WATCHED_OPERATIONS.join('|')})$`);

/** Nom de l'opération si `url` est un appel GraphQL de x.com suivi par xGhost (sinon `undefined`). */
export function watchedOperation(url: string): WatchedOperation | undefined {
  try {
    const u = new URL(url, X_ORIGIN);
    return u.origin === X_ORIGIN ? (WATCHED_PATH.exec(u.pathname)?.[1] as WatchedOperation | undefined) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * « Je le suis » selon la réponse de X, ou `undefined` si elle ne le dit pas. X omet souvent le
 * champ quand il vaut faux : un bloc `relationship_perspectives` présent sans lui vaut donc non.
 */
function readFollowing(r: Json): boolean | undefined {
  const value: unknown = r.relationship_perspectives?.following ?? r.legacy?.following;
  if (typeof value === 'boolean') return value;
  return r.relationship_perspectives && typeof r.relationship_perspectives === 'object' ? false : undefined;
}

/**
 * « Il me suit » (badge « Vous suit » du profil) selon la réponse de X, ou `undefined` si elle ne
 * le dit pas. Même lecture que `following` : un bloc `relationship_perspectives` sans le champ (ni
 * dans `legacy`) vaut non.
 */
function readFollowedBy(r: Json): boolean | undefined {
  const value: unknown = r.relationship_perspectives?.followed_by ?? r.legacy?.followed_by;
  if (typeof value === 'boolean') return value;
  return r.relationship_perspectives && typeof r.relationship_perspectives === 'object' ? false : undefined;
}

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
    following: readFollowing(r) ?? false,
    followersCount: typeof followersCount === 'number' && followersCount >= 0 ? followersCount : undefined,
  };
}

const timelineOf = (data: Json): Json =>
  data?.data?.user?.result?.timeline?.timeline ?? data?.data?.user?.result?.timeline_v2?.timeline;

function* timelineEntries(timeline: Json): Generator<Json> {
  for (const instruction of timeline?.instructions ?? []) {
    if (Array.isArray(instruction.entries)) yield* instruction.entries;
    if (instruction.entry) yield instruction.entry;
  }
}

/**
 * Page de la liste des abonnés, ou `undefined` si la réponse n'en contient pas (erreur renvoyée
 * avec un statut 200, format inattendu) : seule une vraie page peut annoncer la fin de la liste.
 */
export function parseFollowersPage(data: Json, previousCursor?: string): FollowersPage | undefined {
  const timeline = timelineOf(data);
  if (!Array.isArray(timeline?.instructions)) return undefined;
  const users: Profile[] = [];
  let skipped = 0;
  let nextCursor: string | undefined;
  for (const entry of timelineEntries(timeline)) {
    const content = entry?.content;
    if (content?.cursorType === 'Bottom' || String(entry?.entryId ?? '').startsWith('cursor-bottom')) {
      nextCursor = content?.value;
      continue;
    }
    const result = content?.itemContent?.user_results?.result;
    const user = parseUser(result);
    if (user) {
      const { followersCount: _ignored, ...profile } = user;
      users.push(profile);
    } else if (result?.__typename === 'User') skipped++;
  }
  // Fin de liste : plus de curseur suivant (ou curseur inchangé, ou « 0|… »). Une page vide qui
  // annonce encore une suite n'est pas la fin : x.com la saute et charge la suivante.
  const done = !nextCursor || nextCursor === previousCursor || /^0\|/.test(nextCursor);
  return { users, skipped, nextCursor, done };
}

export function parseUserLookup(data: Json): UserLookup {
  const r = data?.data?.user?.result;
  if (!r) return { status: 'gone' };
  if (r.__typename === 'UserUnavailable') {
    return { status: /suspend/i.test(String(r.reason ?? r.unavailable_message?.text ?? '')) ? 'suspended' : 'gone' };
  }
  const profile = parseUser(r);
  return profile ? { status: 'active', profile, following: readFollowing(r), followedBy: readFollowedBy(r) } : { status: 'gone' };
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
    const raw = new URL(url, X_ORIGIN).searchParams.get('variables');
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
