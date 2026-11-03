import { useMemo, useState } from 'react';
import { useEventActions, type AccountData } from '@/features/app-state/hooks';
import { currentDepartures, stillAbsent, type VisibilityContext } from '@/features/events/selectors';
import type { TrackedAccount } from '@/shared/types';
import { Segmented } from '@/shared/ui/primitives';
import { formatNumber, plural } from '@/shared/utils/format';
import { DepartureRow } from './DepartureRow';

type Filter = 'all' | 'unseen' | 'mutual';

interface Props {
  title: string;
  account: TrackedAccount;
  data: AccountData;
  ctx: VisibilityContext;
  now: number;
  markSeenLocally: (ids: string[] | 'all') => void;
  /** Nombre de lignes affichées ; absent = tout l'historique. */
  limit?: number;
  onShowAll?: () => void;
}

/** Liste « Derniers départs » (§ 3.4) : filtres, « Tout marquer comme vu », actions rapides. */
export function DeparturesPanel({ title, account, data, ctx, now, markSeenLocally, limit, onShowAll }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const actions = useEventActions(account.id, markSeenLocally);

  const all = useMemo(() => currentDepartures(data.events, ctx), [data.events, ctx]);
  const filtered = useMemo(
    () =>
      all.filter((e) =>
        filter === 'unseen' ? !e.seen && stillAbsent(e, data.events) : filter === 'mutual' ? e.mutual : true,
      ),
    [all, filter, data.events],
  );
  const shown = limit ? filtered.slice(0, limit) : filtered;
  const hasUnseen = all.some((e) => !e.seen);

  return (
    <section className="xg-card xg-dep-panel" aria-label={title}>
      <div className="xg-dep-panel__head">
        <h2>{title}</h2>
        <Segmented<Filter>
          label="Filtrer les départs"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tous' },
            { value: 'unseen', label: 'Non vus' },
            { value: 'mutual', label: 'Mutuels' },
          ]}
        />
        <button type="button" className="xg-link" disabled={!hasUnseen} onClick={() => actions.markSeen('all')}>
          Tout marquer comme vu
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="xg-dep-panel__empty">
          {all.length === 0 ? 'Aucun départ pour l’instant. xGhost veille.' : 'Aucun départ pour ce filtre.'}
        </p>
      ) : (
        <ul className="xg-dep-list">
          {shown.map((event) => (
            <DepartureRow
              key={event.id}
              event={event}
              events={data.events}
              profiles={data.profiles}
              baselineAt={account.baselineAt}
              now={now}
              onMarkSeen={() => actions.markSeen([event.id])}
              onCopy={() => void actions.copyHandle(event.handle)}
              onIgnore={() => void actions.ignore(event.profileId, event.handle)}
              onDelete={() => void actions.remove(event)}
            />
          ))}
        </ul>
      )}

      {limit && onShowAll && all.length > 0 && (
        <div className="xg-dep-panel__foot">
          <button type="button" className="xg-link" onClick={onShowAll}>
            Voir tout l’historique ({plural(all.length, 'départ')})
          </button>
        </div>
      )}
    </section>
  );
}
