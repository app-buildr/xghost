/**
 * Jetons de couleur (§ 2.1) pour les endroits qui ne lisent pas les variables CSS :
 * Shadow DOM de l'overlay x.com, canvas du favicon, badge `chrome.action`.
 * Miroir exact des variables `--xg-*` de `theme.css`.
 */
export const COLORS = {
  primary: '#0F766E',
  primarySoft: '#CCFBF1',
  danger: '#D4361F',
  ink: '#111318',
  textMuted: '#5B6270',
  textSubtle: '#4B5260',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F2F5',
  track: '#EEF0F3',
  disabledIcon: '#9AA1AD',
} as const;
