import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeChrome } from '@/test/fake-chrome';
import { registerHandlers } from './server';

type Listener = (m: unknown, s: chrome.runtime.MessageSender, r: (v: unknown) => void) => boolean;

function wire() {
  let listener: Listener | undefined;
  (chrome.runtime as unknown as { onMessage: unknown }).onMessage = { addListener: (l: Listener) => (listener = l) };
  return () => listener!;
}

const page = { id: 'test', url: 'chrome-extension://test/options.html' };

describe('registerHandlers', () => {
  beforeEach(() => {
    installFakeChrome();
  });

  it('refuse un expéditeur qui n’est pas une page de l’extension', () => {
    const listener = wire();
    const handler = vi.fn(async () => undefined);
    registerHandlers({ 'scan:stop': handler } as never, () => undefined);
    expect(listener()({ xg: 'scan:stop', payload: {} }, { id: 'test', url: 'https://x.com/home' }, () => undefined)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignore une clé héritée du prototype', () => {
    const listener = wire();
    registerHandlers({} as never, () => undefined);
    expect(listener()({ xg: 'toString', payload: {} }, page, () => undefined)).toBe(false);
  });

  it('une requête refusée n’appelle pas son gestionnaire', () => {
    const listener = wire();
    const handler = vi.fn(async () => undefined);
    const reply = vi.fn();
    registerHandlers({ 'scan:stop': handler } as never, () => 'non');
    listener()({ xg: 'scan:stop', payload: {} }, page, reply);
    expect(handler).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith({ ok: false, error: 'non' });
  });
});
