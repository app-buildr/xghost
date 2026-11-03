import { t } from '@/shared/i18n';
import { useStorageQuery } from '@/shared/hooks/useStorageQuery';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import { ExternalLink } from '@/shared/ui/ExternalLink';
import { IconRefresh } from '@/shared/ui/icons';
import { UPDATE_GUIDE_URL } from '../config';
import { installedVersion, updateAvailable } from '../version';
import './updates.css';

/** Bandeau « nouvelle version disponible », avec le lien vers le guide de mise à jour. */
export function UpdateBanner() {
  // Dernière version publiée, relevée par le service worker.
  const latest = useStorageQuery(
    () => localKv.get<string>(keys.latestVersion),
    (k) => k === keys.latestVersion,
    [],
  ).data;
  if (!updateAvailable(latest)) return null;
  return (
    <section role="status" className="xg-update">
      <IconRefresh size={20} />
      <div className="xg-update__body">
        <strong>{t('common.update.title')}</strong>
        <span>{t('common.update.text', { latest, installed: installedVersion() })}</span>
      </div>
      <ExternalLink href={UPDATE_GUIDE_URL}>{t('common.update.howTo')}</ExternalLink>
    </section>
  );
}
