import { cloneElement, useId, type ReactElement } from 'react';

/**
 * Bulle d'information au survol ou au focus (remplace l'attribut `title` du navigateur) :
 * apparition progressive, courte attente avant l'affichage, lue par les lecteurs d'écran
 * grâce à `aria-describedby` posé sur l'élément décrit.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  align = 'center',
}: {
  label: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom';
  /** `end` : bulle calée sur le bord droit (élément au bord de la page). */
  align?: 'center' | 'end';
}) {
  const id = useId();
  return (
    <span className={`xg-tooltip xg-tooltip--${side} xg-tooltip--${align}`}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span role="tooltip" id={id} className="xg-tooltip__bubble">
        {label}
      </span>
    </span>
  );
}
