import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ToastContext = createContext(null)
let toastId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((toast) => {
    toastId += 1
    const id = toastId
    const entry = { id, duration: 3200, variant: 'default', ...toast }
    setToasts((prev) => [...prev, entry])
    if (entry.duration !== Infinity) {
      setTimeout(() => remove(id), entry.duration)
    }
    return id
  }, [remove])

  const value = useMemo(() => ({ pushToast: push, dismissToast: remove }), [push, remove])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.variant || ''}`.trim()} aria-label={toast.label || toast.message}>
            <div>
              <div>{toast.message}</div>
              {toast.description && <div className="small">{toast.description}</div>}
            </div>
            {toast.action && (
              <button type="button" onClick={() => { toast.action.onClick?.(); remove(toast.id) }}>
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
