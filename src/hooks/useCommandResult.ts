import { useCallback, useRef, useState } from "react";
import type { CommandResult } from "./useDaemon.ts";

/**
 * Request/response helper for the async command protocol. `command(name,args)`
 * returns a rid and the matching {@link CommandResult} arrives later in
 * `daemon.commandResults`. This hook wires that loading/result/error/stale-rid
 * lifecycle: call `run`, then read the matching result via `find`.
 *
 * Stale-rid handling: only the rid from the most recent `run` is considered
 * current. If a newer request is dispatched while an older one is in-flight,
 * the older result is ignored.
 */
export interface CommandRunState {
  pending: boolean;
  rid: string | null;
  result: CommandResult | null;
  error: string | null;
}

export interface CommandResultHandle extends CommandRunState {
  run: (
    command: (name: string, args?: Record<string, unknown>) => Promise<string>,
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<void>;
  reset: () => void;
}

const IDLE: CommandRunState = {
  pending: false,
  rid: null,
  result: null,
  error: null,
};

/**
 * Resolves the current state for a tracked rid against the daemon's
 * commandResults list. Pass the live `commandResults` from useDaemon.
 */
export function useCommandResult(commandResults: CommandResult[]): CommandResultHandle {
  const [state, setState] = useState<CommandRunState>(IDLE);
  const ridRef = useRef<string | null>(null);

  const run = useCallback(
    async (
      command: (name: string, args?: Record<string, unknown>) => Promise<string>,
      name: string,
      args?: Record<string, unknown>,
    ) => {
      setState({ pending: true, rid: null, result: null, error: null });
      try {
        const rid = await command(name, args);
        ridRef.current = rid;
        setState({ pending: true, rid, result: null, error: null });
      } catch (err) {
        ridRef.current = null;
        setState({
          pending: false,
          rid: null,
          result: null,
          error: String(err),
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    ridRef.current = null;
    setState(IDLE);
  }, []);

  // Resolve the matching result for the current rid. Stale rids (superseded by
  // a newer run) are ignored. Done inline on each render so the latest
  // commandResults is always reflected.
  const currentRid = ridRef.current ?? state.rid;
  let resolved: CommandRunState = state;
  if (state.pending && currentRid) {
    const match = commandResults.find((r) => r.rid === currentRid);
    if (match) {
      resolved = {
        pending: false,
        rid: currentRid,
        result: match,
        error: match.ok ? null : match.error?.message ?? "command failed",
      };
    }
  }

  return { ...resolved, run, reset };
}
