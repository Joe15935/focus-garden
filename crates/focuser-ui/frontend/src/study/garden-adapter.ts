/**
 * MIT. Adapter between planned study blocks and the existing garden timer.
 *
 * `buildStartRequest` is the reference mapping onto the verified Rust
 * `StartRequest { list_id, task, category, work_secs, break_secs, strict }`.
 * In the app, `createTaskStarter` sends a `start_task` to the native study
 * bridge, which calls the very same `GardenService::start` under the garden
 * lock and records a unique session ↔ task link in one place. The in-flight
 * flag here is only the first line of defence against double clicks; the
 * native side refuses a second session regardless.
 */
import type { Block } from "./core";

export type Strictness = "gentle" | "focus" | "deep";
export interface StartRequest {
  list_id: string;
  task: string;
  category: string;
  work_secs: number;
  break_secs: number;
  strict: Strictness;
}
export interface TaskStart {
  occurrence_id: string;
  date: string;
  task_key: string;
  title: string;
  category: string;
  minutes: number;
  list_id: string;
  strict: Strictness;
}
export interface StartedTask {
  session_id: string;
}
export type StudyCommand = <T>(cmd: string, args?: unknown) => Promise<T>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const STUDY_CATEGORIES = new Set([
  "law-video",
  "law-review",
  "law-practice",
  "law-output",
  "english",
]);

function checkCommon(block: Block, listId: string, strict: Strictness, minutes: number): void {
  if (!UUID.test(listId)) throw new Error("请先选择一份现有屏蔽列表");
  if (!STUDY_CATEGORIES.has(block.category) || block.fixed)
    throw new Error("课程、路途和跑步不能自动变成花园专注时长");
  if (!["gentle", "focus", "deep"].includes(strict)) throw new Error("未知专注强度");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 300) throw new Error("任务时长无效");
  if (!block.id || !block.title.trim()) throw new Error("任务身份或标题缺失");
}

export function buildStartRequest(
  block: Block,
  listId: string,
  strict: Strictness = "focus",
): StartRequest {
  const minutes = block.end - block.start;
  checkCommon(block, listId, strict, minutes);
  return {
    list_id: listId,
    task: block.title,
    category: block.category,
    work_secs: minutes * 60,
    break_secs: 0,
    strict,
  };
}

/** `minutes` may be less than the block when continuing partially finished work. */
export function buildTaskStart(
  block: Block,
  date: string,
  taskKey: string,
  listId: string,
  strict: Strictness = "focus",
  minutes = block.end - block.start,
): TaskStart {
  checkCommon(block, listId, strict, minutes);
  if (minutes > block.end - block.start) throw new Error("续做时长不能超过原任务");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("任务日期无效");
  if (!taskKey.trim()) throw new Error("任务标识缺失");
  return {
    occurrence_id: `${date}:${block.id}`,
    date,
    task_key: taskKey,
    title: block.title,
    category: block.category,
    minutes,
    list_id: listId,
    strict,
  };
}

export function createTaskStarter(command: StudyCommand) {
  let inFlight = false;
  return async (start: TaskStart): Promise<StartedTask> => {
    if (inFlight) throw new Error("正在启动，请勿重复点击");
    inFlight = true;
    try {
      const result = await command<StartedTask>("start_task", start);
      if (!result || typeof result.session_id !== "string" || !result.session_id)
        throw new Error("后端没有返回可核会话；请回到「今天」查看，不要自动重试启动");
      return result;
    } finally {
      inFlight = false;
    }
  };
}
