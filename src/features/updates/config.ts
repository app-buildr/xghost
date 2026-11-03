/**
 * Mise à jour maison (même système que Barrage et xCorrect) : xGhost n'est pas sur le
 * Chrome Web Store, il est chargé en mode développeur et Chrome ne le met donc jamais à
 * jour. La dernière release publiée sur GitHub est relevée régulièrement ; quand elle est
 * plus récente, l'icône et la page d'options le signalent, avec le guide de mise à jour.
 */

export const REPO = 'app-buildr/xghost';
/** Dernière release publiée (API GitHub, CORS ouvert : aucune permission nécessaire). */
export const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
/** Archive de la dernière version. */
export const DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/xghost.zip`;
/** Guide de mise à jour du site. */
export const UPDATE_GUIDE_URL = 'https://app-buildr.github.io/xghost/#mise-a-jour';
/** Intervalle entre deux vérifications, en plus du démarrage et de l'ouverture des options. */
export const UPDATE_CHECK_MINUTES = 6 * 60;
