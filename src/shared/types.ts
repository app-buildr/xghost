/** Modèles du domaine partagés par le service worker et les interfaces. */

/** Heures entre deux vérifications automatiques ; 0 = manuel uniquement (aucune vérification programmée). */
export type Frequency = 0 | 1 | 6 | 12 | 24;

/** Graphiques du tableau de bord, chacun masquable dans les réglages. */
export const DASHBOARD_CHARTS = ['followers', 'activity', 'net', 'duration', 'retention'] as const;
export type DashboardChart = (typeof DASHBOARD_CHARTS)[number];

export interface Settings {
  frequencyHours: Frequency;
  /** Graphiques masqués du tableau de bord (tous affichés par défaut). */
  hiddenCharts: DashboardChart[];
  /** Reporté en v2 (« Suivre aussi mes abonnements »). */
  trackFollowing: boolean;
  badge: boolean;
  notifications: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  frequencyHours: 6,
  hiddenCharts: [],
  trackFollowing: false,
  badge: true,
  notifications: true,
};

export interface TrackedAccount {
  id: string;
  handle: string;
  name?: string;
  /** Photo de profil du compte (serveur d'images de X), lue avec son profil. */
  avatar?: string;
  addedAt: number;
  /** Date du scan initial (référence), en ms. */
  baselineAt?: number;
  lastScanAt?: number;
  followersCount?: number;
  /** Filtre « Uniquement les mutuels », propre au compte. */
  mutualsOnly: boolean;
  /**
   * Départs repérés par le contrôle léger (total d'abonnés en baisse), pas encore identifiés.
   * `at` : date de la première détection, reprise comme date des départs identifiés ensuite.
   * `full` : le contrôle léger n'a pas pu conclure, un scan complet est nécessaire.
   */
  pending?: { count: number; at: number; full?: boolean };
  /** Couverture du dernier scan complet ou interrompu (§ 4.7). */
  lastScan?: ScanCoverage;
  /** Contrôles légers depuis le dernier scan complet de bout en bout (scan de contrôle tous les 10). */
  quickSinceFull?: number;
  /**
   * Scans de référence lancés automatiquement (compte ajouté, nouvel ordinateur) sans aboutir :
   * nombre d'essais et date du dernier. Le suivant attend de plus en plus longtemps, pour ne
   * jamais rouvrir l'onglet en boucle (onglet fermé par l'utilisateur, compte inaccessible…).
   */
  baselineRetry?: { attempts: number; at: number };
  /**
   * Limite d'abonnés dépassée (§ 4.9, voir `accounts/limit.ts`) : total annoncé par X à la dernière
   * lecture, et date du dépassement. Plus aucun scan ; seul le contrôle léger relit le total.
   */
  limit?: { count: number; at: number };
  /** Résultat du dernier contrôle léger (affiché dans le tableau de bord). */
  lastQuick?: {
    at: number;
    arrivals: number;
    /** Départs récents identifiés directement par le contrôle léger. */
    departed?: number;
    missing: number;
    overflow: boolean;
    /** Total annoncé par X lors de ce contrôle. */
    total?: number;
    /** Contrôles successifs où le total X semblait en retard (revérification, puis scan complet). */
    staleRuns?: number;
    /** Début du contrôle appliqué : une analyse rejouée (service worker arrêté) ne recompte rien. */
    job?: number;
  };
}

/** Pourquoi un scan complet a été lancé (affiché dans le tableau de bord). */
export type ScanReason =
  | 'baseline' // premier scan du premier compte
  | 'new-account' // compte X détecté automatiquement (session x.com basculée sur lui)
  | 'user' // « Scan complet » ou « Continuer le scan »
  | 'missing' // le contrôle léger a vu le total baisser
  | 'overflow' // le contrôle léger n'a pu conclure (trop de nouveaux abonnés)
  | 'incomplete' // le dernier scan était incomplet
  | 'safety' // scan de contrôle périodique (tous les N contrôles légers)
  | 'recheck' // nouvelle vérification d'un résultat suspect
  | 'quick'; // contrôle léger

/** Couverture d'un scan : abonnés annoncés par X face aux abonnés réellement récupérés (§ 4.7). */
export interface ScanCoverage {
  at: number;
  /** « Détectés sur X » : total affiché par X. */
  detected: number;
  /** « Scannés » : ids uniques récupérés. */
  scanned: number;
  complete: boolean;
  /** Arrêt anticipé : nombre d'abonnés réellement relus (la suite était inchangée). */
  stoppedAt?: number;
}

/** Scan incomplet conservé localement : ses ids sont réutilisés par « Continuer le scan » (union). */
export interface PartialScan {
  kind: Exclude<ScanKind, 'quick'>;
  at: number;
  expectedTotal: number;
  collected: Record<string, Omit<Profile, 'id'>>;
}

export type AccountStatus = 'active' | 'suspended' | 'gone';

