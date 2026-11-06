import { describe, expect, it } from 'vitest';
import type { FollowEvent } from '@/shared/types';
import { decodeEvent, dedupeEvents, encodeEvent, eventId } from './codec';

const ev = (over: Partial<FollowEvent> = {}): FollowEvent => {
  const base = {
    type: 'departure' as const,
    profileId: '123456789012345678',
    handle: 'marie_codes',
    at: new Date(2026, 10, 3, 12, 0, 0).getTime(),
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

describe('dedupeEvents', () => {
  it('dédoublonne par (profil, type, jour) en gardant « vu »', () => {
    const a = ev({ at: new Date(2026, 10, 3, 8).getTime(), seen: false });
    const b = ev({ at: new Date(2026, 10, 3, 14).getTime(), seen: true });
    const out = dedupeEvents([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ at: a.at, seen: true });
  });
  it('garde départ, retour puis nouveau départ le même jour', () => {
    const out = dedupeEvents([
      ev({ type: 'departure', at: new Date(2026, 10, 3, 8).getTime() }),
      ev({ type: 'arrival', at: new Date(2026, 10, 3, 9).getTime() }),
      ev({ type: 'departure', at: new Date(2026, 10, 3, 10).getTime() }),
    ]);
    expect(out.map((e) => e.type)).toEqual(['departure', 'arrival', 'departure']);
  });
  it('garde deux départs de jours différents', () => {
    expect(dedupeEvents([ev({ at: new Date(2026, 10, 1).getTime() }), ev({ at: new Date(2026, 10, 3).getTime() })])).toHaveLength(2);
  });
});
