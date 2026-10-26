import type { NodeType } from "@dataform-dag/core";
import { NODE_COLORS } from "./graphToFlow.js";
import { TypeIcon } from "./TypeIcon.js";

export interface FocusBarProps {
  /** What's focused: a node id, or "N assertions" for a cluster. */
  label: string;
  type: NodeType;
  upstream: number;
  downstream: number;
  /** Hops each way, or null for the whole lineage. */
  depth: number | null;
  /** The deepest the lineage goes, so the stepper knows where "All" begins. */
  maxDepth: number;
  onDepthChange: (depth: number | null) => void;
  onExit: () => void;
}

/** States focus mode under the topbar: what's focused, how much lineage is shown, and the way out. */
export function FocusBar({
  label,
  type,
  upstream,
  downstream,
  depth,
  maxDepth,
  onDepthChange,
  onExit,
}: FocusBarProps): JSX.Element {
  // Stepping down from "All" starts one below the deepest real hop, so every click changes what's
  // shown; stepping up past the deepest hop is the same as "All", so it becomes "All".
  const shown = depth ?? maxDepth;
  const less = (): void => onDepthChange(Math.max(1, shown - 1));
  const more = (): void => onDepthChange(shown + 1 >= maxDepth ? null : shown + 1);
  return (
    <div className="ddag-focusbar" role="region" aria-label="Focus mode">
      <span className="ddag-focusbar__lead">Focused on</span>
      <span className="ddag-focusbar__target" style={{ ["--type" as string]: NODE_COLORS[type] }}>
        <TypeIcon type={type} />
        {label}
      </span>
      <span className="ddag-focusbar__counts">
        {upstream} upstream, {downstream} downstream
      </span>
      <span className="ddag-stepper" role="group" aria-label="Lineage depth">
        <button
          type="button"
          className="ddag-stepper__btn"
          aria-label="Fewer hops"
          disabled={shown <= 1}
          onClick={less}
        >
          −
        </button>
        <span className="ddag-stepper__value" aria-live="polite">
          {depth === null ? "All" : `${depth} ${depth === 1 ? "hop" : "hops"}`}
        </span>
        <button
          type="button"
          className="ddag-stepper__btn"
          aria-label="More hops"
          disabled={depth === null}
          onClick={more}
        >
          +
        </button>
      </span>
      <button type="button" className="ddag-textbtn" onClick={onExit}>
        Exit focus
      </button>
    </div>
  );
}
