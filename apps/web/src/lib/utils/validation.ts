import type { ZodSchema } from "zod";

/**
 * Builds a lightweight validator for TanStack Form fields using a Zod schema.
 * Returns the first error message for the targeted path, or undefined when valid.
 */
export function makeFieldValidator<T, V>(
  schema: ZodSchema<T>,
  path: string,
  build: (value: V) => unknown
) {
  return (value: V) => {
    const result = schema.safeParse(build(value));
    if (result.success) {
      return;
    }

    const issue = result.error.issues.find((i) => i.path.includes(path));
    return issue?.message;
  };
}
