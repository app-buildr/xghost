/**
 * Script injecté dans la page x.com (monde MAIN), avant le code de X.
 *
 * Il ne fait aucune requête : il lit les réponses que x.com reçoit lui-même (liste
 * d'abonnés, profils) et les transmet au script isolé de l'extension.
 *
 * Il n'agit que dans l'onglet de scan xGhost (repéré par le fragment `#xghost` de l'URL
 * d'ouverture, puis par le nom de la fenêtre, qui survit aux navigations) : les onglets
 * x.com de l'utilisateur ne sont pas touchés.
 *
 * Les réponses passent par un `MessageChannel` privé, échangé avant tout code de x.com :
 * un script de la page ne peut ni lire ce canal ni y injecter de fausses réponses. Les
 * méthodes utilisées (lecture des réponses, envoi sur le canal) sont capturées au démarrage,
 * pour qu'un remplacement ultérieur par la page ne puisse pas les détourner.
 */

import { installHiddenRenderShim } from '@/features/hidden-render/shim';
import { watchedOperation } from '@/features/x-api/parse';
import {
  CHANNEL_PORT,
  SCAN_MARKER,
  SCAN_WINDOW_NAME,
  type HookMessage,
  type StepMessage,
} from '@/shared/messaging/protocol';

export default defineContentScript({
  matches: ['https://x.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const isScanTab = location.hash === `#${SCAN_MARKER}` || window.name === SCAN_WINDOW_NAME;
    if (!isScanTab) return;
    window.name = SCAN_WINDOW_NAME;

    // Originaux capturés avant tout code de x.com : un script de la page qui remplacerait
    // ces méthodes plus tard ne peut ni lire ni falsifier ce qui part vers l'extension.
    const responseText = Response.prototype.text;
    const responseClone = Response.prototype.clone;
    const xhrResponseText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText')?.get;
    const xhrHeader = XMLHttpRequest.prototype.getResponseHeader;
    const headersGet = Headers.prototype.get;
    const portPost = MessagePort.prototype.postMessage;
    const addListener = EventTarget.prototype.addEventListener;

    // Rendu maintenu même quand l'onglet est caché (voir hidden-render).
    const step = installHiddenRenderShim();

    // --- Canal privé vers le script isolé -------------------------------------------
    // Les deux scripts xGhost sont injectés au même moment, avant tout code de x.com :
    // ce message est le premier de la file, avant tout ce que la page pourrait poster.
    const channel = new MessageChannel();
    window.postMessage({ [CHANNEL_PORT]: 1 }, location.origin, [channel.port2]);
    channel.port1.onmessage = (e: MessageEvent<Partial<StepMessage>>) => {
      if (e.data?.step === 1) step();
    };

    const post = (url: string, status: number, body: string, header: (name: string) => string | null) => {
      const op = watchedOperation(url);
      if (!op) return;
      const reset = header('x-rate-limit-reset');
      const remaining = header('x-rate-limit-remaining');
      const msg: HookMessage = {
        op,
        url,
        status,
        body,
        rateReset: reset ? Number(reset) * 1000 : undefined,
        rateRemaining: remaining ? Number(remaining) : undefined,
      };
      portPost.call(channel.port1, msg);
    };

    /** Les fonctions remplacées se présentent comme les originales (`toString`). */
    const disguise = <T extends object>(patched: T, original: T): T =>
      Object.defineProperty(patched, 'toString', {
        value: () => Function.prototype.toString.call(original),
        configurable: true,
      });

    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = disguise(function (this: XMLHttpRequest, ...args: unknown[]) {
      const url = String(args[1]);
      if (watchedOperation(url)) {
        addListener.call(this, 'loadend', () => {
          const text = this.responseType === '' || this.responseType === 'text';
          const body = text && xhrResponseText ? String(xhrResponseText.call(this)) : '';
          post(url, this.status, body, (h) => xhrHeader.call(this, h));
        });
      }
      return (open as (...a: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open, open);

    const originalFetch = window.fetch;
    window.fetch = disguise(async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const res = await originalFetch.call(this, input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (watchedOperation(url)) {
        responseText
          .call(responseClone.call(res))
          .then((body) => post(url, res.status, body, (h) => headersGet.call(res.headers, h)))
          .catch(() => undefined);
      }
      return res;
    } as typeof window.fetch, originalFetch);
  },
});
