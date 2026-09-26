import { describe, expect, it } from "vitest";
import type { Block } from "./core";
import { buildStartRequest, buildTaskStart, createTaskStarter } from "./garden-adapter";

const list = "12345678-1234-4123-8123-123456789abc";
const block: Block = {
  id: "law-1",
  title: "法硕第1节",
  start: 500,
  end: 555,
  entry: "home",
  exit: "home",
  category: "law-video",
  segments: [],
  fixed: false,
};

describe("garden adapter", () => {
  it("uses the verified StartRequest fields", () => {
    expect(buildStartRequest(block, list)).toEqual({
      list_id: list,
      task: "法硕第1节",
      category: "law-video",
      work_secs: 3300,
      break_secs: 0,
      strict: "focus",
    });
  });

  it.each(["class", "lab", "run", "gym", "life", "travel"])("rejects %s credit", (category) => {
    expect(() => buildStartRequest({ ...block, category }, list)).toThrow();
    expect(() => buildTaskStart({ ...block, category }, "2026-09-28", "k", list)).toThrow();
  });

  it("rejects an invalid list id", () => {
    expect(() => buildStartRequest(block, "invalid")).toThrow();
  });

  it("rejects fixed blocks even when labelled as study", () => {
    expect(() => buildStartRequest({ ...block, fixed: true }, list)).toThrow();
  });

  it("builds a native task start with a stable occurrence id", () => {
    const start = buildTaskStart(block, "2026-09-28", "lecture:civil-1", list, "deep");
    expect(start).toEqual({
      occurrence_id: "2026-09-28:law-1",
      date: "2026-09-28",
      task_key: "lecture:civil-1",
      title: "法硕第1节",
      category: "law-video",
      minutes: 55,
      list_id: list,
      strict: "deep",
    });
  });

  it("continuing partial work may be shorter, never longer", () => {
    expect(buildTaskStart(block, "2026-09-28", "k", list, "focus", 20).minutes).toBe(20);
    expect(() => buildTaskStart(block, "2026-09-28", "k", list, "focus", 56)).toThrow();
  });

  it("sends exactly one start_task", async () => {
    const calls: [string, unknown][] = [];
    const start = createTaskStarter(async <T>(cmd: string, args?: unknown) => {
      calls.push([cmd, args]);
      return { session_id: "new" } as T;
    });
    const result = await start(buildTaskStart(block, "2026-09-28", "k", list));
    expect(result.session_id).toBe("new");
    expect(calls.map((c) => c[0])).toEqual(["start_task"]);
  });

  it("concurrent clicks do not start twice", async () => {
    let resolve: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve = r;
    });
    let count = 0;
    const start = createTaskStarter(async <T>() => {
      count++;
      await pending;
      return { session_id: "new" } as T;
    });
    const payload = buildTaskStart(block, "2026-09-28", "k", list);
    const first = start(payload);
    await expect(start(payload)).rejects.toThrow(/重复/);
    resolve(null);
    await first;
    expect(count).toBe(1);
  });

  it("does not retry an uncertain backend response", async () => {
    let starts = 0;
    const start = createTaskStarter(async <T>() => {
      starts++;
      return {} as T;
    });
    await expect(start(buildTaskStart(block, "2026-09-28", "k", list))).rejects.toThrow(/自动重试/);
    expect(starts).toBe(1);
  });

  it("surfaces a refused start (existing session) without retrying", async () => {
    let starts = 0;
    const start = createTaskStarter(async () => {
      starts++;
      throw new Error("已有进行中的专注");
    });
    await expect(start(buildTaskStart(block, "2026-09-28", "k", list))).rejects.toThrow(/已有/);
    expect(starts).toBe(1);
  });
});
