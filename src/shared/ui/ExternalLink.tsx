import type { AnchorHTMLAttributes } from 'react';

/** Lien externe : nouvel onglet, sans accès à la page d'origine ni référent. */
export function ExternalLink(props: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}
