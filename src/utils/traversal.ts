/**
 * Ported from yt_dlp/utils/traversal.py
 * Safe nested data traversal with multiple path support.
 */

const NO_DEFAULT = Symbol('NO_DEFAULT');
type TraverseDefault = typeof NO_DEFAULT | unknown;

/**
 * Safely traverse nested objects/arrays following the given paths.
 *
 * @param obj - The object to traverse
 * @param paths - One or more path arrays. Each path is an array of keys/indices.
 * @param options - default value, expected_type, get_all flag
 *
 * Usage:
 *   traverseObj(data, ['video', 0, 'url'])
 *   traverseObj(data, ['video', 'title'], ['name'], { default: 'Unknown' })
 */
export function traverseObj(
  obj: unknown,
  ...args: unknown[]
): unknown {
  let options: { default?: unknown; expected_type?: (v: unknown) => boolean; get_all?: boolean } = {};
  let paths: unknown[][] = [];

  for (const arg of args) {
    if (Array.isArray(arg)) {
      paths.push(arg);
    } else if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
      options = arg as typeof options;
    }
  }

  if (paths.length === 0) return options.default;

  const { default: defaultVal, expected_type, get_all = true } = options;

  for (const path of paths) {
    const result = traversePath(obj, path, get_all);
    if (result !== undefined && result !== null) {
      if (expected_type && !expected_type(result)) continue;
      return result;
    }
  }

  return defaultVal;
}

function traversePath(obj: unknown, path: unknown[], getAll: boolean): unknown {
  let current: unknown = obj;

  for (const key of path) {
    if (current === null || current === undefined) return undefined;

    if (typeof key === 'string' || typeof key === 'number') {
      if (Array.isArray(current)) {
        if (typeof key === 'number') {
          current = current[key < 0 ? current.length + key : key];
        } else {
          // Try to get from array of objects
          const results = current
            .map(item => (item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined))
            .filter(v => v !== undefined);
          current = getAll ? results : results[0];
        }
      } else if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[String(key)];
      } else {
        return undefined;
      }
    } else if (typeof key === 'function') {
      if (Array.isArray(current)) {
        const results = current.filter(key as (v: unknown) => boolean);
        current = getAll ? results : results[0];
      } else {
        current = (key as (v: unknown) => boolean)(current) ? current : undefined;
      }
    } else if (key === null || key === undefined) {
      // Ellipsis equivalent — get all values
      if (Array.isArray(current)) {
        // current stays as array
      } else if (typeof current === 'object') {
        current = Object.values(current as Record<string, unknown>);
      }
    }
  }

  return current;
}

/**
 * Safe getter — tries a function and returns default on error.
 * Port of try_get from yt_dlp.
 */
export function tryGet<T>(
  src: unknown,
  getter: ((v: unknown) => T) | ((v: unknown) => T)[],
  expectedType?: (v: unknown) => boolean
): T | undefined {
  const getters = Array.isArray(getter) ? getter : [getter];
  for (const fn of getters) {
    try {
      const result = fn(src);
      if (result === undefined || result === null) continue;
      if (expectedType && !expectedType(result)) continue;
      return result;
    } catch {
      continue;
    }
  }
  return undefined;
}
