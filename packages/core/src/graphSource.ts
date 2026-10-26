import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DataformGraph, DataformNode, NodeType } from "./types.js";
import { buildGraph } from "./graph.js";

/**
 * A producer of a {@link DataformGraph}. {@link CompiledGraphSource} is the only implementation;
 * hosts and UI depend on this seam, never on how the graph was derived.
 */
export interface GraphSource {
  build(): Promise<DataformGraph>;
}

/** The subset of `dataform compile --json` output this mapper reads. */
export interface CompileOutput {
  tables?: CompileAction[];
  operations?: CompileAction[];
  assertions?: CompileAction[];
  declarations?: CompileAction[];
  graphErrors?: { compilationErrors?: CompilationErrorEntry[] | null } | null;
}
export interface CompilationErrorEntry {
  fileName?: string;
  message?: string;
}
export interface CompileTarget {
  name: string;
  schema?: string;
  database?: string;
}

/**
 * One compiled action. The `*Query`/`*Ops` fields carry the SQL Dataform actually resolved — every
 * `${...}`, `ref()`, `self()`, include and JS block already expanded — which is what makes a local
 * preview possible without touching BigQuery. Which fields are populated depends on the action:
 * tables/views/assertions use `query`, an `incremental` table adds `incrementalQuery` plus the
 * incremental pre/post variants, and `operations` carries a `queries` list instead of a single one.
 */
export interface CompileAction {
  target: CompileTarget;
  type?: string;
  fileName?: string;
  tags?: string[] | null;
  dependencyTargets?: CompileTarget[] | null;
  actionDescriptor?: { description?: string } | null;
  query?: string;
  incrementalQuery?: string;
  queries?: string[] | null;
  preOps?: string[] | null;
  postOps?: string[] | null;
  incrementalPreOps?: string[] | null;
  incrementalPostOps?: string[] | null;
}

/** A labelled block of compiled SQL, ready to render in order. */
export interface CompiledSqlSection {
  label: string;
  sql: string;
}

/**
 * Map a parsed `dataform compile --json` payload to a {@link DataformGraph}. Pure and CLI-free, so
 * it's unit-tested against a committed golden fixture and reused by {@link CompiledGraphSource}.
 * Declarations become `source` nodes; assertions (including the ones Dataform generates from inline
 * `config.assertions`) become `assertion` nodes; edges come straight from `dependencyTargets`.
 */
export function graphFromCompileOutput(output: CompileOutput): DataformGraph {
  const nodes: DataformNode[] = [];
  const collect = (actions: CompileAction[] | undefined, fallback: NodeType) => {
    for (const a of actions ?? []) nodes.push(toNode(a, fallback));
  };
  collect(output.tables, "table");
  collect(output.operations, "operations");
  collect(output.assertions, "assertion");
  collect(output.declarations, "source");
  return buildGraph(nodes);
}

function toNode(a: CompileAction, fallback: NodeType): DataformNode {
  return {
    id: a.target.name,
    filePath: a.fileName ?? a.target.name,
    type: mapCompileType(a.type, fallback),
    tags: a.tags ?? [],
    refs: (a.dependencyTargets ?? []).map((t) => t.name),
    description: a.actionDescriptor?.description,
  };
}

function mapCompileType(type: string | undefined, fallback: NodeType): NodeType {
  switch (type) {
    case "table":
    case "view":
    case "incremental":
    case "operations":
    case "assertion":
      return type;
    case "declaration":
      return "source";
    default:
      return fallback;
  }
}

/**
 * Every populated SQL block on an action, in execution order, labelled for display. An `operations`
 * action can hold several statements; an incremental table has both a full-refresh and an
 * incremental variant, and each gets its own section rather than being silently collapsed.
 */
export function compiledSqlSections(action: CompileAction): CompiledSqlSection[] {
  const sections: CompiledSqlSection[] = [];
  const push = (label: string, sql: string | undefined | null) => {
    if (typeof sql === "string" && sql.trim() !== "") sections.push({ label, sql });
  };
  const pushAll = (label: string, list: string[] | null | undefined) => {
    const items = (list ?? []).filter((s) => typeof s === "string" && s.trim() !== "");
    // Only number them when there's more than one, so the common single-statement case stays clean.
    items.forEach((sql, i) => push(items.length > 1 ? `${label} ${i + 1}` : label, sql));
  };
  pushAll("pre_operations", action.preOps);
  push("query", action.query);
  push("incremental query", action.incrementalQuery);
  pushAll("operation", action.queries);
  pushAll("post_operations", action.postOps);
  pushAll("incremental pre_operations", action.incrementalPreOps);
  pushAll("incremental post_operations", action.incrementalPostOps);
  return sections;
}

