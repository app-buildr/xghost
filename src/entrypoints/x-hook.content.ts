/**
 * Script injecté dans la page x.com (monde MAIN), avant le code de X.
 *
 * Il ne fait aucune requête : il lit les réponses que x.com reçoit lui-même (liste
 * d'abonnés, profils) et les transmet au script isolé de l'extension.
 *
 * Il n'agit que dans l'onglet ouvert avec le fragment de scan, qu'il efface aussitôt, avant tout
 * code de x.com. Le fragment n'est pas secret : le script isolé demande au service worker si
 * l'onglet est bien l'onglet de scan, et sinon le script de page retire tout ce qu'il a installé.
 * Après un rechargement sans ce fragment, le service worker rouvre la page avec (il connaît
 * l'onglet de scan par son id).
 *
 * Les réponses passent par un `MessageChannel` privé, échangé avant tout code de x.com. Les
 * méthodes utilisées (lecture des réponses, envoi sur le canal) sont capturées au démarrage, et
 * l'URL et le statut transmis sont lus sur la réponse elle-même : un script de la page ne peut pas
 * faire passer le contenu d'une autre ressource pour une réponse de X.
 */

import { installHiddenRenderShim } from '@/features/hidden-render/shim';
import { watchedOperation } from '@/features/x-api/parse';
import { nativeGetter } from '@/shared/utils/guards';
import {
  CHANNEL_PORT,
  SCAN_MARKER,
  type HookMessage,
} from '@/shared/messaging/protocol';

export default defineContentScript({
  matches: ['https://x.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    if (location.hash !== `#${SCAN_MARKER}`) return;
    // Fragment effacé avant tout code de x.com : l'URL vue par la page est l'URL normale.
    history.replaceState(history.state, '', location.pathname + location.search);

    // Originaux capturés avant tout code de x.com : un script de la page qui remplacerait
    // ces méthodes plus tard ne peut ni lire ni falsifier ce qui part vers l'extension.
    const responseText = Response.prototype.text;
    const responseClone = Response.prototype.clone;
    const responseUrl = nativeGetter(Response.prototype, 'url');
    const responseStatus = nativeGetter(Response.prototype, 'status');
    const xhrUrl = nativeGetter(XMLHttpRequest.prototype, 'responseURL');
    const xhrStatus = nativeGetter(XMLHttpRequest.prototype, 'status');
    const xhrResponseText = nativeGetter(XMLHttpRequest.prototype, 'responseText');
    const xhrHeader = XMLHttpRequest.prototype.getResponseHeader;
    const headersGet = Headers.prototype.get;
    const portPost = MessagePort.prototype.postMessage;
    const addListener = EventTarget.prototype.addEventListener;

    // Rendu maintenu même quand l'onglet est caché (voir hidden-render).
    const shim = installHiddenRenderShim();

    // --- Canal privé vers le script isolé -------------------------------------------
    // Les deux scripts xGhost sont injectés au même moment, avant tout code de x.com :
    // ce message est le premier de la file, avant tout ce que la page pourrait poster.
    const channel = new MessageChannel();
    window.postMessage({ [CHANNEL_PORT]: 1 }, location.origin, [channel.port2]);
    let active = true;
    channel.port1.onmessage = (e: MessageEvent<{ step?: 1; stop?: 1 } | undefined>) => {
      if (e.data?.step === 1) shim.step();
      if (e.data?.stop === 1) stop();
    };

    const post = (url: string, status: number, body: string, header: (name: string) => string | null) => {
      const op = watchedOperation(url);
      if (!op || !active) return;
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

    const open = XMLHttpRequest.prototype.open;
    const hookedOpen = function (this: XMLHttpRequest, ...args: unknown[]) {
      const requested = String(args[1]);
      addListener.call(this, 'loadend', () => {
        // URL et statut lus sur la réponse elle-même, pas sur ce que la page a passé à `open`.
        // Sans URL de réponse (réponse fabriquée par un service worker), celle de la requête.
        const url = String(xhrUrl?.call(this) ?? '') || requested;
        if (!active || !watchedOperation(url)) return;
        const text = this.responseType === '' || this.responseType === 'text';
        const body = text && xhrResponseText ? String(xhrResponseText.call(this)) : '';
        post(url, Number(xhrStatus?.call(this) ?? 0), body, (h) => xhrHeader.call(this, h));
      });
      return (open as (...a: unknown[]) => void).apply(this, args);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = hookedOpen;

    const originalFetch = window.fetch;
    const hookedFetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const res = await originalFetch.call(this, input, init);
      // URL et statut lus sur la réponse elle-même : `input` est fourni par la page.
      const url = String(responseUrl?.call(res) ?? '');
      if (active && watchedOperation(url)) {
        responseText
          .call(responseClone.call(res))
          .then((body) => post(url, Number(responseStatus?.call(res) ?? 0), body, (h) => headersGet.call(res.headers, h)))
          .catch(() => undefined);
      }
      return res;
    } as typeof window.fetch;
    window.fetch = hookedFetch;

    /** Pas l'onglet de scan : la page retrouve ses méthodes natives (sauf si elle les a remplacées). */
    function stop() {
      active = false;
      channel.port1.close();
      shim.uninstall();
      if (window.fetch === hookedFetch) window.fetch = originalFetch;
      if (XMLHttpRequest.prototype.open === hookedOpen) XMLHttpRequest.prototype.open = open;
    }
  },
});
