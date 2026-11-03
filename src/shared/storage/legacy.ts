import { keys } from './keys';

/**
 * Ancien format de stockage (xGhost 1.0) : réglages, comptes, comptes ignorés et historique
 * récent dans `storage.sync` (historique découpé en morceaux `acc:<id>:ev:<n>`, compteur
 * `acc:<id>:evn`), historique ancien dans `acc:<id>:archive`, identifiant d'ordinateur
 * `machine`. Conversion vers le format actuel (une clé d'historique par compte), utilisée pour
 * importer une sauvegarde de la 1.0. Pas de migration automatique : l'extension étant en
 * développement, les données 1.0 se récupèrent en réimportant une sauvegarde.
 */

const LEGACY_EVENTS = /^acc:(\d{1,20}):(?:evn|ev:(\d{1,2})|archive)$/;
const LEGACY_KEYS = new Set(['machine']);

/**
 * Convertit un ensemble de clés (ancien ou nouveau format) vers le format actuel : les morceaux
 * d'historique et l'archive de chaque compte sont réunis dans `acc:<id>:events` (récents
 * d'abord, comme avant). Une valeur qui n'est pas un tableau est gardée telle quelle dans la
 * liste : la validation stricte d'une sauvegarde la refusera, la lecture normale l'ignorera.
 */
export function fromLegacyLayout(items: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const parts = new Map<string, { chunks: [number, unknown][]; archive?: unknown }>();
  for (const [key, value] of Object.entries(items)) {
    const match = LEGACY_EVENTS.exec(key);
    if (!match) {
      if (!LEGACY_KEYS.has(key)) out[key] = value;
      continue;
    }
    const [, accountId, chunk] = match;
    const entry = parts.get(accountId!) ?? { chunks: [] };
    if (chunk !== undefined) entry.chunks.push([Number(chunk), value]);
    else if (key.endsWith(':archive')) entry.archive = value;
    parts.set(accountId!, entry);
  }
  for (const [accountId, { chunks, archive }] of parts) {
    const ordered = chunks.sort(([a], [b]) => a - b).map(([, v]) => v);
    const lists = archive === undefined ? ordered : [...ordered, archive];
    const merged = lists.flatMap((v) => (Array.isArray(v) ? v : [v]));
    const key = keys.events(accountId);
    // Historique déjà au nouveau format (cas improbable de mélange) : on le garde aussi.
    out[key] = Array.isArray(out[key]) ? [...(out[key] as unknown[]), ...merged] : merged;
  }
  return out;
}
