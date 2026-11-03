import { describe, expect, it } from 'vitest';
import type { FollowEvent } from '@/shared/types';
import { chunkEvents, decodeEvent, dedupeEvents, encodeEvent, eventId } from './codec';

const ev = (over: Partial<FollowEvent> = {}): FollowEvent => {
  const base = {
    type: 'departure' as const,
    profileId: '123456789012345678',
    handle: 'marie_codes',
    at: Date.UTC(2026, 10, 3, 12, 0, 0),
    status: 'active' as const,
    mutual: true,
    seen: false,
    ...over,
  };
  return { id: eventId(base.type, base.profileId, base.at), ...base };
};

describe('codec compact', () => {
  it('encode puis décode sans perte', () => {
    const e = ev({ status: 'suspended', mutual: false, seen: true });
    expect(decodeEvent(encodeEvent(e))).toEqual(e);
  });
});

describe('chunkEvents', () => {
  it('respecte la taille maximale par clé de storage.sync', () => {
    const events = Array.from({ length: 500 }, (_, i) => ev({ profileId: String(10n ** 17n + BigInt(i)), at: 1e12 + i * 1000 }));
    const chunks = chunkEvents(events, 8000, 20);
    expect(chunks.flat()).toHaveLength(500);
    for (const c of chunks) expect(new TextEncoder().encode(JSON.stringify(c)).length + 20).toBeLessThanOrEqual(8000);
  });
});

describe('dedupeEvents', () => {
  it('dédoublonne par (profil, type, jour) en gardant « vu »', () => {
    const a = ev({ at: Date.UTC(2026, 10, 3, 8), seen: false });
    const b = ev({ at: Date.UTC(2026, 10, 3, 14), seen: true });
    const out = dedupeEvents([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ at: a.at, seen: true });
  });
  it('garde départ, retour puis nouveau départ le même jour', () => {
    const out = dedupeEvents([
      ev({ type: 'departure', at: Date.UTC(2026, 10, 3, 8) }),
      ev({ type: 'arrival', at: Date.UTC(2026, 10, 3, 9) }),
      ev({ type: 'departure', at: Date.UTC(2026, 10, 3, 10) }),
    ]);
    expect(out.map((e) => e.type)).toEqual(['departure', 'arrival', 'departure']);
  });
  it('garde deux départs de jours différents', () => {
    expect(dedupeEvents([ev({ at: Date.UTC(2026, 10, 1) }), ev({ at: Date.UTC(2026, 10, 3) })])).toHaveLength(2);
  });
});
