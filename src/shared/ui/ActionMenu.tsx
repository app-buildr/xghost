import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis } from 'lucide-react';

/** Écart entre le bouton et le menu. */
const GAP = 6;
/** Marge gardée avec les bords de la fenêtre. */
const EDGE = 8;

/**
 * Position du menu (coordonnées de la fenêtre) : sous le bouton, au-dessus s'il manque de place en
 * bas, toujours entier dans la fenêtre.
 */
function placeMenu(trigger: DOMRect, menu: { width: number; height: number }, align: 'start' | 'end'): CSSProperties {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const below = trigger.bottom + GAP;
  const above = trigger.top - GAP - menu.height;
  const fitsBelow = below + menu.height <= vh - EDGE;
  const top = fitsBelow || above < EDGE ? below : above;
  const left = align === 'end' ? trigger.right - menu.width : trigger.left;
  return {
    top: Math.max(EDGE, Math.min(top, vh - menu.height - EDGE)),
    left: Math.max(EDGE, Math.min(left, vw - menu.width - EDGE)),
  };
}

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
 *
 * Le menu est rendu dans `body`, en position fixe : une liste qui défile (ou tout conteneur
 * `overflow`) ne le coupe pas. Il se ferme dès que son bouton bouge (défilement, redimensionnement,
 * lignes ajoutées au-dessus) ou disparaît : il ne reste jamais face à une autre ligne, ni par-dessus
 * un en-tête alors que sa ligne est masquée.
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
  const [position, setPosition] = useState<CSSProperties>();
  const anchor = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    (items.current[actions.findIndex((a) => a.checked)] ?? items.current[0])?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!anchor.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // Focus posé à l'ouverture seulement : `actions` change à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Placé avant l'affichage (pas de saut). Ensuite, une seule lecture par image (la position du
  // bouton) : s'il a bougé, même sans défilement (lignes ajoutées au-dessus par un scan), le menu se ferme.
  useLayoutEffect(() => {
    if (!open) return setPosition(undefined);
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const start = trigger.getBoundingClientRect();
    setPosition(placeMenu(start, { width: menu.offsetWidth, height: menu.offsetHeight }, align));
    let frame = 0;
    const watch = () => {
      const now = trigger.isConnected ? trigger.getBoundingClientRect() : undefined;
      if (!now || Math.abs(now.top - start.top) > 1 || Math.abs(now.left - start.left) > 1) return setOpen(false);
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, [open, align]);

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
      // Menu rendu en fin de page : le focus repart du bouton. Tab passe ensuite à l'élément suivant ;
      // Maj+Tab s'arrête sur le bouton, comme si le menu le suivait dans la page.
      if (e.shiftKey) e.preventDefault();
      close();
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
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={`xg-menu xg-menu--${align}`}
            style={position}
            role="menu"
            id={menuId}
            aria-label={label}
            onKeyDown={onKeyDown}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
