import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';

export interface MenuAction {
  key: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  danger?: boolean;
  separatorBefore?: boolean;
  /** Choix exclusif (ex. compte sélectionné) : l'élément devient un « menuitemradio ». */
  checked?: boolean;
  /** Contenu affiché à droite (ex. compteur). */
  trailing?: ReactNode;
  onSelect: () => void;
}

/**
 * Menu déroulant : fermeture au clic extérieur ou Échap, navigation au clavier
 * (flèches, Début/Fin, Entrée). Par défaut, bouton « … » d'actions aligné à droite ;
 * `trigger` remplace le contenu du bouton (ex. sélecteur de compte de la popup).
 */
export function ActionMenu({
  actions,
  label,
  trigger,
  triggerClassName = 'xg-icon-btn',
  align = 'end',
}: {
  actions: MenuAction[];
  label: string;
  trigger?: ReactNode;
  triggerClassName?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    (items.current[actions.findIndex((a) => a.checked)] ?? items.current[0])?.focus();
    const onDown = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // Focus posé à l'ouverture seulement : `actions` change à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
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
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={trigger ? undefined : label}
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
        {trigger ?? <Ellipsis />}
      </button>
      {open && (
        <div className={`xg-menu xg-menu--${align}`} role="menu" id={menuId} aria-label={label} onKeyDown={onKeyDown}>
          {actions.map((a, i) => (
            <div key={a.key}>
              {a.separatorBefore && <div className="xg-menu__sep" role="separator" />}
              <button
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role={a.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={a.checked}
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
                {a.trailing && <span className="xg-menu__trailing">{a.trailing}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
