import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '@/shared/i18n';
import { X } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  /** En train de disparaître (fondu de sortie avant retrait). */
  leaving?: boolean;
}

interface ToastApi {
  show: (message: string, options?: { action?: Toast['action'] }) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export const useToast = () => useContext(ToastContext);

/** Durée d'affichage, et durée du fondu de sortie (voir ui.css). */
const DURATION_MS = 3000;
const LEAVE_MS = 200;

/**
 * Toasts en bas à droite. Chacun disparaît seul après quelques secondes, action comprise
 * (« Annuler ») ; le décompte s'arrête tant que la souris ou le clavier est sur le toast, pour
 * laisser le temps d'agir (WCAG 2.2.1), et repart quand on le quitte.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((all) => all.filter((item) => item.id !== id));
  }, []);

  /** Fondu de sortie, puis retrait. */
  const dismiss = useCallback(
    (id: number) => {
      clearTimeout(timers.current.get(id));
      setToasts((all) => all.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
      timers.current.set(
        id,
        setTimeout(() => remove(id), LEAVE_MS),
      );
    },
    [remove],
  );

  const arm = useCallback(
    (id: number) => {
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION_MS),
      );
    },
    [dismiss],
  );
  const pause = useCallback((id: number) => clearTimeout(timers.current.get(id)), []);

  const show = useCallback<ToastApi['show']>(
    (message, options) => {
      const id = nextId.current++;
      setToasts((all) => [...all, { id, message, action: options?.action }]);
      arm(id);
    },
    [arm],
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
          <div
            className={`xg-toast${toast.leaving ? ' is-leaving' : ''}`}
            key={toast.id}
            onMouseEnter={() => !toast.leaving && pause(toast.id)}
            onMouseLeave={() => !toast.leaving && arm(toast.id)}
            onFocus={() => !toast.leaving && pause(toast.id)}
            onBlur={() => !toast.leaving && arm(toast.id)}
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="xg-toast__close"
              aria-label={t('common.actions.close')}
              onClick={() => dismiss(toast.id)}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
