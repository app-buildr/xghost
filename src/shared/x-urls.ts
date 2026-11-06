/**
 * Formats X acceptés : valeurs reprises dans des URL et des <img>, lues dans les réponses de X
 * et validées aussi à l'import d'une sauvegarde.
 */
export const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
/** Id X : motif réutilisé par les clés de stockage. */
export const ID_PATTERN = '\\d{1,20}';
export const ID = new RegExp(`^${ID_PATTERN}$`);
export const AVATAR = /^https:\/\/(pbs|abs)\.twimg\.com\//;

/** Adresses de x.com utilisées par l'interface (le @handle est validé à la lecture des réponses de X). */
export const X_ORIGIN = 'https://x.com';
export const X_LOGIN_URL = `${X_ORIGIN}/login`;
export const profileUrl = (handle: string) => `${X_ORIGIN}/${encodeURIComponent(handle)}`;
/** Liste des abonnés d'un compte. */
export const followersUrl = (handle: string) => `${profileUrl(handle)}/followers`;
/** Profil d'un compte par son id (@handle inconnu ou changé). */
export const userIdUrl = (id: string) => `${X_ORIGIN}/i/user/${id}`;
