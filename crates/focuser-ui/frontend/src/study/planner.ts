/**
 * MIT. Pure planning entry points shared by the Web Worker and tests.
 * Inputs are plain data so they can cross the worker boundary.
 */
import * as C from "./core";

export interface DayRequest {
  kind: "day";
  policy: C.Policy;
  semesters: C.Semester[];
  date: string;
}
export interface ReplanRequest {
  kind: "replan";
  /** Today's full task list (from the day plan). */
  tasks: C.Task[];
  /** Fixed calendar blocks of the day (classes, labs). */
  fixed: C.Block[];
  completed: string[];
  partial: Record<string, number>;
  dropped: string[];
  now: number;
  place: C.Place;
  sleep: number;
  route: number;
  previous: C.Block[];
  placeHours?: C.Policy["placeHours"];
}
export interface WeekRequest {
  kind: "week";
  days: { date: string; policy: C.Policy }[];
  semesters: C.Semester[];
}
export type PlanRequest = DayRequest | ReplanRequest | WeekRequest;
export type PlanResponse =
  | { kind: "day"; plan: C.DayPlan }
  | { kind: "replan"; result: C.SearchResult; tasks: C.Task[]; timeline: C.TimelineItem[] }
  | { kind: "week"; plans: C.DayPlan[] }
  | { kind: "error"; message: string };

export const SEARCH = { maxNodes: 2500 } as const;

export function runPlan(request: PlanRequest): PlanResponse {
  try {
    if (request.kind === "day") {
      return {
        kind: "day",
        plan: C.planDay(request.policy, request.semesters, request.date, SEARCH),
      };
    }
    if (request.kind === "week") {
      return {
        kind: "week",
        plans: request.days.map((d) => C.planDay(d.policy, request.semesters, d.date, SEARCH)),
      };
    }
    const known = new Set(request.tasks.map((t) => t.id));
    const completed = request.completed.filter((id) => known.has(id));
    const dropped = request.dropped.filter((id) => known.has(id) && !completed.includes(id));
    const rest = C.remainingTasks(
      request.tasks,
      [...completed, ...dropped],
      Object.fromEntries(Object.entries(request.partial).filter(([id]) => known.has(id))),
    );
    const result = C.replanRemainder(
      rest,
      request.fixed.filter((b) => b.end > request.now),
      request.now,
      request.place,
      request.sleep,
      request.route,
      { ...SEARCH, previous: request.previous, placeHours: request.placeHours },
    );
    const timeline =
      result.status === "FEASIBLE"
        ? C.timelineFor(
            result.blocks,
            { start: request.now, end: request.sleep },
            request.route,
            request.place,
          )
        : [];
    return { kind: "replan", result, tasks: rest, timeline };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
