import type { FollowEvent, Settings } from '../types';

/**
 * Messages des interfaces (popup, options, onboarding) vers le service worker.
 * Toutes les écritures passent par le service worker, seul propriétaire des données.
 */
export interface Requests {
  'session:detect': { req: void; res: { loggedIn: boolean; accountId?: string; handle?: string } };
  /** `full` : scan complet de toute la liste ; sinon contrôle léger des abonnés les plus récents. */
  'scan:start': { req: { accountId?: string; full?: boolean }; res: { started: boolean; reason?: string } };
  'events:mark-seen': { req: { accountId: string; eventIds: string[] | 'all' }; res: void };
  'events:delete': { req: { accountId: string; eventId: string }; res: { removed?: FollowEvent } };
  'events:restore': { req: { accountId: string; event: FollowEvent }; res: void };
  'profile:ignore': { req: { accountId: string; profileId: string; ignored: boolean }; res: void };
  /** Affiche l'onglet de scan (quand Chrome le met en pause parce qu'il est caché). */
  'scan:focus': { req: { accountId: string }; res: void };
  'settings:update': { req: Partial<Settings>; res: void };
  'account:update': { req: { accountId: string; mutualsOnly: boolean }; res: void };
  'account:remove': { req: { accountId: string }; res: void };
  /** Relève la dernière version publiée (à l'ouverture des options). */
  'update:check': { req: void; res: void };
}

export type RequestType = keyof Requests;

export interface Envelope<K extends RequestType = RequestType> {
  xg: K;
  payload: Requests[K]['req'];
}

export type Reply<K extends RequestType> = { ok: true; data: Requests[K]['res'] } | { ok: false; error: string };

/** Réponse lue par le script de page x.com (monde MAIN), envoyée au script isolé par le canal privé. */
export interface HookMessage {
  op: string;
  url: string;
  status: number;
  body: string;
  rateReset?: number;
  /** Requêtes restantes avant la limite de X (en-tête `x-rate-limit-remaining`). */
  rateRemaining?: number;
}

/** Événements envoyés par les onglets x.com au service worker. */
export type TabEvent =
  | { xgTab: 'response'; op: string; url: string; status: number; body: string; rateReset?: number; rateRemaining?: number }
  | { xgTab: 'tick'; visible: boolean; path: string }
  | { xgTab: 'ready'; path: string };

/** Commandes du service worker vers l'onglet de scan. */
/** Fragment d'URL (`#xghost`) et nom de fenêtre qui identifient l'onglet de scan dans la page x.com. */
export const SCAN_MARKER = 'xghost';
export const SCAN_WINDOW_NAME = 'xghost-scan';

/**
 * Canal privé entre le script de page (MAIN) et le script isolé de l'onglet de scan.
 * Les deux scripts s'exécutent avant tout code de x.com : le premier port reçu est le
 * bon, et les messages postés plus tard par la page ne peuvent pas s'y glisser.
 */
export const CHANNEL_PORT = '__xgPort';
/** Message du script isolé vers le script de page : faire avancer le rendu simulé. */
export interface StepMessage {
  step: 1;
}

/** État du scan affiché sur le voile de l'onglet x.com. */
export interface VeilState {
  collected: number;
  /** Abonnés repris d'un scan incomplet (exclus du calcul du temps restant). */
  seeded: number;
  expected: number;
  startedAt: number;
  handle?: string;
  /** Deux états exclusifs (§ 3.5) : en cours, ou pause imposée par la limite de X. */
  state: 'running' | 'rate-limit';
  resumeAt?: number;
}

export type TabCommand =
  | { xgCmd: 'drive-start' | 'drive-stop' | 'retry' }
  | ({ xgCmd: 'progress' } & VeilState);
