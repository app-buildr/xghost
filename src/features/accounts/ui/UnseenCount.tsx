import { t } from '@/shared/i18n';
import { formatBadgeCount } from '@/shared/utils/format';

/** Pastille du nombre de départs non vus d'un compte, lisible par les lecteurs d'écran. */
export function UnseenCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="xg-count">
      <span aria-hidden="true">{formatBadgeCount(count)}</span>
      <span className="xg-sr-only">{t('common.badge.unseen', { count })}</span>
    </span>
  );
}
