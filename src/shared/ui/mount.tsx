import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from './toast';
import './theme.css';
import './ui.css';

/** Monte une page de l'extension avec le thème et les toasts. */
export function mount(app: ReactNode): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root introuvable');
  createRoot(root).render(
    <StrictMode>
      <ToastProvider>{app}</ToastProvider>
    </StrictMode>,
  );
}
