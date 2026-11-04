import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou : aucun texte destiné à l'utilisateur (ni message d'erreur) en dur dans le code.
 * Tout passe par les locales (src/shared/i18n/locales). Les commentaires sont ignorés.
 */
const SRC = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : files(path);
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

/** Retire commentaires de bloc et de ligne (approximation suffisante pour ce code). */
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const LITERAL = /(['"`])((?:\\.|(?!\1).)*)\1/g;
/** Texte humain : lettre accentuée ou apostrophe typographique, ou deux mots ou plus. */
const HUMAN = /[À-ÿ’…]|[A-Za-z]{2,} [A-Za-z]{2,}/;
/** Littéraux techniques tolérés : « … » seul (valeur inconnue), classes CSS, CSS en ligne, polices, URLs. */
const TECHNICAL = /^…$|^xg-|var\(|\bpx\b|rgba|svg|font|https?:|Segoe UI|^[\w-]+ [\w-]+(--[\w-]+)?$/;
/** Attribut lu par l'utilisateur ou un lecteur d'écran, écrit en dur (même un seul mot). */
const TEXT_ATTRIBUTE = /\b(aria-label|title|alt|placeholder|label)="([^"]*[A-Za-zÀ-ÿ][^"]*)"/g;
/** Même chose posée en DOM (overlay x.com) : `setAttribute('aria-label', 'Fermer')`. */
const DOM_ATTRIBUTE = /setAttribute\(\s*'(aria-label|title|alt|placeholder)'\s*,\s*'([^']*[A-Za-zÀ-ÿ][^']*)'/g;
/** Texte entre balises JSX. */
const JSX_TEXT = />\s*([^<>{}\n]*[A-Za-zÀ-ÿ]{2,}[^<>{}\n]*?)\s*</g;

describe('textes', () => {
  it('aucun texte en dur hors des locales', () => {
    const found: string[] = [];
    for (const file of files(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const where = relative(SRC, file);
      for (const line of code.split('\n')) {
        if (/^\s*import\s/.test(line)) continue;
        for (const [, , s] of line.matchAll(LITERAL)) {
          if (s && HUMAN.test(s) && !TECHNICAL.test(s)) found.push(`${where}: ${s}`);
        }
        if (file.endsWith('.tsx')) for (const [, s] of line.matchAll(JSX_TEXT)) if (s && !/[=;()]|^[\w.]+$/.test(s)) found.push(`${where}: ${s}`);
        if (file.endsWith('.tsx')) for (const [, attr, s] of line.matchAll(TEXT_ATTRIBUTE)) found.push(`${where}: ${attr}="${s}"`);
        for (const [, attr, s] of line.matchAll(DOM_ATTRIBUTE)) found.push(`${where}: ${attr}="${s}"`);
      }
    }
    expect(found).toEqual([]);
  });

  it('pages HTML neutres : titre de marque seul, langue posée au montage', () => {
    const pages = join(SRC, 'entrypoints');
    for (const dir of readdirSync(pages)) {
      const html = join(pages, dir, 'index.html');
      if (!statSync(join(pages, dir)).isDirectory()) continue;
      let text: string;
      try {
        text = readFileSync(html, 'utf8');
      } catch {
        continue;
      }
      expect(text, html).not.toMatch(/<html[^>]*\blang=/);
      expect(text.match(/<title>([^<]*)<\/title>/)?.[1], html).toBe('xGhost');
    }
  });
});
