import { useMemo } from "react";
import { diffLines } from "../lib/diff.ts";
import "../styles/edit-diff.css";

interface EditDiffProps {
  before: string;
  after: string;
}

/**
 * Inline old→new diff for the edit-message composer (#26). Renders the line
 * diff with add/del gutters tuned to the warm palette. Shows a quiet
 * "no changes yet" until the draft actually diverges from the original.
 */
export function EditDiff({ before, after }: EditDiffProps) {
  const segments = useMemo(() => diffLines(before, after), [before, after]);
  const changed = segments.some((s) => s.type !== "eq");

  if (!changed) {
    return <div className="edit-diff edit-diff-empty">No changes yet</div>;
  }

  return (
    <div className="edit-diff" role="group" aria-label="Edit diff">
      {segments.map((seg, i) => (
        <div key={i} className={`edit-diff-line edit-diff-${seg.type}`}>
          <span className="edit-diff-gutter" aria-hidden>
            {seg.type === "add" ? "+" : seg.type === "del" ? "−" : " "}
          </span>
          <span className="edit-diff-text">{seg.text || " "}</span>
        </div>
      ))}
    </div>
  );
}
