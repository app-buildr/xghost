import { ID, X_ORIGIN } from '@/shared/x-urls';
import { t } from '@/shared/i18n';
import { clearAccountAlarms } from '@/features/scheduler/alarms';
import { importBackup } from '@/features/backup/backup';
import {
  getSelectedAccountId,
  loadAccounts,
  patchAccount,
  selectAccount,
  setIgnored,
  setSelectedAccountId,
  updateAccounts,
} from '@/features/accounts/repository';
import { refreshBadge } from '@/features/alerts/badge';
import { onNotificationClick } from '@/features/alerts/notifications';
import { deleteEvent, forgetSeen, markSeen, restoreEvent } from '@/features/events/commands';
import { forgetUnseen, refreshUnseen } from '@/features/events/repository';
import { deleteAccountData } from '@/features/followers-sync/repository';
import {
  cancelScan,
  closeRestoredScanTab,
  focusScanTab,
  handleTabEvent,
  handleTabLoaded,
  handleTabRemoved,
  isScanTab,
  settleAnalyses,
} from '@/features/followers-sync/scan-engine';
import {
  ensureActiveAccount,
  handleAlarm,
  handleSessionChange,
  setupAlarms,
  abandonScan,
  stopScan,
  triggerCheck,
  updateStatus,
} from '@/features/scheduler/orchestrator';
import { saveSettings } from '@/features/settings/repository';
import { cleanAllFalseMovements } from '@/features/unfollow-detection/cleanup';
import { onSessionCookieChange, readSession } from '@/features/x-api/session';
import { REQUEST_POLICY, type ReadyReply, type RequestType, type TabEvent } from '@/shared/messaging/protocol';
import { registerHandlers } from '@/shared/messaging/server';
import { isImporting } from '@/shared/storage/import-lock';
import { isProgressKey, keys } from '@/shared/storage/keys';
import { localKv } from '@/shared/storage/kv';

/** Identifiant de compte X d'une requête : refusé s'il n'a pas la forme attendue (défense en profondeur). */
const accountIdOf = (id: string): string => {
  if (!ID.test(id)) throw new Error(t('common.errors.invalidRequest'));
  return id;
};

/** Écritures refusées pendant l'import d'une sauvegarde (elles viseraient des données remplacées). */
/** Plusieurs cookies changent d'un coup lors d'une bascule de compte : un seul traitement. */
const SESSION_DEBOUNCE_MS = 1500;

/** Marqueur du stockage de session : le service worker a déjà démarré depuis l'ouverture du navigateur. */
const AWAKE_KEY = 'awake';

const logError = (err: unknown) => console.error(err);

