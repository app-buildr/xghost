import { useStorageQuery } from '@/shared/hooks/useStorageQuery';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import { IconRefresh } from '@/shared/ui/icons';
import { UPDATE_GUIDE_URL } from './config';
import { installedVersion, updateAvailable } from './version';
import './updates.css';

/** Dernière version publiée relevée par le service worker. */
export function useLatestVersion(): string | undefined {
  return useStorageQuery(
    () => localKv.get<string>(keys.latestVersion),
    (k) => k === keys.latestVersion,
    [],
  ).data;
}

/** Bandeau « nouvelle version disponible », avec le lien vers le guide de mise à jour. */
export function UpdateBanner({ compact = false }: { compact?: boolean }) {
  const latest = useLatestVersion();
  if (!updateAvailable(latest)) return null;
  return (
    <section role="status" className={`xg-update${compact ? ' xg-update--compact' : ''}`}>
      <IconRefresh size={20} />
      <div className="xg-update__body">
        <strong>Nouvelle version de xGhost disponible</strong>
        <span>
          Version {latest} publiée, tu as la {installedVersion()}.
        </span>
      </div>
      <a href={UPDATE_GUIDE_URL} target="_blank" rel="noreferrer">
        Comment mettre à jour
      </a>
    </section>
  );
}
