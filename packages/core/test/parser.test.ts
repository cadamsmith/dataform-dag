import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractConfigBlock, extractRefs, parseSqlx } from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "definitions");
const read = (rel: string) => readFileSync(join(FIXTURES, rel), "utf8");

describe("extractConfigBlock", () => {
  it("captures a block with nested objects instead of stopping at the first inner brace", () => {
    const block = extractConfigBlock(read("intermediate/int_daily_fare_stats.sqlx"));
    expect(block).not.toBeNull();
    // bigquery: { ... } and assertions: { ... } are both nested — a naive \{[^}]*\} would truncate here.
    expect(block).toContain("partitionBy");
    expect(block).toContain("uniqueKey");
    expect(block).not.toContain("SELECT");
  });

  it("returns null when there is no config block", () => {
    expect(extractConfigBlock("SELECT 1 AS x")).toBeNull();
  });

  it("is not unbalanced by a brace inside a string literal", () => {
    const block = extractConfigBlock('config {\n  type: "table",\n  description: "a } brace"\n}\nSELECT 1');
    expect(block).toContain('description: "a } brace"');
    expect(block).not.toContain("SELECT");
  });
});

describe("parseSqlx identity + type mapping", () => {
  it("keys a declaration by config.name, not the filename", () => {
    const node = parseSqlx("sources/raw_fare_snapshots.sqlx", read("sources/raw_fare_snapshots.sqlx"));
    expect(node.id).toBe("fare_snapshots"); // downstream refs it as ref("fare_snapshots")
    expect(node.type).toBe("source"); // declaration -> source
  });

  it("falls back to the basename when no name is declared", () => {
    const node = parseSqlx("intermediate/int_trip_fares.sqlx", read("intermediate/int_trip_fares.sqlx"));
    expect(node.id).toBe("int_trip_fares");
  });

  it("maps incremental and assertion types through", () => {
    expect(parseSqlx("x.sqlx", read("intermediate/int_daily_fare_stats.sqlx")).type).toBe("incremental");
    expect(parseSqlx("x.sqlx", read("assertions/assert_snapshot_freshness.sqlx")).type).toBe("assertion");
  });
});

describe("parseSqlx description", () => {
  it("unescapes literal \\n inside a long quoted description", () => {
    const node = parseSqlx("reference/dim_events.sqlx", read("reference/dim_events.sqlx"));
    expect(node.description).toBeTruthy();
    expect(node.description).toContain("\n"); // dim_events embeds \n\n paragraph breaks
    expect(node.description).not.toContain("\\n"); // ...unescaped, not the literal backslash-n
  });
});

describe("parseSqlx config.dependencies", () => {
  const parse = (config: string) => parseSqlx("definitions/x.sqlx", `config { ${config} }\nSELECT 1`);

  it("reads an array of explicit dependencies", () => {
    expect(parse('type: "table", dependencies: ["a", "b"]').refs).toEqual(["a", "b"]);
  });

  it("reads the bare string form", () => {
    expect(parse('type: "operations", dependencies: "solo_action"').refs).toEqual(["solo_action"]);
  });

  it("takes only `name` from the target-object form", () => {
    const node = parse('dependencies: [{ schema: "staging", name: "obj_dep" }]');
    expect(node.refs).toEqual(["obj_dep"]); // not "staging"
  });

  it("mixes object and string entries in one array", () => {
    expect(parse('dependencies: ["plain", { schema: "s", name: "obj" }]').refs).toEqual([
      "plain",
      "obj",
    ]);
  });

  it("unions ref() calls with explicit dependencies, refs first", () => {
    const node = parseSqlx(
      "definitions/x.sqlx",
      'config { dependencies: ["explicit"] }\nSELECT * FROM ${ref("from_ref")}',
    );
    expect(node.refs).toEqual(["from_ref", "explicit"]);
  });

  it("does not duplicate a dependency that is also reached by ref()", () => {
    const node = parseSqlx(
      "definitions/x.sqlx",
      'config { dependencies: ["shared"] }\nSELECT * FROM ${ref("shared")}',
    );
    expect(node.refs).toEqual(["shared"]);
  });

  it("returns no extra refs when dependencies is absent", () => {
    expect(parse('type: "table"').refs).toEqual([]);
  });

  it("is not fooled by a dependencies key inside a comment", () => {
    expect(parse('type: "table" // dependencies: ["ghost"]').refs).toEqual([]);
  });
});

describe("parseSqlx top-level key resolution", () => {
  const parse = (config: string) => parseSqlx("definitions/x.sqlx", `config { ${config} }\nSELECT 1`);

  // A target object carries its own `name`. Reading the first `name:` anywhere in the block made an
  // assertion adopt its dependency's id, so two unrelated files collided on one node.
  it("does not take the node id from a nested dependency target's name", () => {
    const node = parse('type: "assertion", dependencies: [{ schema: "staging", name: "stg_sessions" }]');
    expect(node.id).toBe("x");
    expect(node.type).toBe("assertion");
    expect(node.refs).toEqual(["stg_sessions"]);
  });

  it("still reads a top-level name declared after a nested object", () => {
    const node = parse('dependencies: [{ schema: "s", name: "dep" }], name: "real_name"');
    expect(node.id).toBe("real_name");
  });

  it("does not take type from a nested object", () => {
    expect(parse('bigquery: { type: "operations" }, type: "view"').type).toBe("view");
  });

  it("ignores tags nested inside another key", () => {
    expect(parse('assertions: { tags: ["nested"] }, tags: ["real"]').tags).toEqual(["real"]);
  });

  it("is unaffected by a brace inside a description string", () => {
    const node = parse('description: "uses { braces } inline", name: "described"');
    expect(node.id).toBe("described");
    expect(node.description).toBe("uses { braces } inline");
  });
});

describe("extractRefs", () => {
  it("finds ref() calls and ignores self()/when()/projectConfig template calls", () => {
    const refs = extractRefs(read("intermediate/int_daily_fare_stats.sqlx"));
    expect(refs).toContain("int_trip_fares");
    expect(refs).not.toContain("self"); // ${self()} is not a ref
  });

  it("dedupes repeated refs, preserving first-seen order", () => {
    const refs = extractRefs('SELECT * FROM ${ref("a")} JOIN ${ref("b")} JOIN ${ref("a")}');
    expect(refs).toEqual(["a", "b"]);
  });

  it("supports the object form ref({ name: ... })", () => {
    expect(extractRefs('FROM ${ref({ schema: "s", name: "obj_model" })}')).toEqual(["obj_model"]);
  });

  // KNOWN regex-tier limitation: extractRefs scans the whole file, so a ref() inside a SQL comment
  // is still extracted, whereas `dataform compile` ignores commented SQL. This is a deliberate
  // fidelity tradeoff (like the inline-assertion gap) — a correct SQL comment stripper must handle
  // `--`, `/* */`, AND `--` sequences inside string literals, which isn't worth the risk for the
  // regex tier. Use CompiledGraphSource when this matters. This test pins the behavior so it's a
  // documented boundary, not a silent surprise.
  it("(known limitation) still extracts a ref that is commented out in the SQL body", () => {
    expect(extractRefs('SELECT 1 -- legacy join ${ref("legacy_table")}\nFROM ${ref("real")}')).toEqual([
      "legacy_table",
      "real",
    ]);
  });
});
