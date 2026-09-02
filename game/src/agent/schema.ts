/**
 * Strict input validation for agent tools.
 *
 * Every tool publishes a JSON Schema, and until this existed the schema was documentation only:
 * handlers coerced what they recognised and silently dropped the rest, so `radius: "big"` became
 * the default radius and `types: ["inventory.ful"]` waited forever for an event that cannot exist.
 * An agent learns nothing from a call that quietly did something else. Now the schema is enforced
 * at the boundary, for the WebMCP path and `window.corealm.agent.call` alike, and a bad argument
 * is an `INVALID_ARGUMENT` that names the field and what was expected.
 *
 * This covers the subset of JSON Schema the tools actually use — `type` (including a type list),
 * `enum`, `const`, `required`, `properties`, `additionalProperties: false`, `items`,
 * `minItems`/`maxItems`, `minimum`/`maximum`, `minLength`/`maxLength`. Anything outside that
 * subset passes through unvalidated rather than failing closed, so a schema can grow before the
 * validator does.
 */
import type { JsonSchema } from "./toolkit.js";

export type ValidationResult = { ok: true } | { ok: false; message: string; path: string };

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}

function describe(value: unknown): string {
  if (typeof value === "string") return `"${value.length > 40 ? `${value.slice(0, 37)}...` : value}"`;
  if (value === undefined) return "undefined";
  try {
    const text = JSON.stringify(value);
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  } catch {
    return String(value);
  }
}

function fail(path: string, message: string): ValidationResult {
  return { ok: false, path, message: `${path || "input"}: ${message}` };
}

/** Validates `value` against `schema`. Never throws. */
export function validateAgainst(schema: JsonSchema, value: unknown, path = ""): ValidationResult {
  const rawType = schema.type;
  if (typeof rawType === "string" || Array.isArray(rawType)) {
    const allowed = Array.isArray(rawType) ? rawType.map(String) : [rawType];
    if (!allowed.some((type) => matchesType(value, type))) {
      return fail(path, `expected ${allowed.join(" or ")}, got ${typeOf(value)} ${describe(value)}`);
    }
  }

  if (Array.isArray(schema.enum)) {
    const options = schema.enum as unknown[];
    if (!options.some((option) => option === value)) {
      const shown = options.length > 24
        ? `${options.slice(0, 24).map(describe).join(", ")}, ... (${options.length} values)`
        : options.map(describe).join(", ");
      return fail(path, `${describe(value)} is not one of ${shown}`);
    }
  }
  if ("const" in schema && schema.const !== value) {
    return fail(path, `must be ${describe(schema.const)}`);
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return fail(path, `${value} is below the minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return fail(path, `${value} is above the maximum ${schema.maximum}`);
    }
    if (!Number.isFinite(value)) return fail(path, "must be a finite number");
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      return fail(path, `must be at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      return fail(path, `must be at most ${schema.maxLength} characters`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return fail(path, `needs at least ${schema.minItems} items, got ${value.length}`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      return fail(path, `allows at most ${schema.maxItems} items, got ${value.length}`);
    }
    const items = schema.items;
    if (items && typeof items === "object" && !Array.isArray(items)) {
      for (const [index, entry] of value.entries()) {
        const result = validateAgainst(items as JsonSchema, entry, `${path}[${index}]`);
        if (!result.ok) return result;
      }
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (record[key] === undefined) {
        return fail(path ? `${path}.${key}` : key, "is required");
      }
    }
    for (const [key, entry] of Object.entries(record)) {
      const childPath = path ? `${path}.${key}` : key;
      const property = properties[key];
      if (!property) {
        if (schema.additionalProperties === false) {
          const known = Object.keys(properties);
          return fail(childPath, known.length > 0
            ? `is not an accepted argument. Accepted: ${known.join(", ")}`
            : "is not an accepted argument. This tool takes no arguments");
        }
        continue;
      }
      // An explicit undefined is "not given", the same as JSON would have dropped it.
      if (entry === undefined) continue;
      const result = validateAgainst(property, entry, childPath);
      if (!result.ok) return result;
    }
  }

  return { ok: true };
}
