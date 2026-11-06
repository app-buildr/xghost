import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMarkVisible } from '@/features/app-state/useSeenOnView';
import { useScrollFade } from '@/shared/hooks/useScrollFade';
import { t } from '@/shared/i18n';
import type { FollowEvent } from '@/shared/types';
import { Segmented } from '@/shared/ui/primitives';
import type { EventRowProps } from './EventRow';
import { rowSpacers } from './rowSpacers';
import './events.css';

type Filter = 'all' | 'follow-back';

/** Hauteur d'une ligne tant qu'elle n'a pas été mesurée (celle d'une ligne de la page d'options). */
const ROW_ESTIMATE_PX = 77;
/** Lignes gardées en place de part et d'autre de la zone visible. */
const ROWS_OVERSCAN = 8;

type RenderRow = (event: FollowEvent, rowProps: EventRowProps) => ReactNode;

/**
 * Liste virtualisée : seules les lignes proches de la zone visible existent dans la page, quelle
 * que soit la longueur de l'historique. Elles restent dans le flux, entre deux espaceurs qui
 * tiennent la place des autres (pas du padding : il passerait outre le `max-height` de la liste) ;
 * sans positionnement absolu, la ligne d'un menu ouvert passe au-dessus des suivantes comme
 * d'habitude. Les hauteurs sont mesurées (elles varient avec la largeur).
 * Une ligne compte comme vue quand elle passe réellement à l'écran.
 */
function EventRows({ items, renderRow }: { items: readonly FollowEvent[]; renderRow: RenderRow }) {
  const list = useRef<HTMLUListElement>(null);
  // Clé par événement : une suppression ne décale pas les hauteurs déjà mesurées.
  const getItemKey = useCallback((index: number) => items[index]?.id ?? index, [items]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => list.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: ROWS_OVERSCAN,
    getItemKey,
    useFlushSync: false,
  });
  const rows = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  const mounted = useMemo(() => rows.flatMap((row) => items[row.index] ?? []), [rows, items]);
  // Racine : la fenêtre, dont l'intersection tient aussi compte du défilement de la liste.
  useMarkVisible(list, mounted);
  const fade = useScrollFade(list, total);
  // L'apparition en cascade n'est jouée qu'à l'ouverture, pas par les lignes montées au défilement.
  const [scrolled, setScrolled] = useState(false);
  const { before, after } = rowSpacers(rows, total);

  return (
    <ul
      ref={list}
      className={`xg-dep-list${scrolled ? '' : ' xg-list-in'} xg-scroll${fade.more ? ' xg-scroll-fade' : ''}`}
      onScroll={() => {
        fade.onScroll();
        setScrolled(true);
      }}
    >
      {before > 0 && <li aria-hidden="true" style={{ height: before }} />}
      {rows.map((row) => {
        const event = items[row.index];
        return (
          event &&
          renderRow(event, {
            ref: virtualizer.measureElement,
            'data-index': row.index,
            'aria-posinset': row.index + 1,
            'aria-setsize': items.length,
          })
        );
      })}
      {after > 0 && <li aria-hidden="true" style={{ height: after }} />}
    </ul>
  );
}

/**
 * Carte de liste de mouvements (départs, nouveaux abonnés) : titre, filtre « Tous / Follow back »,
 * états vides, et lien « Voir tout l'historique » quand la liste est limitée.
 * La liste défile à l'intérieur de la carte : plafonnée en hauteur (`--xg-dep-list-max`), ou,
 * avec `fill`, à la hauteur de son conteneur.
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
  renderRow: RenderRow;
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
        <EventRows key={filter} items={shown} renderRow={renderRow} />
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
