import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useMarkVisible } from '@/features/app-state/useSeenOnView';
import { useScrollFade } from '@/shared/hooks/useScrollFade';
import { t } from '@/shared/i18n';
import type { FollowEvent } from '@/shared/types';
import { Segmented } from '@/shared/ui/primitives';
import './events.css';

type Filter = 'all' | 'follow-back';

/**
 * Carte de liste de mouvements (départs, nouveaux abonnés) : titre, filtre « Tous / Follow back »,
 * états vides, et lien « Voir tout l'historique » quand la liste est limitée.
 * `fill` : la carte prend la hauteur de son conteneur et la liste défile à l'intérieur.
 * Une ligne compte comme vue quand elle passe réellement à l'écran.
 */
export function EventListPanel({
  title,
  filterLabel,
  items,
  followsBack,
  empty,
  emptyFiltered,
  renderRow,
  limit,
  onShowAll,
  showAllLabel,
  fill = false,
}: {
  title: string;
  filterLabel: string;
  items: readonly FollowEvent[];
  followsBack: (e: FollowEvent) => boolean;
  empty: string;
  emptyFiltered: string;
  renderRow: (e: FollowEvent) => ReactNode;
  /** Nombre de lignes affichées ; absent = tout l'historique. */
  limit?: number;
  onShowAll?: () => void;
  showAllLabel?: (count: number) => string;
  fill?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter(followsBack)),
    [items, filter, followsBack],
  );
  const shown = useMemo(() => (limit ? filtered.slice(0, limit) : filtered), [filtered, limit]);
  const list = useRef<HTMLUListElement>(null);
  useMarkVisible(list, shown, { scrolls: fill });
  const fade = useScrollFade(list, shown);

  return (
    <section className={`xg-card xg-dep-panel${fill ? ' xg-dep-panel--fill' : ''}`} aria-label={title}>
      <div className="xg-dep-panel__head">
        <h2>{title}</h2>
        <Segmented<Filter>
          label={filterLabel}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('dashboard.filter.all') },
            { value: 'follow-back', label: t('dashboard.filter.followBack') },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <p key={filter} className="xg-dep-panel__empty xg-fade-in">
          {items.length === 0 ? empty : emptyFiltered}
        </p>
      ) : (
        // Clé du filtre : la liste est recréée, ses lignes rejouent leur apparition en cascade.
        <ul
          key={filter}
          ref={list}
          className={`xg-dep-list xg-list-in${fill ? ' xg-scroll' : ''}${fill && fade.more ? ' xg-scroll-fade' : ''}`}
          onScroll={fill ? fade.onScroll : undefined}
        >
          {shown.map(renderRow)}
        </ul>
      )}

      {limit && onShowAll && showAllLabel && items.length > 0 && (
        <div className="xg-dep-panel__foot">
          <button type="button" className="xg-link" onClick={onShowAll}>
            {showAllLabel(items.length)}
          </button>
        </div>
      )}
    </section>
  );
}
