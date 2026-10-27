import type { NodeType } from "@dataform-dag/core";
import { NODE_COLORS, labelOf, type UiGraph, type UiNode } from "./graphToFlow.js";

/** Mermaid refuses to render a flowchart with more edges than this unless configured otherwise. */
export const MERMAID_MAX_EDGES = 500;

export interface MermaidOptions {
  /**
   * The open folder a canvas node is drawn inside ("" or null for none). Open folders become nested
   * `subgraph`s, the way they are boxes on the canvas; collapsed folders are nodes of their own.
   */
  folderOf?: (node: UiNode) => string | null;
  /** Nodes drawn as context (a tag filter's neighbors, focus mode's bridges): dashed. */
  context?: ReadonlySet<string>;
  /** Focus mode's root(s): a heavier outline. */
  roots?: ReadonlySet<string>;
}

/**
 * The canvas graph as a Mermaid flowchart. It takes the graph AFTER filtering and grouping, so the
 * export is the view on screen: a whole large project is past what Mermaid will draw anyway.
 *
 * Node ids are generated (`n0`, `n1`…) and the real name goes in the label: a qualified name like
 * `a.orders`, or a name like `end`, would otherwise break Mermaid's syntax.
 */
export function toMermaid(graph: UiGraph, options: MermaidOptions = {}): string {
  const ids = new Map(graph.nodes.map((n, i) => [n.id, `n${i}`]));
  const lines = ["flowchart LR"];

  // Nest each node under its open folders. Paths are "a/b/c"; every prefix is its own subgraph.
  const tree: FolderNode = { children: new Map(), nodes: [] };
  for (const node of graph.nodes) {
    let at = tree;
    for (const segment of splitPath(options.folderOf?.(node) ?? null)) {
      if (!at.children.has(segment)) at.children.set(segment, { children: new Map(), nodes: [] });
      at = at.children.get(segment)!;
    }
    at.nodes.push(node);
  }
  let subgraphs = 0;
  const emit = (folder: FolderNode, path: string, indent: string): void => {
    for (const node of folder.nodes) lines.push(`${indent}${ids.get(node.id)}${shape(node)}:::${classOf(node)}`);
    for (let [segment, child] of folder.children) {
      // A folder holding just one subfolder is one box, not two nested ones (the canvas never draws
      // such pass-through folders either).
      while (child.nodes.length === 0 && child.children.size === 1) {
        const [next, only] = [...child.children][0]!;
        segment = `${segment}/${next}`;
        child = only;
      }
      const childPath = path ? `${path}/${segment}` : segment;
      lines.push(`${indent}subgraph f${subgraphs++}["${escape(`${childPath}/`)}"]`);
      emit(child, childPath, `${indent}  `);
      lines.push(`${indent}end`);
    }
  };
  emit(tree, "", "  ");

  for (const node of graph.nodes) {
    for (const ref of node.refs) {
      const from = ids.get(ref);
      if (from) lines.push(`  ${from} --> ${ids.get(node.id)}`);
    }
  }

  const used = new Set(graph.nodes.map(classOf));
  for (const type of Object.keys(NODE_COLORS) as NodeType[]) {
    if (!used.has(type)) continue;
    const hex = fallbackHex(NODE_COLORS[type]);
    lines.push(`  classDef ${type} fill:${hex}33,stroke:${hex},stroke-width:1.5px`);
  }
  if (used.has("folder")) lines.push(`  classDef folder fill:none,stroke:${FOLDER_HEX},stroke-width:1.5px`);
  const marked = (set: ReadonlySet<string> | undefined) =>
    graph.nodes.filter((n) => set?.has(n.id)).map((n) => ids.get(n.id)!);
  const context = marked(options.context);
  if (context.length > 0) {
    lines.push("  classDef context stroke-dasharray:4 3,opacity:0.65");
    lines.push(`  class ${context.join(",")} context`);
  }
  const roots = marked(options.roots);
  if (roots.length > 0) {
    lines.push("  classDef root stroke-width:3px");
    lines.push(`  class ${roots.join(",")} root`);
  }
  return `${lines.join("\n")}\n`;
}

/** How many edges {@link toMermaid} draws, to warn before Mermaid refuses the diagram. */
export function edgeCount(graph: UiGraph): number {
  const present = new Set(graph.nodes.map((n) => n.id));
  return graph.nodes.reduce((sum, n) => sum + n.refs.filter((r) => present.has(r)).length, 0);
}

interface FolderNode {
  children: Map<string, FolderNode>;
  nodes: UiNode[];
}

const FOLDER_HEX = "#8a94a6";

function classOf(node: UiNode): NodeType | "folder" {
  return node.folder ? "folder" : node.type;
}

/** A shape per kind, so the type still reads where the colors don't (a monochrome render). */
function shape(node: UiNode): string {
  const label = `"${escape(labelOf(node))}"`;
  if (node.folder) return `[[${label}]]`;
  switch (node.type) {
    case "source":
      return `[(${label})]`;
    case "view":
      return `(${label})`;
    case "assertion":
      return `{{${label}}}`;
    default:
      return `[${label}]`;
  }
}

/** The hex fallback inside a `var(--x, #hex)` color: Mermaid can't see the editor's CSS variables. */
function fallbackHex(color: string): string {
  return /#[0-9a-f]{6}/i.exec(color)?.[0] ?? FOLDER_HEX;
}

/** Inside a quoted Mermaid label only `"` is special; its entity form renders as a quote. */
function escape(text: string): string {
  return text.replace(/"/g, "#quot;");
}

function splitPath(path: string | null): string[] {
  return path ? path.split("/") : [];
}
