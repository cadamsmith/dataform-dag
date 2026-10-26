import type { DataformNode, NodeType } from "@dataform-dag/core";
import { FOLDER_COLOR } from "./graphToFlow.js";
import { DetailHead, NeighborList } from "./NodeDetailPanel.js";

export interface FolderDetailPanelProps {
  path: string;
  /** Every node inside, at any depth. */
  members: DataformNode[];
  /** Canvas neighbors: nodes or other folders this folder's members depend on / are used by. */
  upstream: string[];
  downstream: string[];
  typeOf?: (nodeId: string) => NodeType | undefined;
  onSelect: (nodeId: string) => void;
  onExpand: () => void;
  /** Fold this folder back into its parent; absent at the top level. */
  onCollapseParent?: { path: string; collapse: () => void };
  onClose?: () => void;
}

/** A folder is a jump list, not a browser: past this many members, expand it instead. */
const MAX_LISTED = 50;

/** What a collapsed folder stands for, and the way into it. */
export function FolderDetailPanel({
  path,
  members,
  upstream,
  downstream,
  typeOf,
  onSelect,
  onExpand,
  onCollapseParent,
  onClose,
}: FolderDetailPanelProps): JSX.Element {
  const byType = new Map<NodeType, number>();
  for (const m of members) byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
  const listed = members.slice(0, MAX_LISTED);
  return (
    <aside className="ddag-detail" style={{ ["--type" as string]: FOLDER_COLOR }}>
      <DetailHead type="folder" kicker="folder" title={`${path}/`} onClose={onClose} />
      <p className="ddag-detail__desc">
        {members.length.toLocaleString()} nodes:{" "}
        {[...byType]
          .sort((a, b) => b[1] - a[1])
          .map(([type, n]) => `${n.toLocaleString()} ${type}`)
          .join(", ")}
      </p>
      <div className="ddag-detail__actions">
        <button type="button" className="ddag-btn ddag-btn--primary" onClick={onExpand}>
          Expand
        </button>
        {onCollapseParent && (
          <button type="button" className="ddag-btn" onClick={onCollapseParent.collapse}>
            Collapse {onCollapseParent.path}/
          </button>
        )}
      </div>
      <NeighborList title="Depends on" ids={upstream} typeOf={typeOf} onSelect={onSelect} />
      <NeighborList title="Used by" ids={downstream} typeOf={typeOf} onSelect={onSelect} />
      <NeighborList
        title={members.length > MAX_LISTED ? `Inside (first ${MAX_LISTED})` : "Inside"}
        ids={listed.map((m) => m.id)}
        typeOf={typeOf}
        onSelect={onSelect}
      />
    </aside>
  );
}
