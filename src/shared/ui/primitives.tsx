import { useState, type ReactNode } from 'react';
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
      {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : initials(name)}
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

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="xg-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="xg-progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="xg-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
