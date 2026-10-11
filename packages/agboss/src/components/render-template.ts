/**
 * `{{name}}` → its value. The one template renderer: agent prompt files and the generator's templates.
 * An unknown variable is an error, built by the caller (it knows where the template came from).
 */
export function renderTemplate(
  text: string,
  variables: Readonly<Record<string, unknown>>,
  unknown: (key: string) => Error,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined) throw unknown(key);
    return typeof value === "object" && value !== null
      ? JSON.stringify(value, null, 2)
      : // eslint-disable-next-line @typescript-eslint/no-base-to-string
        String(value);
  });
}
