"use client";

import type * as LabelPrimitive from "@radix-ui/react-label";
import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * TanStack Form primitives for shadcn/ui integration
 *
 * These components provide a similar API to the React Hook Form primitives
 * but are designed to work with TanStack Form's field state.
 *
 * Usage:
 * ```tsx
 * <form.Field name="email">
 *   {(field) => (
 *     <Field
 *       name={field.name}
 *       errors={field.state.meta.errors}
 *       isTouched={field.state.meta.isTouched}
 *     >
 *       <FieldLabel>Email</FieldLabel>
 *       <FieldControl>
 *         <Input
 *           value={field.state.value}
 *           onChange={(e) => field.handleChange(e.target.value)}
 *           onBlur={field.handleBlur}
 *         />
 *       </FieldControl>
 *       <FieldMessage />
 *     </Field>
 *   )}
 * </form.Field>
 * ```
 */

// Context for field state propagation
type FieldContextValue = {
  id: string;
  name: string;
  errors: string[];
  isTouched: boolean;
  isValidating: boolean;
};

const FieldContext = React.createContext<FieldContextValue | null>(null);

function useFieldContext() {
  const context = React.useContext(FieldContext);
  if (!context) {
    throw new Error("Field components must be used within a Field provider");
  }
  return context;
}

// Field wrapper - provides context to children
interface FieldProps {
  children: React.ReactNode;
  className?: string;
  name: string;
  errors?: string[];
  isTouched?: boolean;
  isValidating?: boolean;
}

function Field({
  children,
  className,
  name,
  errors = [],
  isTouched = false,
  isValidating = false,
}: FieldProps) {
  const id = React.useId();
  const hasError = errors.length > 0 && isTouched;

  return (
    <FieldContext.Provider
      value={{ id, name, errors, isTouched, isValidating }}
    >
      <div
        data-slot="field"
        data-invalid={hasError}
        className={cn("grid gap-2", className)}
      >
        {children}
      </div>
    </FieldContext.Provider>
  );
}

// FieldLabel - accessible label with error styling
function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { id, errors, isTouched } = useFieldContext();
  const hasError = errors.length > 0 && isTouched;

  return (
    <Label
      data-slot="field-label"
      data-error={hasError}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={`${id}-input`}
      {...props}
    />
  );
}

// FieldControl - slot for the input with accessibility attributes
interface FieldControlProps {
  children: React.ReactElement<Record<string, unknown>>;
}

function FieldControl({ children }: FieldControlProps) {
  const { id, errors, isTouched } = useFieldContext();
  const hasError = errors.length > 0 && isTouched;

  const childProps = children.props as Record<string, unknown>;

  return React.cloneElement(children, {
    ...childProps,
    id: `${id}-input`,
    "aria-describedby": hasError ? `${id}-message` : `${id}-description`,
    "aria-invalid": hasError,
  });
}

// FieldDescription - helper text
interface FieldDescriptionProps {
  className?: string;
  children?: React.ReactNode;
}

function FieldDescription({ className, children }: FieldDescriptionProps) {
  const { id } = useFieldContext();

  return (
    <p
      data-slot="field-description"
      id={`${id}-description`}
      className={cn("text-muted-foreground text-sm", className)}
    >
      {children}
    </p>
  );
}

// FieldMessage - error message display
interface FieldMessageProps {
  /** Optional custom message to display instead of errors */
  message?: string;
  className?: string;
  children?: React.ReactNode;
}

function FieldMessage({ className, message, children }: FieldMessageProps) {
  const { id, errors, isTouched } = useFieldContext();
  const hasError = errors.length > 0 && isTouched;
  const body = message || (hasError ? errors[0] : children);

  if (!body) {
    return null;
  }

  return (
    <p
      data-slot="field-message"
      id={`${id}-message`}
      className={cn("text-destructive text-sm", className)}
      role="alert"
      aria-live="polite"
    >
      {body}
    </p>
  );
}

export {
  Field,
  FieldLabel,
  FieldControl,
  FieldDescription,
  FieldMessage,
  useFieldContext,
};
