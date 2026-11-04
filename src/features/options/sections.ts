/** Sections de la page d'options (ancre de l'URL : `options.html#settings`). */
export const OPTION_SECTIONS = ['dashboard', 'departures', 'arrivals', 'settings'] as const;
export type OptionSection = (typeof OPTION_SECTIONS)[number];