export interface FollowEvent {
  id: string;
  type: 'departure' | 'arrival';
  profileId: string;
  handle: string;
  /** Date de détection, en ms. */
  at: number;
  status: AccountStatus;
  /** L'utilisateur suivait ce compte au moment de l'événement. */
  mutual: boolean;
  seen: boolean;
}

export interface Profile {
  id: string;
  handle: string;
  name: string;
  avatar?: string;
  /** Je le suis. */
  following: boolean;
}

export interface Snapshot {
  at: number;
  ids: string[];
  total: number;
  /** Nombre d'abonnés annoncé par X au moment de l'instantané. */
  xTotal?: number;
  /**
   * Haut de la liste, dans l'ordre de x.com (du plus récent au plus ancien). Sert au contrôle
   * léger : un abonné récent absent des nouveaux premiers est forcément parti.
   */
  top?: string[];
  /** `ids` est dans l'ordre de x.com (du plus récent au plus ancien). */
  ordered?: boolean;
}

/**
 * - `baseline` : scan complet de référence ;
 * - `check` : scan complet de comparaison ;
 * - `quick` : contrôle léger, sans défilement (total annoncé + première page d'abonnés).
 */
export type ScanKind = 'baseline' | 'check' | 'quick';
export type ScanPauseReason =
  | 'rate-limit'
  | 'needs-focus'
  | 'disconnected'
  | 'account-switched'
  | 'error';

export interface ScanJob {
  accountId: string;
  kind: ScanKind;
  status: 'running' | 'paused';
  startedAt: number;
  updatedAt: number;
  pages: number;
  /** Onglet x.com qui charge la liste des abonnés. */
  tabId?: number;
  /** Dernière page de la liste reçue (détection d'un chargement bloqué). */
  lastProgressAt?: number;
  /** Dernier clic sur « Réessayer » dans la page. */
  retriedAt?: number;
  /** Réponses en erreur de x.com pour la liste depuis la dernière page reçue. */
  failedPages?: number;
  /** x.com affiche son bouton « Réessayer » (chargement refusé) depuis la dernière page reçue. */
  xError?: boolean;
  /** Passage par le profil pour lire le total annoncé par X (une seule fois) : heure du départ. */
  totalLookupAt?: number;
  /** Échecs de l'analyse de fin de scan (nouvel essai sur la liste déjà lue, sans relire). */
  analysisFailures?: number;
  /** Scan terminé : analyse en cours (l'onglet est déjà fermé). */
  finishing?: boolean;
  /** Ids dans l'ordre reçu de x.com (les clés de `collected` ne gardent pas l'ordre). */
  top?: string[];
  /** Départs à trouver avant de pouvoir s'arrêter (écart annoncé par le contrôle léger). */
  target?: number;
  /** Arrêt anticipé : départs trouvés et position atteinte dans l'ancienne liste. */
  earlyStop?: { matchedIndex: number };
  /** Nombre d'abonnés récupérés (tenu à jour, pour ne pas recompter `collected`). */
  count?: number;
  /** Abonnés récupérés jusqu'ici, par id. */
  collected: Record<string, Omit<Profile, 'id'>>;
  /** Nombre d'abonnés annoncé par X au début du scan. */
  expectedTotal: number;
  /** Le total ci-dessus a bien été lu dans la page pendant ce scan. */
  totalSeen?: boolean;
  /** Total connu avant le scan (référence du contrôle léger). */
  baseTotal?: number;
  reason?: ScanReason;
  /** Scan complet : onglet x.com épinglé, sous l'overlay (et non l'onglet caché du contrôle léger). */
  visible?: boolean;
  /** Abonnés repris d'un scan incomplet précédent (union, § 4.7). */
  seeded?: number;
  /** La fin de la liste a été atteinte pendant ce passage. */
  reachedEnd?: boolean;
  /**
   * Des pages ont pu être perdues (service worker relancé en plein scan, la page x.com ayant
   * continué sans lui) : le passage ne peut pas être déclaré complet, ses abonnés sont gardés
   * pour la reprise (union).
   */
  gap?: boolean;
  /** Nombre de pages relues depuis que l'arrêt anticipé est possible (marge de sécurité). */
  earlyStopPages?: number;
  pausedReason?: ScanPauseReason;
  resumeAt?: number;
}

/** Refus d'une sauvegarde à l'import (fichier invalide, version plus récente, trop gros). */
export type BackupError = 'invalid' | 'newer' | 'too-large';
/** Résultat de la restauration d'une sauvegarde (`exportedAt` : date de la sauvegarde importée). */
export type ImportResult = { ok: true; exportedAt: number } | { ok: false; error: BackupError | 'failed' };

export type SessionState = 'ok' | 'disconnected';

export interface GlobalStatus {
  session: SessionState;
  activeAccountId?: string;
  updatedAt: number;
}
