import { describe, expect, it } from 'vitest';
import { fromLegacyLayout } from './legacy';

describe('ancien format de stockage', () => {
  it("réunit morceaux et archive dans l'historique du compte, récents d'abord", () => {
    const out = fromLegacyLayout({
      settings: { badge: true },
      machine: 'abc',
      'acc:1:evn': 2,
      'acc:1:ev:1': ['b'],
      'acc:1:ev:0': ['a'],
      'acc:1:archive': ['c'],
      'acc:1:snapshot': { ids: [] },
    });
    expect(out).toEqual({ settings: { badge: true }, 'acc:1:snapshot': { ids: [] }, 'acc:1:events': ['a', 'b', 'c'] });
  });

  it('garde une valeur invalide pour que la validation stricte la refuse', () => {
    expect(fromLegacyLayout({ 'acc:1:ev:0': 5 })).toEqual({ 'acc:1:events': [5] });
  });
});
