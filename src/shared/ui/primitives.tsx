import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { AVATAR } from '@/shared/x-urls';
import { initials } from '../utils/format';
import logoUrl from './logo.svg';

/** Logo xGhost (fantôme sur fond noir, point corail). */
export function Logo({ size = 36 }: { size?: number }) {
  return <img src={logoUrl} width={size} height={size} alt="" style={{ borderRadius: size * 0.23 }} />;
}

/**
 * Teintes des avatars sans photo, choisies à partir de l'id. À garder en phase avec les classes
 * `.xg-avatar--tone-N` (ui.css) et les variables `--xg-avatar-N-*` (theme.css), N de 0 à 5.
 */
const AVATAR_TONES = 6;
const MUTED_TONE = 5;

function toneFor(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % AVATAR_TONES;
}

export function Avatar({
  id,
  name,
  src,
  size = 48,
  muted = false,
}: {
  id: string;
  name: string;
  src?: string;
  size?: number;
  muted?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const tone = muted ? MUTED_TONE : toneFor(id);
  return (
    <span
      className={`xg-avatar xg-avatar--tone-${tone}${muted ? ' xg-avatar--muted' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {/* Seules les images de X sont chargées : une URL d'une autre origine (sauvegarde modifiée…) est ignorée. */}
      {src && AVATAR.test(src) && !failed ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="xg-toggle"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * Choix exclusif (groupe de boutons radio) : un seul arrêt de tabulation, flèches pour
 * changer de choix, comme un groupe radio natif.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className = 'xg-segmented',
}: {
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** Apparence : contrôle segmenté par défaut, ou une autre classe (ex. grandes tuiles de l'onboarding). */
  className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  const thumb = useSlidingIndicator(buttons, current, 'x');
  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const target = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : step ? current + step : undefined;
    if (target === undefined) return;
    e.preventDefault();
    const next = (target + options.length) % options.length;
    onChange(options[next]!.value);
    buttons.current[next]?.focus();
  };
  return (
    <div className={className} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {/* Pastille de l'option choisie : elle glisse d'une option à l'autre. */}
      <span className="xg-segmented__thumb" style={thumb} aria-hidden="true" />
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === current}
          tabIndex={i === current ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Pastille glissante sous l'élément choisi (sélecteur segmenté, menu de navigation) : position
 * et taille mesurées sur l'élément, remesurées quand le conteneur change de taille. `x` : la
 * pastille glisse horizontalement, `y` : verticalement. Pas d'animation au premier affichage.
 */
export function useSlidingIndicator(
  items: { current: (HTMLElement | null)[] },
  current: number,
  axis: 'x' | 'y',
): CSSProperties {
  const [box, setBox] = useState({ offset: 0, size: 0, cross: 0, ready: false });
  useLayoutEffect(() => {
    const item = items.current[current];
    const parent = item?.parentElement;
    if (!item || !parent) return;
    const measure = () =>
      setBox((b) => ({
        offset: axis === 'x' ? item.offsetLeft : item.offsetTop,
        size: axis === 'x' ? item.offsetWidth : item.offsetHeight,
        cross: axis === 'x' ? item.offsetHeight : item.offsetWidth,
        ready: b.size > 0,
      }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [items, current, axis]);
  return {
    [axis === 'x' ? 'width' : 'height']: box.size,
    ...(axis === 'y' ? { width: box.cross } : {}),
    transform: axis === 'x' ? `translateX(${box.offset}px)` : `translateY(${box.offset}px)`,
    opacity: box.size ? 1 : 0,
    transition: box.ready ? undefined : 'none',
  };
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="xg-progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className="xg-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Tuile de chiffre (indicateurs du tableau de bord, statistiques de la popup). */
export function StatTile({
  label,
  value,
  tone,
  hint,
  size = 'md',
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'primary';
  hint?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`xg-stat xg-stat--${size}${size === 'md' ? ' xg-card' : ''}`}>
      <span className="xg-stat__label">{label}</span>
      <strong className={`xg-stat__value${tone ? ` xg-stat__value--${tone}` : ''}`}>{value}</strong>
      {hint && <span className="xg-stat__hint">{hint}</span>}
    </div>
  );
}
