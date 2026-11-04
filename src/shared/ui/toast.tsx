import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '@/shared/i18n';
import { X } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface ToastApi {
  show: (message: string, options?: { action?: Toast['action']; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((all) => all.filter((item) => item.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    (message, options) => {
      const id = nextId.current++;
      setToasts((all) => [...all, { id, message, action: options?.action }]);
      // Un toast avec action (ex. « Annuler ») reste jusqu'à ce qu'on agisse ou le ferme (WCAG 2.2.1).
      if (!options?.action) timers.current.set(id, setTimeout(() => dismiss(id), options?.durationMs ?? 3000));
    },
    [dismiss],
  );

  // Timers annulés au démontage de la page.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // Valeur stable : les composants qui dépendent de `toast` ne se relancent pas à chaque toast.
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="xg-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className="xg-toast" key={toast.id}>
            <span>{toast.message}</span>
            {toast.action && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.run();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
                <button type="button" className="xg-toast__close" aria-label={t('common.actions.close')} onClick={() => dismiss(toast.id)}>
                  <X size={16} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
