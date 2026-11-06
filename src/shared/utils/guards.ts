/** Objet simple (`{…}` issu de JSON ou du stockage) : ni tableau, ni null, ni instance de classe. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/**
 * Accesseur natif d'une propriété : le plus profond de la chaîne de prototypes. Une autre extension
 * peut avoir remplacé une classe du navigateur par une sous-classe, qui n'a pas ces propriétés en propre.
 */
export function nativeGetter(proto: object, name: string): (() => unknown) | undefined {
  let found: (() => unknown) | undefined;
  for (let o: object | null = proto; o; o = Object.getPrototypeOf(o) as object | null) {
    found = Object.getOwnPropertyDescriptor(o, name)?.get ?? found;
  }
  return found;
}
