import type { DayBucket } from '@/features/events/selectors';
import { formatDate } from '@/shared/utils/format';

/**
 * Graphique sur 30 jours (§ 3.4) : arrivées vers le haut (teal), départs vers le bas (corail).
 * Les deux séries se distinguent aussi par le sens des barres, pas seulement la couleur.
 */
export function ActivityChart({ buckets }: { buckets: DayBucket[] }) {
  const width = 900;
  const half = 44;
  const height = half * 2 + 4;
  const max = Math.max(1, ...buckets.flatMap((b) => [b.arrivals, b.departures]));
  const slot = width / Math.max(1, buckets.length);
  const bar = Math.max(4, slot - 6);
  const scale = (n: number) => (n === 0 ? 0 : Math.max(3, (n / max) * half));
  const totalA = buckets.reduce((s, b) => s + b.arrivals, 0);
  const totalD = buckets.reduce((s, b) => s + b.departures, 0);

  return (
    <figure className="xg-chart">
      <figcaption className="xg-chart__head">
        <span>30 derniers jours</span>
        <span className="xg-chart__legend">
          <span>
            <i style={{ background: 'var(--xg-primary)' }} /> Arrivées
          </span>
          <span>
            <i style={{ background: 'var(--xg-accent)' }} /> Départs
          </span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="xg-chart__svg"
        role="img"
        aria-label={`30 derniers jours : ${totalA} arrivées, ${totalD} départs`}
      >
        <line x1="0" x2={width} y1={half + 2} y2={half + 2} stroke="var(--xg-surface-muted)" />
        {buckets.map((b, i) => {
          const x = i * slot + (slot - bar) / 2;
          const up = scale(b.arrivals);
          const down = scale(b.departures);
          const label = `${formatDate(b.day)} : ${b.arrivals} arrivée(s), ${b.departures} départ(s)`;
          return (
            <g key={b.day}>
              <title>{label}</title>
              {/* Zone de survol pleine hauteur pour l'infobulle. */}
              <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
              {up > 0 && <rect x={x} y={half - up} width={bar} height={up} rx={2} fill="var(--xg-primary)" />}
              {down > 0 && <rect x={x} y={half + 4} width={bar} height={down} rx={2} fill="var(--xg-accent)" />}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
