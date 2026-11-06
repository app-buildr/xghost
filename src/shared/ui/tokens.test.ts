import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLORS } from './tokens';

describe('jetons de couleur', () => {
  it('sont le miroir exact de theme.css', () => {
    const theme = readFileSync(join(__dirname, 'theme.css'), 'utf8');
    const cssName = (name: string) => `--xg-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    for (const [name, value] of Object.entries(COLORS)) {
      const declared = new RegExp(`${cssName(name)}: (#[0-9a-f]{6});`).exec(theme)?.[1];
      expect(declared, name).toBe(value.toLowerCase());
    }
  });
});
