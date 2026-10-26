import { describe, expect, it } from "vitest";
import type { DataformNode, SerializedGraph } from "@dataform-dag/core";
import {
  ancestorsOf,
  collapseFolders,
  folderTree,
  visibleFolder,
} from "../src/collapseFolders.js";

const node = (id: string, filePath: string, refs: string[] = []): DataformNode => ({
  id,
  filePath,
  type: "table",
  tags: [],
  refs,
});

/**
 *   defs/sources/raw ─▶ defs/core/fct ─▶ defs/agencies/a/x/daily ─▶ defs/agencies/a/x/pub
 *                                    └─▶ defs/agencies/b/daily_b
 *   defs/readme_model (at the root)
 *
 * `agencies/a` holds only `x`, so it's a pass-through.
 */
const graph: SerializedGraph = {
  nodes: [
    node("raw", "/p/defs/sources/raw.sqlx"),
    node("fct", "/p/defs/core/fct.sqlx", ["raw"]),
    node("daily", "/p/defs/agencies/a/x/daily.sqlx", ["fct"]),
    node("pub", "/p/defs/agencies/a/x/pub.sqlx", ["daily"]),
    node("daily_b", "/p/defs/agencies/b/daily_b.sqlx", ["fct"]),
    node("top", "/p/defs/top.sqlx", ["fct"]),
  ],
  downstream: [
    ["raw", ["fct"]],
    ["fct", ["daily", "daily_b", "top"]],
    ["daily", ["pub"]],
  ],
  issues: [],
};
const tree = folderTree(graph.nodes);
const ids = (g: { nodes: { id: string }[] }) => g.nodes.map((n) => n.id);

describe("folderTree", () => {
  it("is relative to the folder every node shares", () => {
    expect(tree.folderOfNode.get("daily")).toBe("agencies/a/x");
    expect(tree.folderOfNode.get("top")).toBe("");
    expect(tree.hasFolders).toBe(true);
  });
  it("marks a folder with one subfolder and no files as a pass-through", () => {
    expect([...tree.passThrough]).toEqual(["agencies/a"]);
  });
  it("has no folders when every file sits in one directory", () => {
    expect(folderTree([node("a", "d/a.sqlx"), node("b", "d/b.sqlx")]).hasFolders).toBe(false);
  });
});

describe("collapseFolders", () => {
  it("collapses top-level folders, keeps root files, and merges edges between folders", () => {
    const { graph: g, members } = collapseFolders(graph, tree, new Set());
    expect(ids(g)).toEqual(["folder:sources", "folder:core", "folder:agencies", "top"]);
    expect(g.nodes.find((n) => n.id === "folder:agencies")!.refs).toEqual(["folder:core"]);
    expect(g.nodes.find((n) => n.id === "top")!.refs).toEqual(["folder:core"]);
    expect(members.get("folder:agencies")!.map((m) => m.id)).toEqual(["daily", "daily_b", "pub"]);
    // No self-edge for the edge inside agencies.
    expect(new Map(g.downstream).get("folder:agencies")).toBeUndefined();
  });

  it("opens one level at a time, skipping pass-throughs", () => {
    const { graph: g } = collapseFolders(graph, tree, new Set(["agencies"]));
    expect(ids(g)).toContain("folder:agencies/a/x");
    expect(ids(g)).toContain("folder:agencies/b");
    expect(ids(g)).not.toContain("folder:agencies/a");
  });

  it("draws a node itself once every folder above it is open", () => {
    const { graph: g, folderOf } = collapseFolders(graph, tree, new Set(ancestorsOf("agencies/a/x")));
    expect(ids(g)).toContain("daily");
    expect(folderOf.has("daily")).toBe(false);
    expect(g.nodes.find((n) => n.id === "daily")!.refs).toEqual(["folder:core"]);
  });

  it("finds the outermost collapsed folder above a path", () => {
    expect(visibleFolder("agencies/a/x", tree, new Set())).toBe("agencies");
    expect(visibleFolder("agencies/a/x", tree, new Set(["agencies"]))).toBe("agencies/a/x");
    expect(visibleFolder("", tree, new Set())).toBeNull();
  });
});

describe("folderTree with actions that have no file", () => {
  it("puts them at the root without moving the root", () => {
    const t = folderTree([
      node("a", "/p/defs/x/a.sqlx"),
      node("b", "/p/defs/y/b.sqlx"),
      // core's stand-in when an action has no fileName, resolved against the project by the host.
      node("declared", "/p/declared"),
      node("blank", ""),
    ]);
    expect(t.folderOfNode.get("a")).toBe("x");
    expect(t.folderOfNode.get("declared")).toBe("");
    expect(t.folderOfNode.get("blank")).toBe("");
  });
});
