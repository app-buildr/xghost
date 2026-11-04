import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { AVATAR } from '@/features/x-api/parse';
import { initials } from '../utils/format';
import logoUrl from './logo.svg';

/** Logo xGhost (fantôme sur fond noir, point corail). */
export function Logo({ size = 36 }: { size?: number }) {
  return <img src={logoUrl} width={size} height={size} alt="" style={{ borderRadius: size * 0.23 }} />;
}

// Paires fond/texte des avatars (§ 2.1), choisies à partir de l'id du compte.
const AVATAR_COLORS: [string, string][] = [
  ['#FFE1D6', '#8F2414'],
  ['#CCFBF1', '#115E59'],
  ['#E3F2EA', '#1C5C3A'],
  ['#F3E8FF', '#5B2A86'],
  ['#FFF1D6', '#7A4A00'],
  ['#EEF0F3', '#4B5260'],
];

function colorFor(id: string): [string, string] {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
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
  const [bg, fg] = muted ? AVATAR_COLORS[5]! : colorFor(id);
  return (
    <span
      className={`xg-avatar${muted ? ' xg-avatar--muted' : ''}`}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.36 }}
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
  const thumb = useSegmentThumb(buttons, current);
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
 * Position et largeur de la pastille glissante, mesurées sur le bouton choisi (et remesurées
 * quand le contrôle change de taille). Pas d'animation au premier affichage.
 */
function useSegmentThumb(buttons: { current: (HTMLButtonElement | null)[] }, current: number): CSSProperties {
  const [box, setBox] = useState<{ x: number; w: number; ready: boolean }>({ x: 0, w: 0, ready: false });
  useLayoutEffect(() => {
    const button = buttons.current[current];
    const parent = button?.parentElement;
    if (!button || !parent) return;
    const measure = () => setBox((b) => ({ x: button.offsetLeft, w: button.offsetWidth, ready: b.w > 0 }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [buttons, current]);
  return {
    width: box.w,
    transform: `translateX(${box.x}px)`,
    opacity: box.w ? 1 : 0,
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
