import { Button as BaseButton } from "@base-ui/react/button";
import { cx } from "../cx";

export type ButtonVariant = "primary" | "brand" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<BaseButton.Props, "className"> {
  /**
   * `primary` is the lime call to action; use one per screen.
   * `brand` is solid green, `secondary` outlined, `ghost` text-only.
   * `danger` is for destructive teacher actions only.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <BaseButton
      {...props}
      className={cx("gb-button", className)}
      data-variant={variant}
      data-size={size}
    />
  );
}
