import type { FollowEvent, ImportResult, ScanPauseReason, Settings } from '../types';

/** Pourquoi une vérification n'a pas démarré. */
export type CheckRefusal =
  | 'importing'
  | 'disconnected'
  | 'account-switched'
  | 'follower-limit'
  | 'already-running'
  | 'awaiting-choice'
  | 'baseline-backoff'
  | ScanPauseReason;

/**
 * Messages des interfaces (popup, options, onboarding) vers le service worker.
 * Toutes les écritures passent par le service worker, seul propriétaire des données.
 */
export interface Requests {
  'session:detect': { req: { explicit?: boolean } | void; res: { loggedIn: boolean; accountId?: string; handle?: string } };
  /** `full` : scan complet de toute la liste ; sinon contrôle léger des abonnés les plus récents. */
  'scan:start': { req: { accountId?: string; full?: boolean }; res: { started: boolean; reason?: CheckRefusal } };
  'events:mark-seen': { req: { accountId: string; eventIds: string[] }; res: void };
  'events:delete': { req: { accountId: string; eventId: string }; res: { removed?: FollowEvent } };
  'events:restore': { req: { accountId: string; event: FollowEvent }; res: void };
  'profile:ignore': { req: { accountId: string; profileId: string; ignored: boolean }; res: void };
  /** Affiche l'onglet de scan (quand Chrome le met en pause parce qu'il est caché). */
  'scan:focus': { req: { accountId: string }; res: void };
  /** Abandonne le scan en cours (onboarding, « Arrêter ») : rien n'est gardé comme référence. */
  'scan:stop': { req: { accountId: string }; res: void };
  /** Arrête le scan en cours (bloqué) en le gardant comme incomplet, pour « Continuer le scan ». */
  'scan:interrupt': { req: { accountId: string }; res: void };
  'settings:update': { req: Partial<Settings>; res: void };
  /** Compte affiché par les interfaces (popup, options). */
  'account:select': { req: { accountId: string }; res: void };
  'account:update': { req: { accountId: string; mutualsOnly: boolean }; res: void };
  'account:remove': { req: { accountId: string }; res: void };
  /**
   * Restaure une sauvegarde (l'export se fait directement dans la page d'options) : remplace
   * toutes les données, après validation complète du fichier.
   */
  'data:import': { req: { backup: unknown }; res: ImportResult };
}

export type RequestType = keyof Requests;

/**
 * Traitement de chaque requête pendant l'import d'une sauvegarde. Un nouveau type de message
 * sans politique ne compile pas.
 * - `write` : refusée pendant l'import, et attendue par lui si elle a commencé avant ;
 * - `guarded` : se protège elle-même (test du verrou, ou aucune donnée sauvegardée touchée).
 */
export const REQUEST_POLICY = {
  'session:detect': 'guarded',
  'scan:start': 'guarded',
  'scan:focus': 'guarded',
  'data:import': 'guarded',
  'events:mark-seen': 'write',
  'events:delete': 'write',
  'events:restore': 'write',
  'profile:ignore': 'write',
  'settings:update': 'write',
  'account:update': 'write',
  'account:remove': 'write',
  'account:select': 'write',
  'scan:stop': 'write',
  'scan:interrupt': 'write',
} as const satisfies Record<RequestType, 'write' | 'guarded'>;

export interface Envelope<K extends RequestType = RequestType> {
  xg: K;
  payload: Requests[K]['req'];
}

export type Reply<K extends RequestType> = { ok: true; data: Requests[K]['res'] } | { ok: false; error: string };

/** Opérations GraphQL de x.com lues par xGhost. */
export const WATCHED_OPERATIONS = ['Followers', 'UserByRestId', 'UserByScreenName'] as const;
export type WatchedOperation = (typeof WATCHED_OPERATIONS)[number];

/** Réponse lue par le script de page x.com (monde MAIN), envoyée au script isolé par le canal privé. */
export interface HookMessage {
  op: WatchedOperation;
  url: string;
  status: number;
  body: string;
  rateReset?: number;
  /** Requêtes restantes avant la limite de X (en-tête `x-rate-limit-remaining`). */
  rateRemaining?: number;
}

/** Événements envoyés par les onglets x.com au service worker. */
export type TabEvent =
  | ({ xgTab: 'response' } & HookMessage)
  | { xgTab: 'tick'; visible: boolean; path: string }
  | { xgTab: 'ready'; path: string };

/** Réponse du service worker à `ready` : cet onglet est-il bien l'onglet de scan enregistré ? */
export interface ReadyReply {
  scan: boolean;
}

/**
 * Fragment posé sur l'URL d'ouverture de l'onglet de scan (chargement complet de la page). Le
 * script de page le lit puis l'efface aussitôt, avant tout code de x.com : la page ne le voit
 * jamais. Valeur neutre, sans le nom de l'extension, mais pas un secret (le code est public) : un
 * lien peut le porter. Seul le service worker fait foi, par l'id de l'onglet ; ailleurs, le script
 * de page se retire dès sa réponse.
 */
export const SCAN_MARKER = 'k3v9q';

/**
 * Canal privé entre le script de page (MAIN) et le script isolé de l'onglet de scan.
 * Les deux scripts s'exécutent avant tout code de x.com : le premier port reçu est le
 * bon, et les messages postés plus tard par la page ne peuvent pas s'y glisser. Clé neutre.
 */
export const CHANNEL_PORT = 'k3v9p';
/**
 * Messages du script isolé vers le script de page : `step` fait avancer le rendu simulé ; `stop`
 * retire tout ce que le script de page a installé (onglet ouvert avec le marqueur, mais qui n'est
 * pas l'onglet de scan).
 */
export type HookCommand = { step: 1 } | { stop: 1 };

/**
 * État du scan affiché sur le voile de l'onglet x.com. Les textes arrivent déjà traduits : le
 * script isolé tourne sur tous les onglets x.com, il n'embarque ni les langues ni i18next.
 */
export interface VeilState {
  /** Deux états exclusifs (§ 3.5) : en cours, ou pause imposée par la limite de X. */
  state: 'running' | 'rate-limit';
  /** Progression, de 0 à 100. */
  percent: number;
  resumeAt?: number;
  texts: {
    brand: string;
    handle: string;
    title: string;
    text: string;
    count: string;
    total: string;
    percent: string;
    foot: string;
    /** Reprise : `{{countdown}}` y est remplacé par le compte à rebours, recalculé dans la page. */
    resume: string;
    /** Compte à rebours : formes avec `{{m}}` et `{{s}}`. */
    countdown: { minutesSeconds: string; seconds: string; now: string; unknown: string };
  };
}

/**
 * Commandes sans données : défilement (début, arrêt), clic sur « Réessayer » de x.com, et `ping`
 * (l'onglet de scan ne répond que si le script de page est en place, canal reçu).
 */
export type SimpleTabCommand = 'drive-start' | 'drive-stop' | 'retry' | 'ping';

/** Commandes du service worker vers l'onglet de scan. */
export type TabCommand = { xgCmd: SimpleTabCommand } | ({ xgCmd: 'progress' } & VeilState);
