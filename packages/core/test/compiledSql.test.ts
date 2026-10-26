import { describe, expect, it } from "vitest";
import {
  compiledSqlSections,
  findCompiledActionByFile,
  type CompileAction,
  type CompileOutput,
} from "../src/index.js";

const action = (over: Partial<CompileAction> = {}): CompileAction => ({
  target: { name: "t" },
  fileName: "definitions/t.sqlx",
  ...over,
});

describe("compiledSqlSections", () => {
  it("returns nothing when the action carries no SQL", () => {
    expect(compiledSqlSections(action())).toEqual([]);
  });

  it("emits a single query as one unnumbered section", () => {
    expect(compiledSqlSections(action({ query: "SELECT 1" }))).toEqual([
      { label: "query", sql: "SELECT 1" },
    ]);
  });

  it("keeps the full and incremental variants as separate sections", () => {
    const sections = compiledSqlSections(
      action({ query: "SELECT 1", incrementalQuery: "SELECT 2 WHERE ts > x" }),
    );
    expect(sections.map((s) => s.label)).toEqual(["query", "incremental query"]);
  });

  it("numbers an operations action's statements", () => {
    const sections = compiledSqlSections(action({ queries: ["CREATE A", "CREATE B"] }));
    expect(sections).toEqual([
      { label: "operation 1", sql: "CREATE A" },
      { label: "operation 2", sql: "CREATE B" },
    ]);
  });

  it("does not number a lone operations statement", () => {
    expect(compiledSqlSections(action({ queries: ["ONLY"] }))[0]?.label).toBe("operation");
  });

  it("orders pre_operations before the query and post_operations after", () => {
    const sections = compiledSqlSections(
      action({ preOps: ["DECLARE x"], query: "SELECT 1", postOps: ["GRANT SELECT"] }),
    );
    expect(sections.map((s) => s.label)).toEqual(["pre_operations", "query", "post_operations"]);
  });

  it("includes the incremental pre/post variants", () => {
    const sections = compiledSqlSections(
      action({ incrementalPreOps: ["DECLARE y"], incrementalPostOps: ["MERGE"] }),
    );
    expect(sections.map((s) => s.label)).toEqual([
      "incremental pre_operations",
      "incremental post_operations",
    ]);
  });

  it("skips empty and whitespace-only statements", () => {
    expect(compiledSqlSections(action({ query: "   ", preOps: ["", "  "], queries: null }))).toEqual(
      [],
    );
  });
});

describe("findCompiledActionByFile", () => {
  const output: CompileOutput = {
    tables: [action({ target: { name: "orders" }, fileName: "definitions/orders.sqlx" })],
    assertions: [
      action({
        target: { name: "orders_assertions_uniqueKey" },
        fileName: "definitions/orders.sqlx",
      }),
    ],
    operations: [action({ target: { name: "grant" }, fileName: "definitions/ops/grant.sqlx" })],
  };

  it("finds the action a file produced", () => {
    expect(findCompiledActionByFile(output, "definitions/ops/grant.sqlx")?.target.name).toBe(
      "grant",
    );
  });

  it("prefers the table over a generated assertion from the same file", () => {
    expect(findCompiledActionByFile(output, "definitions/orders.sqlx")?.target.name).toBe("orders");
  });

  it("selects the exact action when a target name disambiguates", () => {
    const found = findCompiledActionByFile(
      output,
      "definitions/orders.sqlx",
      "orders_assertions_uniqueKey",
    );
    expect(found?.target.name).toBe("orders_assertions_uniqueKey");
  });

  it("selects the action a schema-qualified node id names", () => {
    const qualified: CompileOutput = {
      tables: [
        action({ target: { schema: "a", name: "dup" }, fileName: "definitions/dup.sqlx" }),
        action({ target: { schema: "b", name: "dup" }, fileName: "definitions/dup.sqlx" }),
      ],
    };
    const found = findCompiledActionByFile(qualified, "definitions/dup.sqlx", "b.dup");
    expect(found?.target.schema).toBe("b");
  });

  it("finds nothing when the node id names none of the file's actions", () => {
    // Falling back to a sibling would show another action's SQL under this node.
    expect(findCompiledActionByFile(output, "definitions/orders.sqlx", "nope")).toBeUndefined();
  });

  it("resolves a declaration in a .js file to itself, not to a sibling it publishes", () => {
    const js: CompileOutput = {
      tables: [
        action({
          target: { name: "rollup" },
          fileName: "definitions/feed.js",
          query: "select * from raw_feed",
        }),
      ],
      declarations: [action({ target: { name: "raw_feed" }, fileName: "definitions/feed.js" })],
    };
    const found = findCompiledActionByFile(js, "definitions/feed.js", "raw_feed");
    expect(found?.target.name).toBe("raw_feed");
    expect(compiledSqlSections(found!)).toEqual([]);
    // Without a node id the table still wins over the declaration.
    expect(findCompiledActionByFile(js, "definitions/feed.js")?.target.name).toBe("rollup");
  });

  it("matches across separator and leading-./ differences", () => {
    expect(findCompiledActionByFile(output, "./definitions\\ops\\grant.sqlx")?.target.name).toBe(
      "grant",
    );
  });

  it("returns undefined for a file that produced nothing", () => {
    expect(findCompiledActionByFile(output, "definitions/absent.sqlx")).toBeUndefined();
  });
});
