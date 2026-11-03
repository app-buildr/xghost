import type { ScanProgress } from '@/features/followers-sync/repository';
import { t } from '@/shared/i18n';
import { ProgressBar } from '@/shared/ui/primitives';
import { progressMax } from '../progress';

/** Barre de progression d'un scan en cours (abonnés récupérés sur le total annoncé par X). */
export function ScanProgressBar({ progress }: { progress: Pick<ScanProgress, 'collected' | 'expected'> }) {
  return <ProgressBar value={progress.collected} max={progressMax(progress)} label={t('common.scanStatus.progressLabel')} />;
}
