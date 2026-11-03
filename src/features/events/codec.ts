import type { AccountStatus, FollowEvent } from '@/shared/types';

/**
 * Format compact des événements pour `storage.sync` (§ 5.3) :
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
 * Découpe des événements (déjà triés) en morceaux dont la taille sérialisée,
 * clé comprise, reste sous `maxBytes`.
 */
export function chunkEvents(events: FollowEvent[], maxBytes: number, keyLength: number): CompactEvent[][] {
  const chunks: CompactEvent[][] = [];
  let current: CompactEvent[] = [];
  let size = keyLength + 2; // crochets du tableau
  for (const e of events) {
    const compact = encodeEvent(e);
    const itemSize = new TextEncoder().encode(JSON.stringify(compact)).length + 1;
    if (current.length > 0 && size + itemSize > maxBytes) {
      chunks.push(current);
      current = [];
      size = keyLength + 2;
    }
    current.push(compact);
    size += itemSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Dédoublonnage (§ 5.4) : plusieurs ordinateurs peuvent détecter le même mouvement.
 * Deux événements du même type, pour le même compte, le même jour, et **sans mouvement
 * inverse entre eux** sont un doublon : on garde le premier (« vu » fusionné).
 * Départ, retour puis nouveau départ le même jour : les trois sont conservés.
 */
export function dedupeEvents(events: FollowEvent[]): FollowEvent[] {
  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
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
