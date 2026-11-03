import { describe, expect, it } from 'vitest';
import { createSerialQueue } from './serial';

describe('createSerialQueue', () => {
  it("exécute les tâches l'une après l'autre, dans l'ordre", async () => {
    const queue = createSerialQueue();
    const order: number[] = [];
    const slow = queue.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const fast = queue.run(async () => void order.push(2));
    await Promise.all([slow, fast]);
    expect(order).toEqual([1, 2]);
  });

  it("une tâche en échec ne bloque pas les suivantes, et idle() attend la file", async () => {
    const queue = createSerialQueue();
    await expect(queue.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    let done = false;
    void queue.run(async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    await queue.idle();
    expect(done).toBe(true);
  });
});
