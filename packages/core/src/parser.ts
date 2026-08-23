import type { DataformNode, NodeType } from "./types.js";

/**
 * Parse one `.sqlx` file's text into a {@link DataformNode}. Pure — takes content as a string and
 * does no I/O, so it runs identically in Node and the browser. Deliberately regex-based (no
 * `@dataform/core`): it stays lightweight and tolerates a project that doesn't compile, at the cost
 * of not seeing refs that only exist after compilation (JS-block refs, inline `config.assertions`).
 */
export function parseSqlx(filePath: string, content: string): DataformNode {
  const raw = extractConfigBlock(content);
  // Strip comments before reading fields: a `//` comment can carry an apostrophe (`GROUP BY'd`)
  // that would otherwise read as a stray string, or even a decoy `type:` line.
  const config = raw === null ? null : stripComments(raw);
  const declaredType = config ? matchString(config, "type") : undefined;
  const declaredName = config ? matchString(config, "name") : undefined;
  return {
    id: declaredName ?? basename(filePath),
    filePath,
    type: mapType(declaredType),
    tags: config ? parseTags(config) : [],
    // `ref()` calls and `config.dependencies` are two independent ways to declare the same edge, so
    // the node's upstream set is their union — refs first, since that's the common form.
    refs: mergeDeduped(extractRefs(content), config ? parseDependencies(config) : []),
    description: config ? parseDescription(config) : undefined,
  };
}

/** Concatenate preserving `first`'s order, dropping anything already present. */
function mergeDeduped(first: string[], second: string[]): string[] {
  const out = [...first];
  const seen = new Set(first);
  for (const value of second) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** Filename without directory or the `.sqlx` extension. Works on POSIX and Windows separators. */
export function basename(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  return name.replace(/\.sqlx$/i, "");
}

/**
 * Return the INNER text of the `config { ... }` block, matching braces by depth so nested objects
 * (`bigquery: { ... }`, `assertions: { ... }`) don't truncate it — a naive `\{([^}]*)\}` breaks on
 * the first inner `}`. Brace counting skips over string literals so a `}` inside a description or a
 * SQL snippet can't unbalance it. Returns null when there is no config block.
 */
export function extractConfigBlock(content: string): string | null {
  const kw = /\bconfig\b/.exec(content);
  if (!kw) return null;
  let i = content.indexOf("{", kw.index);
  if (i < 0) return null;
  const start = i + 1;
  let depth = 1;
  for (i = start; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(content, i, ch);
      continue;
    }
    if (ch === "/" && (content[i + 1] === "/" || content[i + 1] === "*")) {
      i = skipComment(content, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return content.slice(start, i);
    }
  }
  return null;
}

/** At a `/` that opens a line or block comment, return the index of the comment's last char. */
function skipComment(s: string, open: number): number {
  if (s[open + 1] === "/") {
    const nl = s.indexOf("\n", open + 2);
    return nl < 0 ? s.length : nl - 1;
  }
  const end = s.indexOf("*/", open + 2);
  return end < 0 ? s.length : end + 1;
}

/** Remove line and block comments while preserving string-literal contents. */
function stripComments(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(s, i, ch);
      out += s.slice(i, end + 1);
      i = end;
    } else if (ch === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) {
      i = skipComment(s, i);
    } else {
      out += ch;
    }
  }
  return out;
}

/** Advance past a string literal that opens at `open` (quote char `q`); returns the closing index. */
function skipString(s: string, open: number, q: string): number {
  for (let i = open + 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === q) return i;
  }
  return s.length;
}

/**
 * Nesting depth at every index of `block`, counting `{`/`[` and skipping string literals so a brace
 * inside a description can't shift it. Depth 0 is the config object's own level.
 */
function depthMap(block: string): number[] {
  const depth = new Array<number>(block.length).fill(0);
  let d = 0;
  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(block, i, ch);
      for (let j = i; j <= end && j < block.length; j++) depth[j] = d;
      i = end;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth[i] = d;
      d++;
    } else if (ch === "}" || ch === "]") {
      d--;
      depth[i] = d;
    } else {
      depth[i] = d;
    }
  }
  return depth;
}

/**
 * `key: "value"` / `key: 'value'` at the config's TOP level. Depth matters: a target object in
 * `dependencies: [{ schema: "staging", name: "stg_sessions" }]` carries its own `name`, and a
 * first-match-anywhere read would adopt it as the action's id. Nested keys are skipped.
 */
