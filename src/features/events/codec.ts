import { HANDLE, ID } from '@/features/x-api/parse';
import type { AccountStatus, FollowEvent } from '@/shared/types';

/**
 * Format compact des événements (§ 5.3), pour limiter la place prise par l'historique :
 * tuple [type, profileId, handle, date en secondes, statut, mutuel, vu].
 */
export type CompactEvent = [0 | 1, string, string, number, 0 | 1 | 2, 0 | 1, 0 | 1];

const STATUS: AccountStatus[] = ['active', 'suspended', 'gone'];

export function eventId(type: FollowEvent['type'], profileId: string, at: number): string {
  return `${type === 'departure' ? 'd' : 'a'}:${profileId}:${Math.floor(at / 1000)}`;
}

export function encodeEvent(e: FollowEvent): CompactEvent {
  return [
    e.type === 'departure' ? 0 : 1,
    e.profileId,
    e.handle,
    Math.floor(e.at / 1000),
    STATUS.indexOf(e.status) as 0 | 1 | 2,
    e.mutual ? 1 : 0,
    e.seen ? 1 : 0,
  ];
}

/** Dates acceptées, en secondes : de 2006 (création de Twitter) à 2100. */
const MIN_SECONDS = 1_136_073_600;
const MAX_SECONDS = 4_102_444_800;

/**
 * Événement compact bien formé. Les données lues (stockage, sauvegarde importée) passent
 * par ce test : une entrée corrompue est ignorée au lieu de faire planter l'extension.
 */
export function isCompactEvent(v: unknown): v is CompactEvent {
  if (!Array.isArray(v) || v.length !== 7) return false;
  const [type, profileId, handle, seconds, status, mutual, seen] = v as unknown[];
  return (
    (type === 0 || type === 1) &&
    typeof profileId === 'string' &&
    ID.test(profileId) &&
    typeof handle === 'string' &&
    (HANDLE.test(handle) || ID.test(handle)) &&
    Number.isSafeInteger(seconds) &&
    (seconds as number) >= MIN_SECONDS &&
    (seconds as number) <= MAX_SECONDS &&
    (status === 0 || status === 1 || status === 2) &&
    (mutual === 0 || mutual === 1) &&
    (seen === 0 || seen === 1)
  );
}

/** Événements compacts valides d'une valeur lue (tout ce qui n'est pas un tableau d'événements est ignoré). */
export const compactEventsOf = (value: unknown): CompactEvent[] =>
  Array.isArray(value) ? value.filter(isCompactEvent) : [];

export function decodeEvent(c: CompactEvent): FollowEvent {
  const type = c[0] === 0 ? 'departure' : 'arrival';
  const at = c[3] * 1000;
  return {
    id: eventId(type, c[1], at),
    type,
    profileId: c[1],
    handle: c[2],
    at,
    status: STATUS[c[4]] ?? 'active',
    mutual: c[5] === 1,
    seen: c[6] === 1,
  };
}

/**
 * Dédoublonnage (§ 5.4) : un même mouvement peut être détecté deux fois (scan repris, réparation).
 * Deux événements du même type, pour le même compte, le même jour, et **sans mouvement
 * inverse entre eux** sont un doublon : on garde le premier (« vu » fusionné).
 * Départ, retour puis nouveau départ le même jour : les trois sont conservés.
 */
export function dedupeEvents(events: FollowEvent[]): FollowEvent[] {
  // Jour local (comme le graphe et les bilans), pas le jour UTC.
  const day = (at: number) => new Date(at).toDateString();
  const kept: FollowEvent[] = [];
  const lastIndex = new Map<string, number>(); // dernier événement conservé par compte
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const i = lastIndex.get(e.profileId);
    const previous = i === undefined ? undefined : kept[i];
    if (previous && previous.type === e.type && day(previous.at) === day(e.at)) {
      kept[i!] = { ...previous, seen: previous.seen || e.seen };
      continue;
    }
    lastIndex.set(e.profileId, kept.length);
    kept.push(e);
  }
  return kept.sort((a, b) => b.at - a.at);
}
