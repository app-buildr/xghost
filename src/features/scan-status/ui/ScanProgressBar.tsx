import type { ScanProgress } from '@/features/followers-sync/model';
import { t } from '@/shared/i18n';
import type { ScanCoverage } from '@/shared/types';
import { ProgressBar } from '@/shared/ui/primitives';
import { progressMax } from '../progress';

/** Barre de progression d'un scan en cours (abonnés récupérés sur le total annoncé par X). */
export function ScanProgressBar({ progress }: { progress: Pick<ScanProgress, 'collected' | 'expected'> }) {
  return <ProgressBar value={progress.collected} max={progressMax(progress)} label={t('common.scanStatus.progressLabel')} />;
}

/** Couverture du dernier scan terminé (abonnés relus sur le total annoncé par X). */
export function LastScanBar({ scan, label }: { scan: Pick<ScanCoverage, 'scanned' | 'detected'>; label: string }) {
  return <ProgressBar value={scan.scanned} max={scan.detected || scan.scanned || 1} label={label} />;
}
