import { describe, expect, it } from 'vitest';
import { pickLanguage } from './index';
import { en, fr } from './locales';

/** Clés « a.b.c » d'un objet de traduction (suffixes de pluriel ramenés à la clé de base). */
function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v ? keys(v, `${prefix}${k}.`) : [`${prefix}${k.replace(/_(zero|one|two|few|many|other)$/, '')}`],
  );
}

describe('traductions', () => {
  it('fr et en ont les mêmes clés', () => {
    expect([...new Set(keys(en))].sort()).toEqual([...new Set(keys(fr))].sort());
  });

  it('les variables {{x}} sont les mêmes dans les deux langues', () => {
    const vars = (s: string) => [...s.matchAll(/{{\s*(\w+)/g)].map((m) => m[1]).sort();
    const flat = (obj: object, prefix = ''): Record<string, string> =>
      Object.fromEntries(
        Object.entries(obj).flatMap(([k, v]) =>
          typeof v === 'object' && v ? Object.entries(flat(v, `${prefix}${k}.`)) : [[`${prefix}${k}`, String(v)]],
        ),
      );
    const f = flat(fr);
    const e = flat(en);
    const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, '');
    const varsByBase = (m: Record<string, string>) => {
      const out: Record<string, Set<string>> = {};
      for (const [k, v] of Object.entries(m)) for (const x of vars(v)) (out[base(k)] ??= new Set()).add(x!);
      return Object.fromEntries(Object.entries(out).map(([k, s]) => [k, [...s].sort()]));
    };
    expect(varsByBase(e)).toEqual(varsByBase(f));
  });

  it('choisit la langue du navigateur, anglais par défaut', () => {
    expect(pickLanguage('fr-FR')).toBe('fr');
    expect(pickLanguage('fr')).toBe('fr');
    expect(pickLanguage('en-GB')).toBe('en');
    expect(pickLanguage('de-DE')).toBe('en');
  });
});
