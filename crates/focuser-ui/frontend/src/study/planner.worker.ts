/// <reference lib="webworker" />
import { type PlanRequest, runPlan } from "./planner";

self.onmessage = (event: MessageEvent<{ id: number; request: PlanRequest }>) => {
  const { id, request } = event.data;
  self.postMessage({ id, response: runPlan(request) });
};
