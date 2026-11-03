import { localKv, SYNC_QUOTA_BYTES, SYNC_QUOTA_BYTES_PER_ITEM, syncKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { FollowEvent } from '@/shared/types';
import { chunkEvents, decodeEvent, dedupeEvents, type CompactEvent } from './codec';

/**
 * Événements d'un compte (§ 5.2, 5.3) :
 * - les N plus récents en `storage.sync`, découpés en clés de moins de 8 Ko ;
 * - les plus anciens en archive locale.
 */

const SYNC_WINDOW = 500;
/** Marge laissée aux réglages, comptes et autres comptes suivis. */
const SYNC_BUDGET_RATIO = 0.8;

export async function loadEvents(accountId: string): Promise<FollowEvent[]> {
  const count = (await syncKv.get<number>(keys.eventChunkCount(accountId))) ?? 0;
  const chunkKeys = Array.from({ length: count }, (_, i) => keys.eventChunk(accountId, i));
  const [chunks, archive] = await Promise.all([
    syncKv.getMany(chunkKeys),
    localKv.get<CompactEvent[]>(keys.archive(accountId)),
  ]);
  const recent = chunkKeys.flatMap((k) => (chunks[k] as CompactEvent[] | undefined) ?? []);
  return dedupeEvents([...recent, ...(archive ?? [])].map(decodeEvent));
}

async function saveEvents(accountId: string, events: FollowEvent[]): Promise<void> {
  const sorted = dedupeEvents(events);
  const previousCount = (await syncKv.get<number>(keys.eventChunkCount(accountId))) ?? 0;

  let window = Math.min(SYNC_WINDOW, sorted.length);
  const keyLength = keys.eventChunk(accountId, 99).length;
  const otherBytes = Math.max(0, (await syncKv.bytesInUse()) - (await accountSyncBytes(accountId, previousCount)));
  const budget = SYNC_QUOTA_BYTES * SYNC_BUDGET_RATIO - otherBytes;

  // Réduit la fenêtre synchronisée tant qu'elle dépasse le budget (§ 7.6).
  let chunks = chunkEvents(sorted.slice(0, window), SYNC_QUOTA_BYTES_PER_ITEM - 200, keyLength);
  while (window > 0 && chunks.length * SYNC_QUOTA_BYTES_PER_ITEM > budget + SYNC_QUOTA_BYTES_PER_ITEM) {
    window = Math.floor(window * 0.75);
    chunks = chunkEvents(sorted.slice(0, window), SYNC_QUOTA_BYTES_PER_ITEM - 200, keyLength);
  }

  const items: Record<string, unknown> = { [keys.eventChunkCount(accountId)]: chunks.length };
  chunks.forEach((chunk, i) => (items[keys.eventChunk(accountId, i)] = chunk));

  const archive = chunkEvents(sorted.slice(window), Number.MAX_SAFE_INTEGER, 0)[0] ?? [];
  await Promise.all([syncKv.set(items), localKv.set({ [keys.archive(accountId)]: archive })]);

  const stale = Array.from({ length: Math.max(0, previousCount - chunks.length) }, (_, i) =>
    keys.eventChunk(accountId, chunks.length + i),
  );
  await syncKv.remove(stale);
}

async function accountSyncBytes(accountId: string, count: number): Promise<number> {
  try {
    const k = [keys.eventChunkCount(accountId), ...Array.from({ length: count }, (_, i) => keys.eventChunk(accountId, i))];
    return await chrome.storage.sync.getBytesInUse(k);
  } catch {
    return 0;
  }
}

export async function deleteAccountEvents(accountId: string): Promise<void> {
  const count = (await syncKv.get<number>(keys.eventChunkCount(accountId))) ?? 0;
  await syncKv.remove([
    keys.eventChunkCount(accountId),
    ...Array.from({ length: count }, (_, i) => keys.eventChunk(accountId, i)),
  ]);
  await localKv.remove(keys.archive(accountId));
}

/** Modifie les événements d'un compte de façon sérialisée (une seule écriture à la fois). */
let queue: Promise<unknown> = Promise.resolve();
export function updateEvents(
  accountId: string,
  mutate: (events: FollowEvent[]) => FollowEvent[] | Promise<FollowEvent[]>,
): Promise<FollowEvent[]> {
  const run = queue.then(async () => {
    const next = await mutate(await loadEvents(accountId));
    await saveEvents(accountId, next);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
