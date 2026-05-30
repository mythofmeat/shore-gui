import { useState } from "react";
import "../styles/tool-inspector.css";

interface JsonTreeProps {
  value: unknown;
  /**
   * Nodes at a depth shallower than this start expanded; deeper nodes start
   * collapsed. Defaults to 1 (top-level keys visible, their children folded).
   */
  defaultExpandedDepth?: number;
}

/**
 * Recursive, collapsible tree view for arbitrary JSON. Objects and arrays get
 * an expand/collapse caret; primitives render inline with token-colored values.
 * Large containers fold by default (depth-aware) so a tool payload stays quiet
 * until it is opened. Keys use the mono font and ember/ink color tokens.
 */
export function JsonTree({ value, defaultExpandedDepth = 1 }: JsonTreeProps) {
  return (
    <div className="json-tree">
      <JsonNode value={value} depth={0} defaultExpandedDepth={defaultExpandedDepth} />
    </div>
  );
}

interface JsonNodeProps {
  value: unknown;
  depth: number;
  defaultExpandedDepth: number;
  /** The object key or array index this node sits under, if any. */
  label?: string;
  /** Render the label as a quoted string key (objects) vs. a bare index. */
  labelKind?: "key" | "index";
}

function JsonNode({
  value,
  depth,
  defaultExpandedDepth,
  label,
  labelKind = "key",
}: JsonNodeProps) {
  const branch = asBranch(value);

  if (!branch) {
    return (
      <div className="json-row" style={indent(depth)}>
        {label !== undefined && <NodeLabel label={label} kind={labelKind} />}
        <JsonLeaf value={value} />
      </div>
    );
  }

  return (
    <BranchNode
      branch={branch}
      depth={depth}
      defaultExpandedDepth={defaultExpandedDepth}
      label={label}
      labelKind={labelKind}
    />
  );
}

interface BranchNodeProps extends Omit<JsonNodeProps, "value"> {
  branch: Branch;
}

function BranchNode({
  branch,
  depth,
  defaultExpandedDepth,
  label,
  labelKind = "key",
}: BranchNodeProps) {
  const [open, setOpen] = useState(depth < defaultExpandedDepth);
  const entries = branch.entries;
  const empty = entries.length === 0;
  const openSym = branch.kind === "array" ? "[" : "{";
  const closeSym = branch.kind === "array" ? "]" : "}";

  if (empty) {
    return (
      <div className="json-row" style={indent(depth)}>
        {label !== undefined && <NodeLabel label={label} kind={labelKind} />}
        <span className="json-punct">{openSym}{closeSym}</span>
      </div>
    );
  }

  return (
    <div className="json-branch">
      <button
        type="button"
        className="json-row json-toggle"
        style={indent(depth)}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`json-caret${open ? " json-caret-open" : ""}`} aria-hidden>
          ▸
        </span>
        {label !== undefined && <NodeLabel label={label} kind={labelKind} />}
        <span className="json-punct">{openSym}</span>
        {!open && (
          <span className="json-collapsed">
            {summarize(branch)} <span className="json-punct">{closeSym}</span>
          </span>
        )}
      </button>
      {open && (
        <>
          {entries.map((entry) => (
            <JsonNode
              key={entry.key}
              value={entry.value}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
              label={entry.key}
              labelKind={branch.kind === "array" ? "index" : "key"}
            />
          ))}
          <div className="json-row" style={indent(depth)}>
            <span className="json-punct">{closeSym}</span>
          </div>
        </>
      )}
    </div>
  );
}

function NodeLabel({ label, kind }: { label: string; kind: "key" | "index" }) {
  if (kind === "index") {
    return (
      <span className="json-index">
        {label}
        <span className="json-punct">:</span>
      </span>
    );
  }
  return (
    <span className="json-key">
      {label}
      <span className="json-punct">:</span>
    </span>
  );
}

function JsonLeaf({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>;
  if (value === undefined) return <span className="json-null">undefined</span>;
  switch (typeof value) {
    case "string":
      return <span className="json-string">"{value}"</span>;
    case "number":
      return <span className="json-number">{String(value)}</span>;
    case "boolean":
      return <span className="json-boolean">{String(value)}</span>;
    default:
      return <span className="json-string">"{String(value)}"</span>;
  }
}

type Branch =
  | { kind: "array"; entries: { key: string; value: unknown }[] }
  | { kind: "object"; entries: { key: string; value: unknown }[] };

function asBranch(value: unknown): Branch | null {
  if (Array.isArray(value)) {
    return {
      kind: "array",
      entries: value.map((v, i) => ({ key: String(i), value: v })),
    };
  }
  if (typeof value === "object" && value !== null) {
    return {
      kind: "object",
      entries: Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
        key,
        value: v,
      })),
    };
  }
  return null;
}

/** A short "n items"/"n keys" hint shown beside a collapsed container. */
function summarize(branch: Branch): string {
  const n = branch.entries.length;
  if (branch.kind === "array") return `${n} item${n === 1 ? "" : "s"}`;
  return `${n} key${n === 1 ? "" : "s"}`;
}

function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `${depth * 14}px` };
}
