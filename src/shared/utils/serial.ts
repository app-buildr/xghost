/**
 * File d'exécution : les tâches passent l'une après l'autre, dans l'ordre d'appel. L'échec
 * d'une tâche est renvoyé à son appelant sans bloquer les suivantes.
 */
export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Se résout quand les tâches déjà en file sont terminées. */
  idle(): Promise<void>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = result.catch(() => undefined);
      return result;
    },
    idle: () => tail.then(() => undefined),
  };
}
