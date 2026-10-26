import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DataformCliNotFoundError,
  DataformCompilationError,
  compileDataformProject,
  graphFromCompileOutput,
  resolveDataformCli,
  type CompileOutput,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Regenerate with `dataform compile --json` in `test/fixtures` when the fixture project changes.
const golden = JSON.parse(
  readFileSync(join(HERE, "fixtures", "compile.golden.json"), "utf8"),
) as CompileOutput;
const compiled = graphFromCompileOutput(golden);

const isInlineAssertion = (id: string) => id.includes("_assertions_");

describe("graphFromCompileOutput (golden dataform compile --json)", () => {
  it("emits one node per compiled action, including generated inline assertions", () => {
    expect(compiled.nodes.size).toBe(24);
    expect([...compiled.nodes.keys()].filter(isInlineAssertion)).toHaveLength(8);
  });

  it("takes each node's edges straight from dependencyTargets", () => {
    const all = [
      ...(golden.tables ?? []),
      ...(golden.operations ?? []),
      ...(golden.assertions ?? []),
      ...(golden.declarations ?? []),
    ];
    for (const action of all) {
      const node = compiled.nodes.get(action.target.name);
      expect(node, `missing ${action.target.name}`).toBeDefined();
      expect(new Set(node!.refs)).toEqual(
        new Set((action.dependencyTargets ?? []).map((t) => t.name)),
      );
    }
  });

  it("maps declarations to source nodes", () => {
    for (const d of golden.declarations ?? []) {
      expect(compiled.nodes.get(d.target.name)?.type).toBe("source");
    }
  });
});

describe("graphFromCompileOutput node ids", () => {
  // A valid project: `a.dup` and `b.dup` are told apart by schema, and every ref to them is qualified.
  const output: CompileOutput = {
    tables: [
      { target: { database: "p", schema: "a", name: "dup" }, fileName: "definitions/dup_a.sqlx" },
      { target: { database: "p", schema: "b", name: "dup" }, fileName: "definitions/dup_b.sqlx" },
      {
        target: { database: "p", schema: "marts", name: "uses_a" },
        fileName: "definitions/uses_a.sqlx",
        dependencyTargets: [{ database: "p", schema: "a", name: "dup" }],
      },
      {
        target: { database: "p", schema: "marts", name: "uses_b" },
        fileName: "definitions/uses_b.sqlx",
        dependencyTargets: [{ database: "p", schema: "b", name: "dup" }],
      },
    ],
  };
  const g = graphFromCompileOutput(output);

  it("qualifies a name shared across schemas instead of merging the two actions", () => {
    expect(g.nodes.get("a.dup")?.filePath).toBe("definitions/dup_a.sqlx");
    expect(g.nodes.get("b.dup")?.filePath).toBe("definitions/dup_b.sqlx");
    expect(g.nodes.has("dup")).toBe(false);
    expect(g.issues).toEqual([]);
  });

  it("points each ref at the action it actually names", () => {
    expect(g.nodes.get("uses_a")?.refs).toEqual(["a.dup"]);
    expect(g.nodes.get("uses_b")?.refs).toEqual(["b.dup"]);
  });

  it("leaves a unique name unqualified", () => {
    expect(g.nodes.has("uses_a")).toBe(true);
  });

  it("qualifies by database when the schema collides too", () => {
    const g2 = graphFromCompileOutput({
      tables: [
        { target: { database: "p1", schema: "s", name: "t" }, fileName: "one.sqlx" },
        { target: { database: "p2", schema: "s", name: "t" }, fileName: "two.sqlx" },
      ],
    });
    expect([...g2.nodes.keys()].sort()).toEqual(["p1.s.t", "p2.s.t"]);
  });
});

describe("resolveDataformCli", () => {
  const bin = process.platform === "win32" ? "dataform.cmd" : "dataform";

  it("prefers an explicitly configured path", () => {
    expect(resolveDataformCli("/nowhere", "  /opt/dataform  ")).toBe("/opt/dataform");
  });

  it("uses the project's own node_modules/.bin CLI when present", () => {
    const root = mkdtempSync(join(tmpdir(), "ddag-cli-"));
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(root, "node_modules", ".bin", bin), "");
    expect(resolveDataformCli(root)).toBe(join(root, "node_modules", ".bin", bin));
  });

  it("falls back to dataform on PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "ddag-cli-"));
    expect(resolveDataformCli(root, "")).toBe("dataform");
  });
});

describe("compileDataformProject", () => {
  // On Windows the CLI goes through the shell, which reports a missing command as an exit code.
  it.skipIf(process.platform === "win32")(
    "throws DataformCliNotFoundError when the CLI can't be started",
    async () => {
      await expect(
        compileDataformProject(tmpdir(), "/definitely/not/a/dataform-cli"),
      ).rejects.toBeInstanceOf(DataformCliNotFoundError);
    },
  );

  /** A fake CLI that prints `stdout` and exits with `code`, standing in for `dataform`. */
  function fakeCli(stdout: unknown, code: number): string {
    const dir = mkdtempSync(join(tmpdir(), "ddag-fake-"));
    const out = join(dir, "out.json");
    writeFileSync(out, JSON.stringify(stdout));
    const cli = join(dir, "dataform");
    writeFileSync(cli, `#!/bin/sh\ncat "${out}"\nexit ${code}\n`);
    chmodSync(cli, 0o755);
    return cli;
  }

  const broken = {
    tables: [],
    graphErrors: {
      compilationErrors: [
        { fileName: "definitions/zz.sqlx", message: "Unexpected end of input", stack: "…" },
      ],
    },
  };

  it.skipIf(process.platform === "win32")(
    "turns a failed compile's JSON errors into one line per file",
    async () => {
      const err = await compileDataformProject(tmpdir(), fakeCli(broken, 1)).catch((e) => e);
      expect(err).toBeInstanceOf(DataformCompilationError);
      expect(err.message).toBe("definitions/zz.sqlx: Unexpected end of input");
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a zero-exit payload that still carries compile errors",
    async () => {
      await expect(compileDataformProject(tmpdir(), fakeCli(broken, 0))).rejects.toBeInstanceOf(
        DataformCompilationError,
      );
    },
  );

  it.skipIf(process.platform === "win32")("returns a clean payload", async () => {
    const out = await compileDataformProject(tmpdir(), fakeCli({ tables: [], graphErrors: {} }, 0));
    expect(out.tables).toEqual([]);
  });
});
