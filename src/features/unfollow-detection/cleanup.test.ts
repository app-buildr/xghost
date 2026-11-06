import { beforeEach, describe, expect, it } from 'vitest';
import { loadEvents } from '@/features/events/repository';
import { encodeEvent } from '@/domain/events/codec';
import { keys } from '@/shared/storage/keys';
import type { FollowEvent } from '@/shared/types';
import { installFakeChrome, type FakeChrome } from '@/test/fake-chrome';
import { cleanFalseMovements, falseMovements } from './cleanup';

const T1 = 1_700_000_000_000;
const T2 = T1 + 86_400_000 * 3;

const event = (type: FollowEvent['type'], profileId: string, at: number): FollowEvent => ({
  id: `${type === 'departure' ? 'd' : 'a'}:${profileId}:${Math.floor(at / 1000)}`,
  type,
  profileId,
  handle: `u${profileId}`,
  at,
  status: 'active',
  mutual: false,
  seen: true,
});

const batch = (n: number, type: FollowEvent['type'], at: number, from = 1) =>
  Array.from({ length: n }, (_, i) => event(type, String(from + i), at));

describe('falseMovements', () => {
  it('reconnaît un lot de départs revenu d’un coup', () => {
    const events = [...batch(20, 'departure', T1), ...batch(20, 'arrival', T2)];
    expect(falseMovements(events)).toHaveLength(40);
  });

  it('garde un vrai départ isolé suivi d’un retour', () => {
    expect(falseMovements([event('departure', '1', T1), event('arrival', '1', T2)])).toEqual([]);
  });

  it('garde un petit lot (rien ne prouve une erreur)', () => {
    expect(falseMovements([...batch(4, 'departure', T1), ...batch(4, 'arrival', T2)])).toEqual([]);
  });

  it('garde un lot dont seuls quelques comptes sont revenus', () => {
    expect(falseMovements([...batch(20, 'departure', T1), ...batch(5, 'arrival', T2)])).toEqual([]);
  });

  it('garde des retours étalés sur plusieurs dates', () => {
    const returns = batch(10, 'arrival', T2).concat(batch(10, 'arrival', T2 + 1000, 11));
    expect(falseMovements([...batch(20, 'departure', T1), ...returns])).toEqual([]);
  });

  it('un lot presque entier revenu : seuls les comptes revenus sont retirés', () => {
    const removed = falseMovements([...batch(20, 'departure', T1), ...batch(19, 'arrival', T2)]);
    expect(removed).toHaveLength(38);
    expect(removed.some((e) => e.profileId === '20')).toBe(false);
  });
});

describe('cleanFalseMovements', () => {
  let fake: FakeChrome;
  beforeEach(() => {
    fake = installFakeChrome();
  });

  it('retire les mouvements et les conserve à part', async () => {
    const real = event('departure', '99', T1 - 1000);
    await chrome.storage.local.set({
      [keys.events('7')]: [real, ...batch(10, 'departure', T1), ...batch(10, 'arrival', T2)].map(encodeEvent),
    });
    expect(await cleanFalseMovements('7')).toBe(20);
    expect((await loadEvents('7')).map((e) => e.profileId)).toEqual(['99']);
    expect(fake.store.get(keys.repaired('7'))).toHaveLength(20);
  });

  it('sans motif reconnu : rien ne change', async () => {
    await chrome.storage.local.set({ [keys.events('7')]: [event('departure', '1', T1)].map(encodeEvent) });
    expect(await cleanFalseMovements('7')).toBe(0);
    expect(fake.store.has(keys.repaired('7'))).toBe(false);
  });
});