function matchString(block: string, key: string, depths = depthMap(block)): string | undefined {
  const re = new RegExp(`\\b${key}\\s*:\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`, "gs");
  for (let m = re.exec(block); m; m = re.exec(block)) {
    if (depths[m.index] === 0) return unescape(m[2] ?? "");
  }
  return undefined;
}

/**
 * `description` can be a long double-quoted JS string carrying escaped quotes and literal `\n`
 * (see the curated `dim_events` calendar). Match a full escaped string, then unescape.
 */
function parseDescription(block: string): string | undefined {
  return matchString(block, "description");
}

/** The first top-level `key: <value>` capture, ignoring the same key nested inside a sub-object. */
function matchTopLevel(block: string, re: RegExp): string | undefined {
  const depths = depthMap(block);
  for (let m = re.exec(block); m; m = re.exec(block)) {
    if (depths[m.index] === 0) return m[1];
  }
  return undefined;
}

/** `tags: "x"` or `tags: ["a", "b"]` → string[]. */
function parseTags(block: string): string[] {
  const value = matchTopLevel(block, /\btags\s*:\s*(\[[^\]]*\]|(["'])(?:\\.|(?!\2).)*\2)/gs);
  if (value === undefined) return [];
  const raw = value.trim();
  if (raw.startsWith("[")) {
    return [...raw.matchAll(/(["'])((?:\\.|(?!\1).)*)\1/gs)].map((g) => unescape(g[2] ?? ""));
  }
  return [unescape(raw.slice(1, -1))];
}

/**
 * `config.dependencies` — the explicit dependency list, which declares edges that no `ref()` call
 * expresses (a common pattern for `operations` and for ordering against an assertion). Accepts the
 * three shapes Dataform itself takes: a bare string, an array of strings, and an array of target
 * objects, where only `name` is the id `ref()` resolves against — `schema`/`database` alongside it
 * describe where the action lands, not what it's called. Order-preserving.
 */
function parseDependencies(block: string): string[] {
  const value = matchTopLevel(
    block,
    /\bdependencies\s*:\s*(\[[\s\S]*?\]|(["'])(?:\\.|(?!\2).)*\2)/gs,
  );
  if (value === undefined) return [];
  const raw = value.trim();
  if (!raw.startsWith("[")) return [unescape(raw.slice(1, -1))];
  const out: string[] = [];
  // Match an object entry or a bare string entry. Taking objects as whole `{...}` chunks keeps the
  // string branch from harvesting a target's `schema` value as if it were an action name.
  for (const entry of raw.slice(1, -1).matchAll(/\{[^}]*\}|(["'])((?:\\.|(?!\1).)*)\1/gs)) {
    const text = entry[0];
    if (text.startsWith("{")) {
      // Pass the object's INNER text so its keys sit at depth 0 for the top-level match.
      const name = matchString(text.slice(1, -1), "name");
      if (name) out.push(name);
    } else if (entry[2]) {
      out.push(unescape(entry[2]));
    }
  }
  return out;
}

/**
 * Every direct upstream dependency, from `ref()` calls across the WHOLE file (config + SQL body).
 * Handles the string form `ref("model")` / `ref('model')` and the object form
 * `ref({ name: "model", ... })`. Deduped, order-preserving. Template calls that are not refs —
 * `self()`, `when()`, `${dataform.projectConfig.vars.x}` — never match `\bref\s*\(` and so are
 * excluded for free.
 */
export function extractRefs(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  for (const m of content.matchAll(/\bref\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)/g)) {
    if (m[2]) push(m[2]);
  }
  for (const m of content.matchAll(/\bref\s*\(\s*\{[^}]*?\bname\s*:\s*(["'])((?:\\.|(?!\1).)*)\1/g)) {
    if (m[2]) push(m[2]);
  }
  return out;
}

/** Map a raw Dataform `config.type` to a render {@link NodeType}. `declaration` → `source`. */
function mapType(declared: string | undefined): NodeType {
  switch (declared) {
    case "declaration":
      return "source";
    case "table":
    case "view":
    case "incremental":
    case "assertion":
    case "operations":
      return declared;
    default:
      return "view";
  }
}

/** Resolve the JS string escapes we actually see in configs: `\n \t \r \" \' \\`. */
function unescape(s: string): string {
  return s.replace(/\\([ntr"'\\])/g, (_m, c: string) => {
    switch (c) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      default:
        return c;
    }
  });
}
