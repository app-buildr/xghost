import { X_ORIGIN } from '@/shared/x-urls';

/** Lecture de la session X depuis les cookies (§ 4.6) : `auth_token`, `ct0`, `twid`. */

/** Seul l'id du compte est gardé : aucune valeur de cookie n'est conservée ni transmise. */
export interface XSession {
  accountId: string;
}

async function cookie(name: string): Promise<string | undefined> {
  const c = await chrome.cookies.get({ url: X_ORIGIN, name });
  return c?.value || undefined;
}

/** `twid` vaut `u%3D<id>` (ou `u=<id>`). */
export function parseTwid(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = /u=(\d+)/.exec(decodeURIComponent(raw.replace(/^"|"$/g, '')));
  return match?.[1];
}

export async function readSession(): Promise<XSession | null> {
  const [auth, ct0, twid] = await Promise.all([cookie('auth_token'), cookie('ct0'), cookie('twid')]);
  const accountId = parseTwid(twid);
  if (!auth || !ct0 || !accountId) return null;
  return { accountId };
}

/** Appelle `cb` quand le compte connecté change (connexion, déconnexion, bascule). */
export function onSessionCookieChange(cb: () => void): void {
  chrome.cookies.onChanged.addListener(({ cookie: c }) => {
    if (c.domain.endsWith('x.com') && (c.name === 'twid' || c.name === 'auth_token')) cb();
  });
}
