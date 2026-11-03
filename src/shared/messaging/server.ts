import type { Envelope, Reply, RequestType, Requests } from './protocol';

type Handlers = { [K in RequestType]: (payload: Requests[K]['req']) => Promise<Requests[K]['res']> };

/** Les requêtes ne sont acceptées que des pages de l'extension (popup, options, onboarding). */
const fromExtensionPage = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));

/** Branche les gestionnaires du service worker sur `chrome.runtime.onMessage`. */
export function registerHandlers(handlers: Handlers): void {
  chrome.runtime.onMessage.addListener((message: Partial<Envelope>, sender, sendResponse) => {
    if (!fromExtensionPage(sender) || !message?.xg || !Object.hasOwn(handlers, message.xg)) return false;
    const type = message.xg as RequestType;
    const handler = handlers[type] as (payload: unknown) => Promise<unknown>;
    handler(message.payload)
      .then((data) => sendResponse({ ok: true, data } as Reply<RequestType>))
      .catch((err: unknown) => {
        console.error(`[xGhost] ${type}`, err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  });
}
