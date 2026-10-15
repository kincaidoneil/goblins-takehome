import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/** Wrap the app once so adjacent tooltips open without a second delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={300}>{children}</BaseTooltip.Provider>;
}

export interface TooltipProps {
  /** A focusable element. */
  children: ReactElement;
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  defaultOpen?: boolean;
}

export function Tooltip({ children, content, side = "top", defaultOpen = false }: TooltipProps) {
  return (
    <BaseTooltip.Root defaultOpen={defaultOpen}>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className="gb-tooltip-positioner" side={side} sideOffset={8}>
          <BaseTooltip.Popup className="gb-tooltip">{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
