#!/usr/bin/env node
/**
 * Turn `dataform compile --json` output into an anonymized copy of the project's SHAPE, safe to
 * share for performance work: every action keeps its type, its edges, its tag/schema/file grouping
 * and the LENGTH of its name (node width drives layout), but every name, tag, schema, database and
 * path is replaced, and all SQL and descriptions are dropped. Run it on your machine and read the
 * output before sending it anywhere.
 *
 * The output is itself valid compile output, so it loads straight into the extension's pipeline
 * as a test fixture.
 *
 * Usage (no dependencies, Node 18+), from the Dataform project root:
 *
 *   dataform compile --json > compile.json
 *   node graph-shape.mjs compile.json > shape.json
 *
 * Summary stats go to stderr so you can see what you're sharing.
 */
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(process.argv[2] ?? 0, "utf8"));

/** A consistent replacement per distinct value: the same input always maps to the same output. */
function namer(prefix) {
  const seen = new Map();
  return (value) => {
    if (value == null) return value;
    if (!seen.has(value)) seen.set(value, `${prefix}${seen.size + 1}`);
    return seen.get(value);
  };
}
const schemaOf = namer("schema_");
const databaseOf = namer("db_");
const tagOf = namer("tag_");
const dirOf = namer("d");
const fileOf = namer("f");

// Names keep their length, padded with "_", so canvas node widths stay realistic. Keyed by the
// full target so two schemas' `orders` stay two distinct names that still collide on `name`.
const PREFIX = { table: "tbl", view: "view", incremental: "inc", operations: "op", assertion: "asrt", declaration: "src" };
const nameByRealName = new Map();
let counter = 0;
function nameOf(realName, kind) {
  // Same real name → same anonymous name, so cross-schema name collisions survive anonymizing.
  if (!nameByRealName.has(realName)) {
    const base = `${PREFIX[kind] ?? "a"}_${++counter}`;
    nameByRealName.set(realName, base + "_".repeat(Math.max(0, realName.length - base.length)));
  }
  return nameByRealName.get(realName);
}
const kindOfName = new Map();

const target = (t, kind) =>
  t && {
    name: nameOf(t.name, kind ?? kindOfName.get(t.name) ?? "a"),
    schema: schemaOf(t.schema),
    database: databaseOf(t.database),
  };

const filePath = (p) => {
  if (!p) return p;
  const parts = p.split(/[\\/]/);
  const file = parts.pop();
  const ext = file.includes(".") ? file.slice(file.lastIndexOf(".")) : "";
  return [...parts.map((d) => (d === "definitions" || d === "includes" ? d : dirOf(d))), fileOf(file) + ext].join("/");
};

const groups = {
  tables: (a) => a.type ?? "table",
  operations: () => "operations",
  assertions: () => "assertion",
  declarations: () => "declaration",
};

// Register every action's kind first, so a dependency naming an action seen later still gets the
// right prefix.
for (const [group, kindOf] of Object.entries(groups)) {
  for (const a of input[group] ?? []) kindOfName.set(a.target.name, kindOf(a));
}

const out = {};
const stats = { byType: {}, edges: 0, sharedFiles: 0 };
const files = new Map();
for (const [group, kindOf] of Object.entries(groups)) {
  out[group] = (input[group] ?? []).map((a) => {
    const kind = kindOf(a);
    stats.byType[kind] = (stats.byType[kind] ?? 0) + 1;
    stats.edges += (a.dependencyTargets ?? []).length;
    if (a.fileName) files.set(a.fileName, (files.get(a.fileName) ?? 0) + 1);
    return {
      target: target(a.target, kind),
      ...(a.type ? { type: a.type } : {}),
      fileName: filePath(a.fileName),
      tags: (a.tags ?? []).map(tagOf),
      dependencyTargets: (a.dependencyTargets ?? []).map((t) => target(t)),
    };
  });
}
stats.sharedFiles = [...files.values()].filter((n) => n > 1).length;
const tags = new Set(Object.values(out).flat().flatMap((a) => a.tags));

process.stdout.write(JSON.stringify(out));
const total = Object.values(stats.byType).reduce((a, b) => a + b, 0);
process.stderr.write(
  `actions: ${total}  ${JSON.stringify(stats.byType)}\n` +
    `edges: ${stats.edges}  files: ${files.size} (${stats.sharedFiles} produce several actions)` +
    `  tags: ${tags.size}\n`,
);
