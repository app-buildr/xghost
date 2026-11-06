import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Garde-fous sur les promesses du produit, vérifiés dans le code plutôt qu'à la relecture. */
const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

describe('manifeste', () => {
  const config = readFileSync(join(ROOT, 'wxt.config.ts'), 'utf8');

  it('permissions inchangées (toute nouvelle permission doit passer par ce test)', () => {
    const permissions = /permissions: \[([^\]]*)\]/.exec(config)?.[1]?.match(/'[^']+'/g);
    expect(permissions).toEqual(["'storage'", "'unlimitedStorage'", "'alarms'", "'notifications'", "'cookies'"]);
  });

  it('accès limité à x.com', () => {
    expect(/host_permissions: \[([^\]]*)\]/.exec(config)?.[1]).toBe("'https://x.com/*'");
  });
});

describe('onglets x.com ordinaires', () => {
  it("le script isolé n'utilise pas le contexte de WXT, qui annonce l'extension à la page", () => {
    expect(readFileSync(join(SRC, 'entrypoints/x.ts'), 'utf8')).not.toMatch(/defineContentScript\(/);
    expect(readFileSync(join(ROOT, 'wxt.config.ts'), 'utf8')).toContain("js: ['x.js']");
  });
});

describe('aucune requête fabriquée vers X', () => {
  it('fetch et XMLHttpRequest absents du code, sauf lecture passive et icône locale', () => {
    const allowed = new Set(['entrypoints/x-hook.content.ts', 'features/scan-veil/veil.ts']);
    const found = sources(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => !allowed.has(file))
      .filter((file) => /\bfetch\(|new XMLHttpRequest|sendBeacon|new WebSocket/.test(readFileSync(join(SRC, file), 'utf8')));
    expect(found).toEqual([]);
  });

  it("le hook de page n'appelle fetch que pour transmettre les appels de x.com", () => {
    const hook = readFileSync(join(SRC, 'entrypoints/x-hook.content.ts'), 'utf8');
    expect(hook.match(/\bfetch\(/g) ?? []).toEqual([]);
  });

  it("la seule requête de l'overlay vise l'icône de l'extension", () => {
    const veil = readFileSync(join(SRC, 'features/scan-veil/veil.ts'), 'utf8');
    expect(veil.match(/\bfetch\([^)]*\)?/g)).toEqual(["fetch(chrome.runtime.getURL('/icon/128.png')"]);
  });
});
