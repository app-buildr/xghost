import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

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

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback<ToastApi['show']>(
    (message, options) => {
      const id = nextId.current++;
      setToasts((all) => [...all, { id, message, action: options?.action }]);
      setTimeout(() => dismiss(id), options?.durationMs ?? 3000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="xg-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className="xg-toast" key={t.id}>
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
