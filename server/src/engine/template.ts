/**
 * Minimal `{{ path }}` interpolator for node configs.
 *
 * Scope: { input, vars, run, node }. A template that is exactly one
 * placeholder ("{{ input.text }}") yields the raw value, so objects and
 * arrays survive a pass-through instead of being stringified.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_$.[\]-]+)\s*\}\}/g;
const WHOLE = /^\s*\{\{\s*([A-Za-z0-9_$.[\]-]+)\s*\}\}\s*$/;

export type Scope = Record<string, unknown>;

function lookup(path: string, scope: Scope): unknown {
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = scope;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

export function renderString(template: string, scope: Scope): string {
  return template.replace(PLACEHOLDER, (_match, path: string) => stringify(lookup(path, scope)));
}

/** Renders any JSON-ish config value, recursing through objects and arrays. */
export function renderValue<T>(value: T, scope: Scope): unknown {
  if (typeof value === "string") {
    const whole = WHOLE.exec(value);
    if (whole) return lookup(whole[1] ?? "", scope) ?? "";
    return renderString(value, scope);
  }
  if (Array.isArray(value)) return value.map((item) => renderValue(item, scope));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = renderValue(item, scope);
    }
    return out;
  }
  return value;
}

export function ctx(scope: Scope, key: string): unknown {
  return scope[key];
}
