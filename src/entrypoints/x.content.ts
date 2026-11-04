import { releaseVeil, showVeil, updateVeil } from '@/features/scan-veil/veil';
import { watchedOperation } from '@/features/x-api/parse';
import {
  CHANNEL_PORT,
  SCAN_MARKER,
  SCAN_WINDOW_NAME,
  type HookMessage,
  type StepMessage,
  type TabCommand,
  type TabEvent,
  type VeilState,
} from '@/shared/messaging/protocol';

/**
 * Script isolé sur x.com, actif seulement dans l'onglet de scan :
 * - reçoit du script de page, par un canal privé, les réponses lues dans x.com et les
 *   relaie au service worker ;
 * - fait défiler la liste des abonnés pour que x.com charge les pages suivantes.
 *
 * Dans les autres onglets x.com, il s'arrête dès le chargement : il n'écoute rien et
 * n'envoie rien.
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  runAt: 'document_start',
  main() {
    // Onglets x.com de l'utilisateur : rien à faire. L'onglet de scan est ouvert avec `#xghost` ;
    // le script de page lui donne ensuite son nom de fenêtre, qui survit aux navigations.
    const isScanTab = location.hash === `#${SCAN_MARKER}` || window.name === SCAN_WINDOW_NAME;
    if (!isScanTab) return;

    const emit = (event: TabEvent) => void chrome.runtime.sendMessage(event).catch(() => undefined);

    // --- Canal privé avec le script de page (le premier port reçu est le seul accepté) ---
    let port: MessagePort | undefined;
    const onWindowMessage = (e: MessageEvent) => {
      if (e.source !== window || port) return;
      if (e.data?.[CHANNEL_PORT] === 1 && e.ports[0]) {
        port = e.ports[0];
        window.removeEventListener('message', onWindowMessage);
        port.onmessage = (m: MessageEvent<Partial<HookMessage>>) => {
          const { op, url, status, body, rateReset, rateRemaining } = m.data ?? {};
          if (!op || !url || typeof status !== 'number' || watchedOperation(url) !== op) return;
          emit({ xgTab: 'response', op, url, status, body: body ?? '', rateReset, rateRemaining });
        };
        emit({ xgTab: 'ready', path: location.pathname });
      }
    };
    window.addEventListener('message', onWindowMessage);

    let driving = false;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const lastCell = () => {
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      return cells[cells.length - 1] as HTMLElement | undefined;
    };

    async function drive() {
      while (driving) {
        lastCell()?.scrollIntoView({ block: 'end' });
        window.scrollBy(0, 1600);
        // Onglet caché : fait avancer le rendu simulé de la page (voir hidden-render).
        port?.postMessage({ step: 1 } satisfies StepMessage);
        // Le rythme vient du service worker : Chrome ralentit fortement les minuteurs
        // d'un onglet caché, pas les réponses aux messages.
        const paced = await chrome.runtime
          .sendMessage({
            xgTab: 'tick',
            visible: document.visibilityState === 'visible',
            path: location.pathname,
          } satisfies TabEvent)
          .catch(() => undefined);
        if (!paced) await sleep(1500);
      }
    }

    /**
     * Après une erreur (limite atteinte), x.com affiche un bouton « Réessayer » en bas de liste.
     * On ne clique que ce bouton-là : jamais une fiche d'abonné (qui ouvrirait son profil). Son
     * texte dépend de la langue de X : reconnu en français ou en anglais, sinon c'est le seul
     * bouton de la dernière cellule (sans fiche ni lien), quelle que soit la langue.
     */
    function clickRetry(): boolean {
      const cell = lastCell();
      if (!cell || cell.querySelector('[data-testid="UserCell"], a[href]')) return false;
      const buttons = [...cell.querySelectorAll<HTMLElement>('button, [role="button"]')];
      const button =
        buttons.find((b) => /r[ée]essayer|retry|try again/i.test(b.textContent ?? '')) ??
        (buttons.length === 1 ? buttons[0] : undefined);
      if (!button) return false;
      button.click();
      return true;
    }

    chrome.runtime.onMessage.addListener((cmd: Partial<TabCommand>, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || !cmd?.xgCmd || !port) return false;
      if (cmd.xgCmd === 'drive-start') {
        showVeil();
        if (!driving) {
          driving = true;
          void drive();
        }
      } else if (cmd.xgCmd === 'drive-stop') {
        driving = false; // le voile reste jusqu'à la fermeture de l'onglet
        releaseVeil();
      } else if (cmd.xgCmd === 'progress') {
        updateVeil(cmd as VeilState);
      } else if (cmd.xgCmd === 'retry') {
        sendResponse({ clicked: clickRetry() });
        return false;
      }
      sendResponse({ ok: true });
      return false;
    });

  },
});
