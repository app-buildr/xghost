import { describe, expect, it } from 'vitest';
import { rowSpacers } from './rowSpacers';

describe('rowSpacers', () => {
  it('réserve toute la hauteur tant qu’aucune ligne n’est montée', () => {
    expect(rowSpacers([], 7700)).toEqual({ before: 0, after: 7700 });
  });

  it('ne réserve rien quand toutes les lignes sont montées', () => {
    const rows = [
      { start: 0, end: 77 },
      { start: 77, end: 154 },
    ];
    expect(rowSpacers(rows, 154)).toEqual({ before: 0, after: 0 });
  });

  it('garde la hauteur totale au milieu de la liste', () => {
    const rows = [
      { start: 770, end: 847 },
      { start: 847, end: 943 },
    ];
    const { before, after } = rowSpacers(rows, 7700);
    expect(before).toBe(770);
    expect(after).toBe(6757);
    expect(before + (943 - 770) + after).toBe(7700);
  });

  it('ne réserve rien après la dernière ligne', () => {
    expect(rowSpacers([{ start: 7623, end: 7700 }], 7700)).toEqual({ before: 7623, after: 0 });
  });
});