const refuseDuringImport = (type: RequestType) =>
  isImporting() && REQUEST_POLICY[type] === 'write' ? t('common.errors.importing') : undefined;

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(({ reason }) => void onInstalled(reason).catch(logError));
  chrome.runtime.onStartup.addListener(() => void setupAlarms().catch(logError));

  async function onInstalled(reason: string) {
    await setupAlarms();
    if (reason === 'install') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
    }
    // Mise à jour : retire de l'historique les faux départs laissés par les versions précédentes.
    if (reason === 'update') await cleanAllFalseMovements().catch((err) => console.error(err));
    // Déjà connecté à X avant l'installation : aucun cookie ne change, on détecte ici.
    await handleSessionChange();
  }

  chrome.alarms.onAlarm.addListener(({ name }) => {
    void handleAlarm(name).catch(logError);
  });

  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  onSessionCookieChange(() => {
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => void handleSessionChange().catch(logError), SESSION_DEBOUNCE_MS);
  });

  onNotificationClick(() => void chrome.runtime.openOptionsPage());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (keys.scanTab in changes) watchTabUpdates(changes[keys.scanTab]?.newValue !== undefined);
    // Un scan démarre, se met en pause ou se termine : l'icône « scan en cours » suit.
    const statusChanged = Object.entries(changes).some(
      ([k, c]) =>
        isProgressKey(k) &&
        (c.oldValue as { status?: string } | undefined)?.status !== (c.newValue as { status?: string } | undefined)?.status,
    );
    if (statusChanged) void refreshBadge().catch(logError);
  });

  // Onglets x.com : réponses lues dans la page, défilement, onglet de scan prêt.
  chrome.runtime.onMessage.addListener((message: Partial<TabEvent>, sender, sendResponse) => {
    const fromX = sender.id === chrome.runtime.id && !!sender.url?.startsWith(`${X_ORIGIN}/`);
    if (!fromX || !message?.xgTab || sender.tab?.id === undefined) return false;
    void handleTabEvent(message as TabEvent, sender.tab.id).catch((err) => console.error(t('common.log.tabEvent'), err));
    if (message.xgTab === 'ready') {
      // Le script de l'onglet attend ce verdict : sans lui, il retire tout ce qu'il a installé.
      void isScanTab(sender.tab.id).then(
        (scan) => sendResponse({ scan } satisfies ReadyReply),
        () => sendResponse({ scan: false } satisfies ReadyReply),
      );
      return true;
    }
    if (message.xgTab === 'tick') {
      // Rythme du défilement : la réponse arrive après 1,3 à 2 s (minuteur non ralenti ici).
      setTimeout(() => sendResponse({ paced: true }), 1300 + Math.random() * 700);
      return true;
    }
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => void handleTabRemoved(tabId).catch(logError));
  // Onglet de scan rechargé sans son fragment (rechargement par x.com) : relancé. Écouté seulement
  // pendant un scan : sinon chaque page chargée, sur n'importe quel site, réveillerait le service worker.
  const onTabUpdated = (tabId: number, info: { status?: string }, tab: chrome.tabs.Tab) => {
    if (info.status === 'complete') void handleTabLoaded(tabId, tab.url).catch(logError);
  };
  const watchTabUpdates = (scanning: boolean) => {
    if (scanning) chrome.tabs.onUpdated.addListener(onTabUpdated);
    else chrome.tabs.onUpdated.removeListener(onTabUpdated);
  };
  // Ajout seulement : cette lecture ne doit pas défaire un changement arrivé entre-temps. Pendant
  // une pause, une page rechargée service worker éteint est rattrapée à la reprise (`resumeScan`).
  void localKv.get(keys.scanTab).then((tab) => tab && watchTabUpdates(true), logError);

  registerHandlers({
    async 'data:import'({ backup }) {
      const result = await importBackup(backup);
      if (!result.ok) return result;
      // Réglages et comptes restaurés : alarmes, compte actif et statut repartent de là.
      // L'import a réussi : un échec ici ne doit pas être présenté comme un échec d'import.
      await setupAlarms().catch(logError);
      await handleSessionChange().catch(logError);
      return result;
    },
    async 'session:detect'(req) {
      const session = await readSession();
      if (!session) {
        await updateStatus();
        return { loggedIn: false };
      }
      // Enregistre le compte s'il est nouveau (sans rien lancer : l'onboarding attend un choix).
      await handleSessionChange();
      // `explicit` : écran de démarrage (choix de l'utilisateur) ; sinon détection automatique.
      const account = isImporting() ? undefined : await ensureActiveAccount(!!req?.explicit);
      return { loggedIn: true, accountId: session.accountId, handle: account?.handle };
    },
    async 'scan:start'({ accountId, full }) {
      return triggerCheck(full ? 'user-full' : 'user', accountId === undefined ? undefined : accountIdOf(accountId));
    },
    async 'scan:stop'({ accountId }) {
      accountId = accountIdOf(accountId);
      await abandonScan(accountId);
    },
    async 'account:select'({ accountId }) {
      await selectAccount(accountIdOf(accountId));
    },
    async 'scan:interrupt'({ accountId }) {
      accountId = accountIdOf(accountId);
      await stopScan(accountId);
    },
    async 'scan:focus'({ accountId }) {
      accountId = accountIdOf(accountId);
      await focusScanTab(accountId);
    },
    async 'events:mark-seen'({ accountId, eventIds }) {
      accountId = accountIdOf(accountId);
      // Liste d'ids d'événements seulement (défense en profondeur), de taille raisonnable.
      if (!Array.isArray(eventIds) || eventIds.length > 10_000 || !eventIds.every((id) => typeof id === 'string')) {
        throw new Error(t('common.errors.invalidRequest'));
      }
      await markSeen(accountId, eventIds);
    },
    async 'events:delete'({ accountId, eventId }) {
      accountId = accountIdOf(accountId);
      return { removed: await deleteEvent(accountId, eventId) };
    },
    async 'events:restore'({ accountId, event }) {
      accountId = accountIdOf(accountId);
      await restoreEvent(accountId, event);
    },
    async 'profile:ignore'({ accountId, profileId, ignored }) {
      accountId = accountIdOf(accountId);
      await setIgnored(accountId, profileId, ignored);
      await refreshUnseen(accountId);
      await refreshBadge();
    },
    async 'settings:update'(patch) {
      await saveSettings(patch);
      await setupAlarms();
      await refreshBadge();
    },
    async 'account:update'({ accountId, mutualsOnly }) {
      accountId = accountIdOf(accountId);
      await patchAccount(accountId, { mutualsOnly });
      await refreshUnseen(accountId);
      await refreshBadge();
    },
    async 'account:remove'({ accountId }) {
      accountId = accountIdOf(accountId);
      // Compte connecté sur x.com : pas de ré-ajout automatique (seulement après reconnexion).
      if ((await readSession())?.accountId === accountId) await localKv.set({ [keys.dismissed]: accountId });
      await cancelScan(accountId);
      // Analyse de fin de scan déjà lancée : on attend qu'elle finisse, puis on retire ce qu'elle
      // a pu réécrire (scan remis en pause après un échec).
      await settleAnalyses();
      await cancelScan(accountId);
      await updateAccounts((all) => {
        delete all[accountId];
      });
      forgetSeen(accountId);
      await forgetUnseen(accountId);
      await Promise.all([deleteAccountData(accountId), clearAccountAlarms(accountId)]);
      // Compte affiché retiré : on passe au premier restant. Un autre compte affiché ne change pas.
      if ((await getSelectedAccountId()) === accountId) {
        const [next] = Object.keys(await loadAccounts());
        if (next) await setSelectedAccountId(next);
        else await localKv.remove(keys.selectedAccount);
      }
      await refreshBadge();
    },
  }, refuseDuringImport);

  // Premier réveil depuis le démarrage du navigateur, ou depuis que l'extension a été réactivée
  // (stockage de session vide) : détecte la session et reprend un scan interrompu. Les réveils
  // suivants ont leur propre raison (cookies, alarmes, messages) et ne relisent rien ici.
  void chrome.storage.session
    .get(AWAKE_KEY)
    .then(async (stored) => {
      if (stored[AWAKE_KEY]) return;
      await chrome.storage.session.set({ [AWAKE_KEY]: true });
      // Avant la reprise : sinon le nouvel onglet ferait passer l'ancien pour celui du scan.
      await closeRestoredScanTab().catch(logError);
      await handleSessionChange();
    })
    .catch(logError);
});
