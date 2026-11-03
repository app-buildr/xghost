import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LANGUAGE, t } from '@/shared/i18n';
import { ToastProvider } from './toast';
import './theme.css';
import './ui.css';

/** Monte une page de l'extension avec le thème, les toasts, la langue et le titre traduit. */
export function mount(app: ReactNode, title: string = t('common.appName')): void {
  document.title = title;
  const root = document.getElementById('root');
  if (!root) throw new Error(t('common.errors.noRoot'));
  document.documentElement.lang = LANGUAGE;
  createRoot(root).render(
    <StrictMode>
      <ToastProvider>{app}</ToastProvider>
    </StrictMode>,
  );
}
