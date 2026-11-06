import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@/shared/i18n';
import { Banner } from './primitives';

/**
 * Isole une erreur de rendu (ex. données illisibles) : le reste de la page continue de
 * fonctionner. `fallback` remplace le contenu fautif ; par défaut, un court message.
 * `resetKey` : quand il change (autre compte, données rechargées après un import), on retente
 * l'affichage au lieu de rester bloqué sur le message d'erreur.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; resetKey?: unknown },
  { failed: boolean }
> {
  override state = { failed: false };

  override componentDidUpdate(previous: { resetKey?: unknown }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(t('common.log.render'), error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      this.props.fallback ?? (
        <Banner role="alert">
          <span>{t('common.errors.render')}</span>
        </Banner>
      )
    );
  }
}
