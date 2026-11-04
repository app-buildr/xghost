import { useState, type ReactNode } from 'react';
import './stats.css';

/** Briques communes aux graphiques du tableau de bord : dates, en-tête, survol, infobulle. */


/** En-tête d'une carte de graphique : titre, sous-titre et, à droite, un chiffre ou une légende. */
export function StatHead({ title, sub, aside }: { title: string; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <figcaption className={`xg-stat__head${aside ? ' xg-stat__head--row' : ''}`}>
      <span>
        <h2 className="xg-stat__title">{title}</h2>
        {sub && <span className="xg-stat__sub">{sub}</span>}
      </span>
      {aside}
    </figcaption>
  );
}

/**
 * Point survolé d'un graphique. `shown` garde le dernier point survolé après la sortie de la
 * souris : l'infobulle conserve son contenu le temps de disparaître en fondu.
 */
export function useChartHover() {
  const [hover, setHover] = useState<number>();
  const [last, setLast] = useState<number>();
  return {
    hover,
    shown: hover ?? last,
    enter: (i: number) => {
      setHover(i);
      setLast(i);
    },
    leave: () => setHover(undefined),
  };
}

/** Zones de survol invisibles, une par point, sur toute la largeur du graphique. */
export function ChartHits({ count, onEnter }: { count: number; onEnter: (i: number) => void }) {
  return (
    <div className="xg-chart__hits" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} onMouseEnter={() => onEnter(i)} />
      ))}
    </div>
  );
}

/**
 * Infobulle d'un graphique, placée à `left` (pourcentage de la largeur) : centrée sur le point,
 * calée à gauche ou à droite près des bords (`index` sur `count` points).
 */
export function ChartTip({
  index,
  count,
  left,
  visible,
  children,
}: {
  index: number;
  count: number;
  left: number;
  visible: boolean;
  children: ReactNode;
}) {
  const side = index < count / 6 ? 'start' : index > (count * 5) / 6 ? 'end' : 'center';
  return (
    <div
      className={`xg-chart__tip xg-chart__tip--${side}${visible ? ' is-visible' : ''}`}
      style={{ left: `${left}%` }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}
