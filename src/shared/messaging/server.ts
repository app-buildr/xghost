import { t } from '@/shared/i18n';
import type { Envelope, Reply, RequestType, Requests } from './protocol';

type Handlers = { [K in RequestType]: (payload: Requests[K]['req']) => Promise<Requests[K]['res']> };

/** Les requêtes ne sont acceptées que des pages de l'extension (popup, options, onboarding). */
const fromExtensionPage = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));

/**
 * Branche les gestionnaires du service worker sur `chrome.runtime.onMessage`.
 * `refuse` : renvoie un message d'erreur pour refuser une requête à ce moment-là (ex. une
 * écriture pendant l'import d'une sauvegarde), sans appeler son gestionnaire.
 */
export function registerHandlers(handlers: Handlers, refuse?: (type: RequestType) => string | undefined): void {
  chrome.runtime.onMessage.addListener((message: Partial<Envelope>, sender, sendResponse) => {
    if (!fromExtensionPage(sender) || !message?.xg || !Object.hasOwn(handlers, message.xg)) return false;
    const type = message.xg as RequestType;
    const refusal = refuse?.(type);
    if (refusal) {
      sendResponse({ ok: false, error: refusal });
      return false;
    }
    const handler = handlers[type] as (payload: unknown) => Promise<unknown>;
    handler(message.payload)
      .then((data) => sendResponse({ ok: true, data } as Reply<RequestType>))
      .catch((err: unknown) => {
        console.error(t('common.log.request', { type }), err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  });
}
