import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactElement, ReactNode } from "react";

export type MenuEntry =
  | {
      kind: "item";
      label: ReactNode;
      onSelect: () => void;
      icon?: ReactNode;
      tone?: "default" | "danger";
      disabled?: boolean;
    }
  | { kind: "separator" };

export interface MenuProps {
  /** The element that opens the menu, usually a `Button`. */
  trigger: ReactElement;
  entries: ReadonlyArray<MenuEntry>;
  align?: "start" | "center" | "end";
}

export function Menu({ trigger, entries, align = "start" }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="gb-menu-positioner" sideOffset={6} align={align}>
          <BaseMenu.Popup className="gb-menu">
            {entries.map((entry, index) =>
              entry.kind === "separator" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
                <BaseMenu.Separator key={index} className="gb-menu-separator" />
              ) : (
                <BaseMenu.Item
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries are static per render
                  key={index}
                  className="gb-menu-item"
                  data-tone={entry.tone ?? "default"}
                  disabled={entry.disabled ?? false}
                  onClick={entry.onSelect}
                >
                  {entry.icon !== undefined && <span className="gb-menu-icon">{entry.icon}</span>}
                  {entry.label}
                </BaseMenu.Item>
              ),
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
