import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { errorText, GARDEN_KEY } from "@/garden/api";
import { createTaskStarter, type TaskStart } from "./garden-adapter";
import type { StudySnapshot } from "./model";
import { type PlanRequest, type PlanResponse, runPlan } from "./planner";

export const STUDY_KEY = ["study-snapshot"] as const;

export async function studyCommand<T = unknown>(cmd: string, args?: unknown): Promise<T> {
  try {
    return await invoke<T>("study_command", {
      command: { cmd, ...(args === undefined ? {} : { args }) },
    });
  } catch (error) {
    throw new Error(errorText(error));
  }
}

export function useStudy() {
  return useQuery({
    queryKey: STUDY_KEY,
    queryFn: () => studyCommand<StudySnapshot>("snapshot"),
    // Study data only changes through this page; no need to poll.
    refetchInterval: false,
    refetchOnWindowFocus: true,
  });
}

export function useStudyAction() {
  const query = useQueryClient();
  return useMutation({
    mutationFn: ({ cmd, args }: { cmd: string; args?: unknown }) => studyCommand(cmd, args),
    onSettled: () => query.invalidateQueries({ queryKey: STUDY_KEY }),
  });
}

const starter = createTaskStarter(studyCommand);
export function useStartTask() {
  const query = useQueryClient();
  return useMutation({
    mutationFn: (start: TaskStart) => starter(start),
    onSettled: () => {
      query.invalidateQueries({ queryKey: STUDY_KEY });
      query.invalidateQueries({ queryKey: GARDEN_KEY });
    },
  });
}

/**
 * Runs the planner off the UI thread. A new request terminates the previous
 * worker (real cancellation), and a result is only shown for the key it was
 * computed from, so a stale plan can never overwrite newer settings.
 */
export function usePlan(request: PlanRequest | null): PlanResponse | null {
  const key = request ? JSON.stringify(request) : "";
  const [state, setState] = useState<{ key: string; response: PlanResponse } | null>(null);
  useEffect(() => {
    if (!key) return;
    const input = JSON.parse(key) as PlanRequest;
    if (typeof Worker === "undefined") {
      setState({ key, response: runPlan(input) });
      return;
    }
    let cancelled = false;
    const worker = new Worker(new URL("./planner.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ response: PlanResponse }>) => {
      if (!cancelled) setState({ key, response: event.data.response });
      worker.terminate();
    };
    worker.onerror = () => {
      if (!cancelled) setState({ key, response: runPlan(input) });
      worker.terminate();
    };
    worker.postMessage({ id: 1, request: input });
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [key]);
  return state && state.key === key ? state.response : null;
}
