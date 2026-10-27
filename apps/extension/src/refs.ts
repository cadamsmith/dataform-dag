/** What a `ref()` (or a `dependencies` entry) names, in Dataform's own terms. */
export interface RefTarget {
  name: string;
  schema?: string;
  database?: string;
}

/** A reference found in a file's text, with the character range it covers. */
export interface RefSite {
  target: RefTarget;
  start: number;
  end: number;
}

/**
 * Every reference in a `.sqlx` or definitions `.js` file, in order:
 *
 * - `ref(...)` / `resolve(...)`, including `ctx.ref(...)`, with one to three string arguments
 *   (`name`, `schema, name`, `database, schema, name`) or one target object (`{ schema, name }`).
 * - `dependencies: ...` in a config block and `.dependencies(...)` in the JS API: a bare string, or
 *   an array of strings and target objects.
 *
 * Anything built at runtime (a variable, a template string) is skipped: only `dataform compile`
 * knows what it resolves to, and a guess that jumps to the wrong file is worse than no jump.
 */
export function findRefs(text: string): RefSite[] {
  const out: RefSite[] = [];
  const call = /\b(?:ref|resolve)\s*\(/g;
  for (let m = call.exec(text); m; m = call.exec(text)) {
    const open = m.index + m[0].length - 1;
    const close = matching(text, open);
    if (close < 0) continue;
    const target = callTarget(text.slice(open + 1, close));
    if (target) out.push({ target, start: m.index, end: close + 1 });
  }
  const deps = /\bdependencies\s*[:(]\s*/g;
  for (let m = deps.exec(text); m; m = deps.exec(text)) {
    const at = m.index + m[0].length;
    const ch = text[at];
    if (ch === '"' || ch === "'") {
      const lit = stringAt(text, at);
      if (lit) out.push({ target: { name: lit.value }, start: at, end: lit.end });
    } else if (ch === "[") {
      const close = matching(text, at);
      if (close >= 0) out.push(...arrayTargets(text, at + 1, close));
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The reference covering `offset`, if any. */
export function refAt(text: string, offset: number): RefSite | undefined {
  return findRefs(text).find((r) => offset >= r.start && offset <= r.end);
}

/**
 * The graph node ids a target can mean. A node id is the target name, qualified as `schema.name`
 * (or `database.schema.name`) only when two actions share the name — so try the most qualified form
 * the target can spell first. A bare name that matches no id but is the tail of several qualified
 * ones is ambiguous; every candidate is returned and the editor offers the choice.
 */
export function resolveTarget(target: RefTarget, ids: ReadonlySet<string>): string[] {
  const { name, schema, database } = target;
  const tries = [
    database && schema ? `${database}.${schema}.${name}` : undefined,
    schema ? `${schema}.${name}` : undefined,
    name,
  ];
  for (const id of tries) if (id && ids.has(id)) return [id];
  return [...ids].filter((id) => id.endsWith(`.${name}`));
}

/** The index of the bracket closing the one at `open`, skipping strings and comments; -1 if none. */
function matching(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack = [pairs[text[open]!]!];
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const lit = stringAt(text, i);
      if (!lit) return -1;
      i = lit.end - 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      if (nl < 0) return -1;
      i = nl;
    } else if (ch === "/" && text[i + 1] === "*") {
      const endComment = text.indexOf("*/", i + 2);
      if (endComment < 0) return -1;
      i = endComment + 1;
    } else if (pairs[ch]) stack.push(pairs[ch]!);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** The quoted string starting at `at`, with its value and the index just past the closing quote. */
function stringAt(text: string, at: number): { value: string; end: number } | undefined {
  const quote = text[at];
  let value = "";
  for (let i = at + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\") {
      value += text[i + 1] ?? "";
      i++;
    } else if (ch === quote) return { value, end: i + 1 };
    else if (ch === "\n" && quote !== "`") return undefined;
    else value += ch;
  }
  return undefined;
}

const STRING_ARG = /^\s*(["'])((?:\\.|(?!\1).)*)\1\s*$/;

/** `ref(...)`'s arguments as a target, or undefined when any of them isn't a literal. */
function callTarget(args: string): RefTarget | undefined {
  const trimmed = args.trim();
  if (trimmed.startsWith("{")) return objectTarget(trimmed);
  const parts = splitTopLevel(args).map((p) => STRING_ARG.exec(p)?.[2]);
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => p === undefined)) return undefined;
  const [a, b, c] = parts as string[];
  if (parts.length === 1) return { name: a! };
  if (parts.length === 2) return { schema: a, name: b! };
  return { database: a, schema: b, name: c! };
}

/** A `{ name, schema?, database? }` literal as a target. `name` is required, as in Dataform. */
function objectTarget(src: string): RefTarget | undefined {
  const field = (key: string): string | undefined =>
    new RegExp(`\\b${key}\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`).exec(src)?.[2];
  const name = field("name");
  if (!name) return undefined;
  const schema = field("schema");
  const database = field("database");
  return { name, ...(schema ? { schema } : {}), ...(database ? { database } : {}) };
}

/** The string and object entries of the array whose contents run `from`..`to`. */
function arrayTargets(text: string, from: number, to: number): RefSite[] {
  const out: RefSite[] = [];
  for (let i = from; i < to; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const lit = stringAt(text, i);
      if (!lit) break;
      out.push({ target: { name: lit.value }, start: i, end: lit.end });
      i = lit.end - 1;
    } else if (ch === "{") {
      const close = matching(text, i);
      if (close < 0) break;
      const target = objectTarget(text.slice(i, close + 1));
      if (target) out.push({ target, start: i, end: close + 1 });
      i = close;
    }
  }
  return out;
}

/** Split call arguments on top-level commas. */
function splitTopLevel(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = "";
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\") current += args[++i] ?? "";
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}
