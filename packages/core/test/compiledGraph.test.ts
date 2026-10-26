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
