export interface LangPair {
  key: string;
  value: string;
}

export interface JsonTextValue {
  path: Array<string | number>;
  value: string;
}

export function isHumanText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 2000) {
    return false;
  }
  if (/^[a-z0-9_.:/#-]+$/i.test(trimmed)) {
    return false;
  }
  if (/^\[[A-Z0-9_./:-]+\]$/.test(trimmed)) {
    return false;
  }
  return /[\p{L}\p{N}]/u.test(trimmed);
}

export function parseLangProperties(content: string): LangPair[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      if (index === -1) {
        return undefined;
      }
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (!key || !isHumanText(value)) {
        return undefined;
      }
      return { key, value };
    })
    .filter((pair): pair is LangPair => Boolean(pair));
}

export function parseLangJson(content: string): LangPair[] {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const pairs: LangPair[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && isHumanText(value)) {
      pairs.push({ key, value });
    }
  }
  return pairs;
}

const likelyTextKeys = new Set([
  "body",
  "description",
  "desc",
  "details",
  "display",
  "hover",
  "label",
  "line",
  "lore",
  "name",
  "quest",
  "subtitle",
  "summary",
  "text",
  "title",
  "tooltip"
]);

export function collectJsonTextValues(value: unknown, path: Array<string | number> = []): JsonTextValue[] {
  const rows: JsonTextValue[] = [];
  if (typeof value === "string") {
    const key = String(path[path.length - 1] ?? "").toLowerCase();
    if (likelyTextKeys.has(key) || isHumanText(value)) {
      rows.push({ path, value });
    }
    return rows;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      rows.push(...collectJsonTextValues(item, [...path, index]));
    });
    return rows;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      rows.push(...collectJsonTextValues(child, [...path, key]));
    }
  }

  return rows;
}

export function getJsonPath(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const part of path) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown> | unknown[])[part as never];
  }
  return current;
}

export function setJsonPath(value: unknown, path: Array<string | number>, replacement: string): void {
  let current = value as Record<string, unknown> | unknown[];
  for (const part of path.slice(0, -1)) {
    current = current[part as never] as Record<string, unknown> | unknown[];
  }
  const last = path[path.length - 1];
  current[last as never] = replacement as never;
}

export function parseMaybeJson(content: string): unknown | undefined {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

export function extractStringLiterals(content: string): string[] {
  const results = new Set<string>();
  const patterns = [/"((?:\\.|[^"\\])*)"/g, /'((?:\\.|[^'\\])*)'/g];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      try {
        const value = JSON.parse(`"${match[1].replace(/"/g, '\\"')}"`) as string;
        if (isHumanText(value)) {
          results.add(value);
        }
      } catch {
        if (isHumanText(match[1])) {
          results.add(match[1]);
        }
      }
    }
  }

  return [...results];
}

export function pathKey(path: Array<string | number>): string {
  return path.map((part) => String(part).replace(/\./g, "\\.")).join(".");
}

export function escapeForQuotedLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