/** Compare file paths from `dataform compile` against host paths: `\` → `/`, drop a leading `./`. */
function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

/**
 * Find the compiled action a `.sqlx` produced. One file can yield SEVERAL actions — a table plus the
 * assertions Dataform generates from inline `config.assertions` — so `targetName` disambiguates when
 * the caller knows which node it wants; without it the first match wins, which is the table rather
 * than a generated assertion because {@link graphFromCompileOutput} collects tables first.
 */
export function findCompiledActionByFile(
  output: CompileOutput,
  filePath: string,
  targetName?: string,
): CompileAction | undefined {
  const wanted = normalizeFilePath(filePath);
  const matches = [
    ...(output.tables ?? []),
    ...(output.operations ?? []),
    ...(output.assertions ?? []),
  ].filter((a) => a.fileName !== undefined && normalizeFilePath(a.fileName) === wanted);
  if (targetName) {
    const exact = matches.find((a) => a.target.name === targetName);
    if (exact) return exact;
  }
  return matches[0];
}

const execFileAsync = promisify(execFile);

/**
 * The Dataform CLI could not be started at all (`ENOENT`) — distinct from a project that fails to
 * compile, so a host can offer install instructions instead of echoing a compile error.
 */
export class DataformCliNotFoundError extends Error {
  constructor(readonly command: string) {
    super(`Dataform CLI not found: ${command}`);
    this.name = "DataformCliNotFoundError";
  }
}

/**
 * The project ran through the CLI but did not compile. `dataform compile --json` still prints JSON in
 * that case (and exits 1); its `graphErrors.compilationErrors` become {@link errors}, and the message
 * is one `file: error` line each, rather than the CLI's ANSI-coloured stderr with stack traces.
 */
export class DataformCompilationError extends Error {
  constructor(readonly errors: CompilationErrorEntry[]) {
    super(
      errors
        .map((e) => (e.fileName ? `${e.fileName}: ${e.message ?? "error"}` : (e.message ?? "error")))
        .join("\n"),
    );
    this.name = "DataformCompilationError";
  }
}

/** The compile errors in a `--json` payload, or none if `stdout` isn't one. */
function compilationErrorsIn(stdout: string | undefined): CompilationErrorEntry[] {
  if (!stdout) return [];
  try {
    return (JSON.parse(stdout) as CompileOutput).graphErrors?.compilationErrors ?? [];
  } catch {
    return [];
  }
}

/**
 * Pick the CLI to run for `root`: an explicitly configured path wins, then the project's own
 * `node_modules/.bin/dataform` (so the CLI version matches the project's `@dataform/core`), then
 * `dataform` on PATH.
 */
export function resolveDataformCli(root: string, configured?: string): string {
  if (configured && configured.trim() !== "") return configured.trim();
  const local = join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "dataform.cmd" : "dataform",
  );
  return existsSync(local) ? local : "dataform";
}

/**
 * Run `dataform compile --json` in `root` and parse the payload. Node-only (spawns a process);
 * requires the CLI and a project that compiles. Separate from {@link CompiledGraphSource} because
 * the raw output carries compiled SQL that the graph mapping discards — a host that wants both a
 * graph and a SQL preview compiles once and reuses this result for each.
 */
export async function compileDataformProject(
  root: string,
  command = "dataform",
): Promise<CompileOutput> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(command, ["compile", "--json"], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      // On Windows the installed CLI is the `dataform.cmd` npm shim, which CreateProcess cannot run
      // directly; going through the shell is what resolves it.
      shell: process.platform === "win32",
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new DataformCliNotFoundError(command);
    const errors = compilationErrorsIn((err as { stdout?: string }).stdout);
    if (errors.length > 0) throw new DataformCompilationError(errors);
    throw err;
  }
  const output = JSON.parse(stdout) as CompileOutput;
  // Not every CLI version exits non-zero on a compile error; a partial graph must not pass as good.
  const errors = output.graphErrors?.compilationErrors ?? [];
  if (errors.length > 0) throw new DataformCompilationError(errors);
  return output;
}

/**
 * Shells out to `dataform compile --json` in a project root and maps the result. Node-only (spawns
 * a process); requires the CLI and a compiling project. The exact graph Dataform itself resolves.
 */
export class CompiledGraphSource implements GraphSource {
  constructor(
    private readonly root: string,
    private readonly command = "dataform",
  ) {}

  async build(): Promise<DataformGraph> {
    return graphFromCompileOutput(await compileDataformProject(this.root, this.command));
  }
}
