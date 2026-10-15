import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cx } from "../cx";

export interface TabItem<Value extends string> {
  value: Value;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<Value extends string> {
  items: ReadonlyArray<TabItem<Value>>;
  value?: Value;
  defaultValue?: Value;
  onValueChange?: (value: Value) => void;
  className?: string;
}

export function Tabs<Value extends string>({
  items,
  value,
  defaultValue,
  onValueChange,
  className,
}: TabsProps<Value>) {
  const values: ReadonlyArray<string> = items.map((item) => item.value);
  const isValue = (v: unknown): v is Value => typeof v === "string" && values.includes(v);
  return (
    <BaseTabs.Root
      className={cx("gb-tabs", className)}
      {...(value === undefined ? {} : { value })}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={(next) => {
        if (onValueChange && isValue(next)) onValueChange(next);
      }}
    >
      <BaseTabs.List className="gb-tabs-list">
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            className="gb-tabs-tab"
            disabled={item.disabled ?? false}
          >
            {item.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="gb-tabs-indicator" />
      </BaseTabs.List>
      {items.map((item) => (
        <BaseTabs.Panel key={item.value} value={item.value} className="gb-tabs-panel">
          {item.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
