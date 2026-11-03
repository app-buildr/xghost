import { ALARM_UPDATE, checkLatestVersion, scheduleUpdateChecks } from '@/features/updates/check';
import { clearAccountAlarms } from '@/features/scheduler/alarms';
import { loadAccounts, patchAccount, setIgnored, setSelectedAccountId, updateAccounts } from '@/features/accounts/repository';
import { refreshBadge } from '@/features/alerts/badge';
import { onNotificationClick } from '@/features/alerts/notifications';
import { deleteEvent, markSeen, restoreEvent } from '@/features/events/commands';
import { deleteAccountEvents } from '@/features/events/repository';
import { deleteLocalAccountData } from '@/features/followers-sync/repository';
import { cancelScan, focusScanTab, handleTabEvent, handleTabRemoved } from '@/features/followers-sync/scan-engine';
import {
  ensureActiveAccount,
  handleAlarm,
  handleSessionChange,
  setupAlarms,
  triggerCheck,
  updateStatus,
} from '@/features/scheduler/orchestrator';
import { saveSettings } from '@/features/settings/repository';
import { onSessionCookieChange, readSession } from '@/features/x-api/session';
import type { TabEvent } from '@/shared/messaging/protocol';
import { registerHandlers } from '@/shared/messaging/server';
import { keys } from '@/shared/storage/keys';
import { syncKv } from '@/shared/storage/kv';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    await setupAlarms();
    void scheduleUpdateChecks(); // une installation change la version installée
    if (reason === 'install') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
    }
    // Déjà connecté à X avant l'installation : aucun cookie ne change, on détecte ici.
    await handleSessionChange();
  });

  chrome.runtime.onStartup.addListener(async () => {
    await setupAlarms();
    void scheduleUpdateChecks();
    await handleSessionChange();
  });

  chrome.alarms.onAlarm.addListener(({ name }) => {
    if (name === ALARM_UPDATE) void checkLatestVersion();
    else void handleAlarm(name);
  });

  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  onSessionCookieChange(() => {
    // Plusieurs cookies changent d'un coup lors d'une bascule de compte.
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => void handleSessionChange(), 1500);
  });

  onNotificationClick(() => void chrome.runtime.openOptionsPage());

  // Données synchronisées depuis une autre machine : le badge suit (§ 5.3, état « vu »).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (keys.latestVersion in changes) void refreshBadge(); // nouvelle version publiée
      // Un scan démarre, se met en pause ou se termine : l'icône « scan en cours » suit.
      const statusChanged = Object.entries(changes).some(
        ([k, c]) =>
          k.endsWith(':progress') &&
          (c.oldValue as { status?: string } | undefined)?.status !== (c.newValue as { status?: string } | undefined)?.status,
      );
      if (statusChanged) void refreshBadge();
      return;
    }
    if (area !== 'sync') return;
    if (Object.keys(changes).some((k) => k === keys.settings || k === keys.accounts || k.includes(':ev'))) {
      void refreshBadge();
    }
    if (keys.settings in changes) void setupAlarms();
  });

  // Onglets x.com : réponses lues dans la page, défilement, onglet de scan prêt.
  chrome.runtime.onMessage.addListener((message: Partial<TabEvent>, sender, sendResponse) => {
    const fromX = sender.id === chrome.runtime.id && !!sender.url?.startsWith('https://x.com/');
    if (!fromX || !message?.xgTab || sender.tab?.id === undefined) return false;
    void handleTabEvent(message as TabEvent, sender.tab.id).catch((err) => console.error('[xGhost] onglet', err));
    if (message.xgTab === 'tick') {
      // Rythme du défilement : la réponse arrive après 1,3 à 2 s (minuteur non ralenti ici).
      setTimeout(() => sendResponse({ paced: true }), 1300 + Math.random() * 700);
      return true;
    }
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => void handleTabRemoved(tabId));

  registerHandlers({
    async 'update:check'() {
      await checkLatestVersion();
    },
    async 'session:detect'() {
      const session = await readSession();
      if (!session) {
        await updateStatus();
        return { loggedIn: false };
      }
      // Enregistre le compte s'il est nouveau et lance son scan de référence.
      await handleSessionChange();
      const account = await ensureActiveAccount();
      return { loggedIn: true, accountId: session.accountId, handle: account?.handle };
    },
    async 'scan:start'({ full }) {
      return triggerCheck(full ? 'user-full' : 'user');
    },
    async 'scan:focus'({ accountId }) {
      await focusScanTab(accountId);
    },
    async 'events:mark-seen'({ accountId, eventIds }) {
      await markSeen(accountId, eventIds);
    },
    async 'events:delete'({ accountId, eventId }) {
      return { removed: await deleteEvent(accountId, eventId) };
    },
    async 'events:restore'({ accountId, event }) {
      await restoreEvent(accountId, event);
    },
    async 'profile:ignore'({ accountId, profileId, ignored }) {
      await setIgnored(accountId, profileId, ignored);
      await refreshBadge();
    },
    async 'settings:update'(patch) {
      await saveSettings(patch);
      await setupAlarms();
      await refreshBadge();
    },
    async 'account:update'({ accountId, mutualsOnly }) {
      await patchAccount(accountId, { mutualsOnly });
      await refreshBadge();
    },
    async 'account:remove'({ accountId }) {
      await cancelScan(accountId);
      await updateAccounts((all) => {
        delete all[accountId];
      });
      await Promise.all([
        deleteAccountEvents(accountId),
        deleteLocalAccountData(accountId),
        syncKv.remove([keys.ignored(accountId)]),
        clearAccountAlarms(accountId),
      ]);
      const remaining = Object.keys(await loadAccounts());
      if (remaining[0]) await setSelectedAccountId(remaining[0]);
      await refreshBadge();
    },
  });

  // Réveil du service worker : détecte la session et reprend un scan interrompu.
  void handleSessionChange();
});
