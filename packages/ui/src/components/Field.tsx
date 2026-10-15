import { Field as BaseField } from "@base-ui/react/field";
import { Input as BaseInput } from "@base-ui/react/input";
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { cx } from "../cx";

export interface InputProps extends Omit<BaseInput.Props, "className"> {
  className?: string;
}

export function Input({ className, ...props }: InputProps) {
  return <BaseInput {...props} className={cx("gb-input", className)} />;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}

/** A multi-line input. Inside a `Field`, it is labelled and described by the field. */
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <BaseField.Control
      render={<textarea {...props} />}
      className={cx("gb-input", "gb-textarea", className)}
    />
  );
}

export interface FieldProps {
  label: ReactNode;
  /** Help text shown under the control. */
  description?: ReactNode;
  /** An error message. When set, the field is marked invalid. */
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Labels a single `Input` or `Textarea`, with optional help text and error. */
export function Field({ label, description, error, children, className }: FieldProps) {
  const invalid = error !== undefined && error !== null && error !== false;
  return (
    <BaseField.Root className={cx("gb-field", className)} invalid={invalid}>
      <BaseField.Label className="gb-field-label">{label}</BaseField.Label>
      {children}
      {description !== undefined && !invalid && (
        <BaseField.Description className="gb-field-description">
          {description}
        </BaseField.Description>
      )}
      {invalid && (
        <BaseField.Error className="gb-field-error" match>
          {error}
        </BaseField.Error>
      )}
    </BaseField.Root>
  );
}
