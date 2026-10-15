import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";
import { cx } from "../cx";

export interface DialogProps {
  /** The element that opens the dialog, usually a `Button`. Omit when controlled. */
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons along the bottom. Wrap a closing button in `DialogClose`. */
  actions?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Dialog({
  trigger,
  title,
  description,
  children,
  actions,
  size = "md",
  className,
  ...rootProps
}: DialogProps) {
  return (
    <BaseDialog.Root {...rootProps}>
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="gb-dialog-backdrop" />
        <BaseDialog.Popup className={cx("gb-dialog", className)} data-size={size}>
          <BaseDialog.Title className="gb-dialog-title">{title}</BaseDialog.Title>
          {description !== undefined && (
            <BaseDialog.Description className="gb-dialog-description">
              {description}
            </BaseDialog.Description>
          )}
          {children !== undefined && <div className="gb-dialog-body">{children}</div>}
          {actions !== undefined && <div className="gb-dialog-actions">{actions}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** Closes the surrounding dialog when its child is clicked. */
export function DialogClose({ children }: { children: ReactElement }) {
  return <BaseDialog.Close render={children} />;
}
