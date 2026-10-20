import React, { createContext, useContext, useState, useCallback } from 'react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  requestId?: string;
}

export interface ToastContextType {
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info', requestId?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = crypto.randomUUID();
      const item: ToastItem = { ...toast, id };
      setToasts((prev) => [...prev, item]);

      setTimeout(() => {
        removeToast(id);
      }, 5000);
    },
    [removeToast]
  );

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'info', requestId?: string) => {
      addToast({ message, type, requestId });
    },
    [addToast]
  );

  return (
    <ToastContext.Provider value={{ addToast, showToast, removeToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <div>{t.message}</div>
            {t.requestId && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Ref: {t.requestId}
              </div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
