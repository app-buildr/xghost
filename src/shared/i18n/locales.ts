/**
 * Textes de l'extension, un fichier par domaine et par langue (locales/<langue>/<domaine>.json).
 * Le français sert de référence pour les types ; un test vérifie que l'anglais a les mêmes clés.
 */
import frBackup from './locales/fr/backup.json';
import frCommon from './locales/fr/common.json';
import frDashboard from './locales/fr/dashboard.json';
import frEngine from './locales/fr/engine.json';
import frFormat from './locales/fr/format.json';
import frOnboarding from './locales/fr/onboarding.json';
import frOptions from './locales/fr/options.json';
import frPopup from './locales/fr/popup.json';
import enBackup from './locales/en/backup.json';
import enCommon from './locales/en/common.json';
import enDashboard from './locales/en/dashboard.json';
import enEngine from './locales/en/engine.json';
import enFormat from './locales/en/format.json';
import enOnboarding from './locales/en/onboarding.json';
import enOptions from './locales/en/options.json';
import enPopup from './locales/en/popup.json';

export const fr = {
  backup: frBackup,
  common: frCommon,
  dashboard: frDashboard,
  engine: frEngine,
  format: frFormat,
  onboarding: frOnboarding,
  options: frOptions,
  popup: frPopup,
};

export const en: typeof fr = {
  backup: enBackup,
  common: enCommon,
  dashboard: enDashboard,
  engine: enEngine,
  format: enFormat,
  onboarding: enOnboarding,
  options: enOptions,
  popup: enPopup,
};
