/**
 * Formats X acceptés : valeurs reprises dans des URL et des <img>, lues dans les réponses de X
 * et validées aussi à l'import d'une sauvegarde.
 */
export const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export const ID = /^\d{1,20}$/;
export const AVATAR = /^https:\/\/(pbs|abs)\.twimg\.com\//;

/** Adresses de x.com utilisées par l'interface (le @handle est validé à la lecture des réponses de X). */
export const X_LOGIN_URL = 'https://x.com/login';
export const profileUrl = (handle: string) => `https://x.com/${encodeURIComponent(handle)}`;
