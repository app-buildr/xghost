/** Comparaison de versions « 1.2.3 ». Fonctions pures, testées dans version.test.ts. */

/** `v1.2.3` ou `1.2.3` → `1.2.3`, ou null pour autre chose. */
export function parseVersion(tag: unknown): string | null {
  if (typeof tag !== 'string') return null;
  return /^v?(\d+\.\d+\.\d+)$/.exec(tag.trim())?.[1] ?? null;
}

/**
 * La version publiée `latest` est plus récente que la version installée `current`.
 * Une version installée en avance (en développement) ne déclenche rien, une version
 * illisible non plus.
 */
export function isNewer(latest: string | null | undefined, current: string): boolean {
  const a = parseVersion(latest)?.split('.').map(Number);
  const b = parseVersion(current)?.split('.').map(Number);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Version de l'extension installée. */
export const installedVersion = () => chrome.runtime.getManifest().version;
