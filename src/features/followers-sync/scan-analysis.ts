import { t } from '@/shared/i18n';
import { importEpoch, isImporting } from '@/shared/storage/import-lock';
import type { ScanJob } from '@/shared/types';
import { MINUTE } from '@/shared/utils/time';
import { scanHooks, serial } from './scan-context';
import { finalizeIncomplete, pause } from './scan-lifecycle';
import { dropJob, getJob, putJob } from './scan-store';
import { closeTab } from './scan-tab';

/** Fin de scan : analyse de la liste lue, nouvel essai, reprise après un arrêt du service worker. */

/** Analyse de fin de scan en échec : nouvel essai après ce délai, sur la liste déjà lue. */
const RETRY_AFTER_ERROR_MS = 15 * MINUTE;
/** Au-delà, l'analyse est abandonnée : scan gardé comme incomplet (« Continuer le scan »). */
const MAX_ANALYSIS_FAILURES = 3;
/** Analyse de fin de scan abandonnée (service worker arrêté) : reprise après ce délai. */
const STALE_FINISH_MS = 2 * MINUTE;

/** Comptes dont l'analyse de fin de scan tourne dans ce service worker. */
const analyzing = new Set<string>();
/** Analyses en cours (toutes comptes confondus), attendues par l'import d'une sauvegarde. */
const inFlight = new Set<Promise<void>>();

/** Attend la fin des analyses déjà lancées (elles écrivent historique, instantané et compte). */
export async function settleAnalyses(): Promise<void> {
  await Promise.all([...inFlight]);
}

export async function finish(job: ScanJob): Promise<void> {
  if (job.finishing) return;
  job.finishing = true;
  job.updatedAt = Date.now();
  await putJob(job);
  // Fin (§ 4.6) : l'onglet se ferme immédiatement, l'analyse se fait ensuite.
  await closeTab(job);
  // `finish` tourne dans la file des événements : l'analyse en sort pour ne pas la bloquer.
  void analyze(job);
}

/**
 * Analyse d'un scan terminé (comparaison, événements, instantané), puis effacement du scan.
 * Un échec de l'analyse met le scan en pause pour un nouvel essai ; ce qui suit l'effacement
 * (statut, enchaînement) ne fait que journaliser ses erreurs, sans ressusciter le scan.
 */
function analyze(job: ScanJob): Promise<void> {
  if (analyzing.has(job.accountId)) return Promise.resolve();
  const run = runAnalysis(job);
  inFlight.add(run);
  void run.finally(() => inFlight.delete(run));
  return run;
}

async function runAnalysis(job: ScanJob): Promise<void> {
  analyzing.add(job.accountId);
  const epoch = importEpoch();
  try {
    try {
      // Import d'une sauvegarde pendant le scan : ses données font foi, l'analyse est abandonnée.
      if (!isImporting() && epoch === importEpoch()) await scanHooks().onComplete(job);
      await dropJob(job.accountId);
    } catch (err) {
      console.error(t('common.log.scanEnd'), err);
      if (epoch !== importEpoch()) return;
      job.analysisFailures = (job.analysisFailures ?? 0) + 1;
      if (job.analysisFailures >= MAX_ANALYSIS_FAILURES) {
        // Échec persistant : on n'insiste pas, les abonnés lus sont gardés pour continuer plus tard.
        await serial(() => finalizeIncomplete(job));
        return;
      }
      // Nouvel essai de l'analyse seule, plus tard : la liste déjà lue est gardée (pas de nouveau
      // scan de toute la liste). Détail technique dans la console ; l'interface affiche un
      // message traduit.
      await serial(() => pause(job, 'error', Date.now() + RETRY_AFTER_ERROR_MS));
      return;
    }
    await scanHooks().onStateChange();
    if (epoch === importEpoch()) await scanHooks().onFinished(job);
  } catch (err) {
    console.error(t('common.log.scanEnd'), err);
  } finally {
    analyzing.delete(job.accountId);
  }
}

/**
 * Scan resté « en analyse » alors qu'aucune analyse ne tourne : le service worker a été arrêté
 * pendant l'analyse. Elle est relancée (elle ne recrée ni départ ni arrivée déjà enregistrés).
 * Renvoie vrai si le scan est en fin d'analyse (récupéré ou en cours).
 */
export function recoverFinishing(accountId: string): Promise<boolean> {
  return serial(async () => {
    const job = await getJob(accountId);
    if (!job?.finishing) return false;
    // Analyse en échec : nouvel essai à l'heure prévue seulement.
    if (job.resumeAt && job.resumeAt > Date.now()) return true;
    const stale = !analyzing.has(accountId) && Date.now() - job.updatedAt > STALE_FINISH_MS;
    if (stale) void analyze(job);
    return true;
  });
}
