import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconMore } from './icons';

export interface MenuAction {
  key: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

/**
 * Menu d'actions « … » : fermeture au clic extérieur ou Échap,
 * navigation au clavier (flèches, Début/Fin, Entrée).
 */
export function ActionMenu({ actions, label }: { actions: MenuAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focus(index + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focus(index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focus(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focus(list.length - 1);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className="xg-menu-anchor" ref={anchor}>
      <button
        ref={trigger}
        type="button"
        className="xg-icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <IconMore />
      </button>
      {open && (
        <div className="xg-menu" role="menu" id={menuId} aria-label={label} onKeyDown={onKeyDown}>
          {actions.map((a, i) => (
            <div key={a.key}>
              {a.separatorBefore && <div className="xg-menu__sep" role="separator" />}
              <button
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`xg-menu__item${a.danger ? ' xg-menu__item--danger' : ''}`}
                onClick={() => {
                  close();
                  a.onSelect();
                }}
              >
                {a.icon}
                <span>
                  {a.label}
                  {a.hint && <small>{a.hint}</small>}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
