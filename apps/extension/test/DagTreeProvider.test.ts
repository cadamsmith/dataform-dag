import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataformNode, NodeType, SerializedGraph } from "@dataform-dag/core";
import { DagTreeProvider, NODE_CONTEXT_VALUE, type TreeEntry } from "../src/dagTreeProvider.js";
import { EventEmitter, TreeItem, TreeItemCollapsibleState, resetMock } from "./mocks/vscode.js";

/**
 * The provider only needs three things from the store, so it gets a stub instead of the real one —
 * these tests are about grouping and item shape, not about building graphs.
 */
function fakeStore(graph?: SerializedGraph) {
  const emitter = new EventEmitter<SerializedGraph>();
  return {
    current: graph,
    onDidChangeGraph: emitter.event,
    ensureGraph: vi.fn(async () => "ok" as const),
    /** Simulate a rebuild landing. */
    publish(next: SerializedGraph): void {
      this.current = next;
      emitter.fire(next);
    },
  };
}

function node(id: string, type: NodeType, extra: Partial<DataformNode> = {}): DataformNode {
  return { id, type, filePath: `/proj/definitions/${id}.sqlx`, tags: [], refs: [], ...extra };
}

function graphOf(...nodes: DataformNode[]): SerializedGraph {
  return { nodes, downstream: [], issues: [] };
}

const providerFor = (graph?: SerializedGraph) => {
  const store = fakeStore(graph);
  return { store, tree: new DagTreeProvider(store as never) };
};

/** Group entries, asserted by type — the shape the top level always returns. */
const groupTypes = (entries: TreeEntry[]): string[] =>
  entries.map((e) => (e.kind === "group" ? e.type : `node:${e.node.id}`));

beforeEach(resetMock);

describe("grouping", () => {
  it("groups by node type, in legend order, skipping types the project doesn't use", async () => {
    const { tree } = providerFor(
      graphOf(
        node("agg_nightly", "table"),
        node("raw_sessions", "source"),
        node("assert_has_session", "assertion"),
      ),
    );
    expect(groupTypes(await tree.getChildren())).toEqual(["source", "table", "assertion"]);
  });

  it("sorts nodes within a group by target name", async () => {
    const { tree } = providerFor(
      graphOf(node("stg_sessions", "view"), node("dim_objects", "view"), node("int_quality", "view")),
    );
    const [group] = await tree.getChildren();
    const children = await tree.getChildren(group);
    expect(children.map((c) => (c.kind === "node" ? c.node.id : ""))).toEqual([
      "dim_objects",
      "int_quality",
      "stg_sessions",
    ]);
  });

  it("counts the group's nodes in its description", async () => {
    const { tree } = providerFor(graphOf(node("a", "table"), node("b", "table")));
    const [group] = await tree.getChildren();
    const item = tree.getTreeItem(group) as TreeItem;
    expect(item.label).toBe("table");
    expect(item.description).toBe("2");
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
  });

  it("keeps compiled-mode assertions as separate rows even though they share a model's file", async () => {
    // `dataform compile` synthesizes an assertion action per inline config.assertions entry; both it
    // and the model report the same fileName.
    const { tree } = providerFor(
      graphOf(
        node("fct_observations", "table", { filePath: "/proj/definitions/fct_observations.sqlx" }),
        node("fct_observations_assertions_rowConditions", "assertion", {
          filePath: "/proj/definitions/fct_observations.sqlx",
        }),
      ),
    );
    const groups = await tree.getChildren();
    expect(groupTypes(groups)).toEqual(["table", "assertion"]);

    // Both rows point at the same file, so their ids must come from the target name, not the path.
    const ids = [];
    for (const group of groups) {
      for (const leaf of await tree.getChildren(group)) {
        const item = tree.getTreeItem(leaf) as TreeItem;
        ids.push([item.id, item.resourceUri?.fsPath]);
      }
    }
    expect(ids).toEqual([
      ["node:fct_observations", "/proj/definitions/fct_observations.sqlx"],
      ["node:fct_observations_assertions_rowConditions", "/proj/definitions/fct_observations.sqlx"],
    ]);
  });

  it("returns nothing under a leaf node", async () => {
    const { tree } = providerFor(graphOf(node("a", "table")));
    const [group] = await tree.getChildren();
    const [leaf] = await tree.getChildren(group);
    expect(await tree.getChildren(leaf)).toEqual([]);
  });
});

describe("node items", () => {
  it("labels by target name, shows tags, and opens the node on click", async () => {
    const { tree } = providerFor(
      graphOf(node("fare_snapshots", "source", { tags: ["raw", "hourly"] })),
    );
    const [group] = await tree.getChildren();
    const [leaf] = await tree.getChildren(group);
    const item = tree.getTreeItem(leaf) as TreeItem;

    expect(item.label).toBe("fare_snapshots");
    expect(item.description).toBe("raw hourly");
    expect(item.contextValue).toBe(NODE_CONTEXT_VALUE);
    expect(item.resourceUri?.fsPath).toBe("/proj/definitions/fare_snapshots.sqlx");
    expect(item.command).toMatchObject({ command: "dataformDag.revealNode", arguments: [leaf] });
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
  });

  it("puts the file, description, tags, and refs in the tooltip", async () => {
    const { tree } = providerFor(
      graphOf(
        node("fct_observations", "table", {
          tags: ["marts"],
          refs: ["stg_observations", "dim_objects"],
          description: "One row per logged observation.",
        }),
      ),
    );
    const [group] = await tree.getChildren();
    const [leaf] = await tree.getChildren(group);
    const { value } = (tree.getTreeItem(leaf) as TreeItem).tooltip as { value: string };

    expect(value).toContain("fct_observations.sqlx");
    expect(value).toContain("One row per logged observation.");
    expect(value).toContain("Tags: marts");
    expect(value).toContain("Depends on: stg_observations, dim_objects");
  });
});

describe("store wiring", () => {
  it("builds on demand the first time the view asks for children", async () => {
    const { store, tree } = providerFor(undefined);
    expect(await tree.getChildren()).toEqual([]);
    expect(store.ensureGraph).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild once a graph exists", async () => {
    const { store, tree } = providerFor(graphOf(node("a", "table")));
    await tree.getChildren();
    expect(store.ensureGraph).not.toHaveBeenCalled();
  });

  it("refreshes the whole tree when the store publishes a rebuild", async () => {
    const { store, tree } = providerFor(graphOf(node("a", "table")));
    const changed = vi.fn();
    tree.onDidChangeTreeData(changed);

    store.publish(graphOf(node("a", "table"), node("b", "source")));

    expect(changed).toHaveBeenCalledWith(undefined);
    expect(groupTypes(await tree.getChildren())).toEqual(["source", "table"]);
  });

  it("stops listening to the store once disposed", () => {
    const { store, tree } = providerFor(graphOf(node("a", "table")));
    const changed = vi.fn();
    tree.onDidChangeTreeData(changed);
    tree.dispose();

    store.publish(graphOf(node("b", "view")));
    expect(changed).not.toHaveBeenCalled();
  });
});
