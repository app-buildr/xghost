/** Adresses de x.com utilisées par l'interface (le @handle est validé à la lecture des réponses de X). */
export const X_LOGIN_URL = 'https://x.com/login';
export const profileUrl = (handle: string) => `https://x.com/${encodeURIComponent(handle)}`;
