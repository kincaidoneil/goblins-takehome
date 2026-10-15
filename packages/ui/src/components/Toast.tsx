import { Toast as BaseToast } from "@base-ui/react/toast";
import { type ReactNode, useCallback } from "react";

export type ToastTone = "neutral" | "success" | "attention";

/** Data carried by each toast. */
export interface ToastData {
  tone?: ToastTone;
}

/** Wrap the app once. Renders the toast stack in the bottom-right corner. */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="gb-toast-viewport">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager<ToastData>();
  return toasts.map((toast) => (
    <BaseToast.Root
      key={toast.id}
      toast={toast}
      className="gb-toast"
      data-tone={toast.data?.tone ?? "neutral"}
    >
      <BaseToast.Content className="gb-toast-content">
        <BaseToast.Title className="gb-toast-title" />
        <BaseToast.Description className="gb-toast-description" />
      </BaseToast.Content>
      <BaseToast.Close className="gb-toast-close" aria-label="Dismiss">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </BaseToast.Close>
    </BaseToast.Root>
  ));
}

export interface ShowToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds before it hides. Defaults to 5000; 0 keeps it until dismissed. */
  timeout?: number;
}

/** Returns a function that shows a toast. Must be used under `ToastProvider`. */
export function useToast() {
  const { add } = BaseToast.useToastManager<ToastData>();
  return useCallback(
    ({ title, description, tone = "neutral", timeout }: ShowToastOptions) =>
      add({
        title,
        description,
        data: { tone },
        ...(timeout === undefined ? {} : { timeout }),
      }),
    [add],
  );
}
