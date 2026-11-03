/** Objet simple (`{…}` issu de JSON ou du stockage) : ni tableau, ni null, ni instance de classe. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
