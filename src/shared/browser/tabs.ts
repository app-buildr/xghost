/** Pages de l'extension qui s'ouvrent dans un onglet. */
export type ExtensionPage = '/options.html' | '/onboarding.html';

/**
 * Ouvre une page de l'extension, ou ramène au premier plan l'onglet qui l'affiche déjà
 * (avec la nouvelle ancre, sans rechargement). Les contextes de l'extension elle-même
 * sont visibles sans la permission « tabs ».
 */
export async function focusOrOpenExtensionPage(path: ExtensionPage, hash?: string): Promise<void> {
  const base = chrome.runtime.getURL(path);
  const url = hash ? `${base}#${hash}` : base;
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] });
  const tab = contexts.find((c) => c.tabId >= 0 && c.documentUrl?.startsWith(base));
  if (!tab) {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.update(tab.tabId, hash ? { url, active: true } : { active: true });
  if (tab.windowId >= 0) await chrome.windows.update(tab.windowId, { focused: true });
}
