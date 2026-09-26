import { describe, expect, it } from "vitest";
import * as C from "./core";
import {
  acceptedPlan,
  activeEvents,
  backupFromReference,
  blankDoc,
  diffPlans,
  englishFocus,
  lectureMinutes,
  lecturePace,
  lectureSlots,
  localMinutes,
  localToday,
  parseImport,
  planInputKey,
  planningPolicy,
  remainingLectures,
  type StudyDoc,
  type StudyEvent,
  stalePlan,
  summarize,
  taskKeyFor,
  taskProgress,
  titleFor,
  validateDoc,
} from "./model";
import { runPlan } from "./planner";

function doc(): StudyDoc {
  const d = blankDoc("2026-09-26");
  d.progress.lectureBaseline = 10;
  d.semesters = [
    {
      id: "synthetic",
      name: "合成学期",
      start: "2026-09-21",
      end: "2027-01-03",
      firstMonday: "2026-08-31",
      confirmedWeeks: [4, 5, 6, 7, 8, 9, 10],
      confirmedDates: [],
      rules: [],
      exceptions: [],
    },
  ];
  d.catalog = [
    { id: "c1", subject: "民法", title: "第一讲", minutes: 40, location: "" },
    { id: "c2", subject: "民法", title: "第二讲", minutes: 65, location: "" },
    { id: "c3", subject: "民法", title: "第三讲", minutes: null, location: "" },
    { id: "c4", subject: "民法", title: "第四讲", minutes: 55, location: "" },
  ];
  return d;
}
function ev(id: string, patch: Partial<StudyEvent>): StudyEvent {
  return {
    id,
    date: "2026-09-28",
    task_key: "lecture:c1",
    kind: "watched",
    minutes: 40,
    source: "自报",
    self_reported: true,
    ...patch,
  };
}

describe("study model", () => {
  it("blank template is valid and contains no personal goal", () => {
    const d = blankDoc("2026-09-26");
    expect(validateDoc(d)).toEqual([]);
    expect(d.goal).toBeNull();
    expect(d.semesters).toEqual([]);
  });

  it("uses Shanghai time regardless of the Mac's timezone", () => {
    const instant = new Date("2026-09-25T18:30:00Z");
    expect(localToday(instant)).toBe("2026-09-26");
    expect(localMinutes(instant)).toBe(150);
  });

  it("remaining lectures count distinct lectures, not rewatches", () => {
    const d = doc();
    const events = [
      ev("1", {}),
      ev("2", { date: "2026-09-29" }),
      ev("3", { task_key: "lecture:c2" }),
    ];
    expect(remainingLectures(d, events)).toBe(8);
  });

  it("lectures before the baseline date are already inside the baseline", () => {
    const d = doc();
    d.progress.baselineDate = "2026-09-30";
    expect(remainingLectures(d, [ev("1", {})])).toBe(10);
  });

  it("partial viewing does not reduce remaining lectures", () => {
    expect(remainingLectures(doc(), [ev("1", { kind: "partial", minutes: 20 })])).toBe(10);
  });

  it("a correction replaces the corrected event in counts but not on disk", () => {
    const events = [ev("1", {}), ev("2", { kind: "partial", minutes: 20, corrects: "1" })];
    expect(activeEvents(events).map((e) => e.id)).toEqual(["2"]);
    expect(remainingLectures(doc(), events)).toBe(10);
    expect(events).toHaveLength(2);
  });

  it("binds slots to the next unwatched catalogue items and keeps today's stable", () => {
    const d = doc();
    const before = [ev("1", { date: "2026-09-27" })];
    expect(lectureSlots(d, before, "2026-09-28").map((s) => s.item?.id)).toEqual([
      "c2",
      "c3",
      "c4",
    ]);
    const today = [...before, ev("2", { task_key: "lecture:c2" })];
    expect(lectureSlots(d, today, "2026-09-28").map((s) => s.item?.id)).toEqual(["c2", "c3", "c4"]);
  });

  it("without a catalogue, slots are honest placeholders", () => {
    const d = doc();
    d.catalog = [];
    const slots = lectureSlots(d, [], "2026-09-28");
    expect(slots.map((s) => s.item)).toEqual([null, null, null]);
    expect(
      titleFor({ id: "law-1", title: "法硕第1节（课名需绑定）" }, slots, "first-pass"),
    ).toContain("待绑定");
    expect(slots[0]?.taskKey).toBe("lecture:auto:2026-09-28:law-1");
  });

  it("real lecture lengths feed the planner (40/65/55 are not 50/50/50)", () => {
    const d = doc();
    const p = planningPolicy(
      d,
      [ev("1", { date: "2026-09-27", task_key: "lecture:c3" })],
      "2026-09-28",
    );
    expect(p.lectureDurations).toEqual([40, 65, 55]);
    expect(p.remainingLectures).toBe(9);
  });

  it("task keys: lectures by catalogue id, others by date and slot", () => {
    const d = doc();
    const slots = lectureSlots(d, [], "2026-09-28");
    expect(taskKeyFor("2026-09-28", "law-1", slots, "first-pass")).toBe("lecture:c1");
    expect(taskKeyFor("2026-09-28", "law-review", slots, "first-pass")).toBe(
      "2026-09-28:law-review",
    );
    expect(taskKeyFor("2026-09-28", "law-1", slots, "three-block-review")).toBe("2026-09-28:law-1");
  });

  it("task progress separates done from partial minutes", () => {
    const events = [
      ev("1", { kind: "partial", minutes: 20 }),
      ev("2", { kind: "partial", minutes: 10 }),
    ];
    expect(taskProgress("lecture:c1", events)).toMatchObject({ done: false, partialMinutes: 30 });
    expect(taskProgress("lecture:c1", [...events, ev("3", {})]).done).toBe(true);
  });

  it("English rotation advances only after an actual completion", () => {
    const d = doc();
    expect(englishFocus(d, [], "english-1")).toBe("长对话");
    const done = ev("e", {
      kind: "english",
      task_key: "2026-09-28:english-1",
      source: "题型：长对话",
    });
    expect(englishFocus(d, [done], "english-1")).toBe("短文理解");
    // A skipped (partial) day does not advance.
    const partial = ev("p", {
      kind: "partial",
      task_key: "2026-09-29:english-1",
      source: "题型：短文理解",
    });
    expect(englishFocus(d, [done, partial], "english-1")).toBe("短文理解");
    expect(englishFocus(d, [], "english-0")).toBeNull();
  });

  it("summaries keep input, recall, exercise and retest apart", () => {
    const events = [
      ev("1", {}),
      ev("2", { kind: "closed-recall", task_key: "2026-09-28:law-review", minutes: 20 }),
      ev("3", { kind: "exercise", task_key: "2026-09-28:law-practice", minutes: 25 }),
    ];
    expect(summarize(events, "2026-09-28", "2026-09-28")).toEqual({
      watched: 1,
      recalled: 1,
      exercised: 1,
      retested: 0,
      english: 0,
      minutes: 85,
    });
  });

  it("imports the reference HTML export with counts marked as needing refresh", () => {
    const d = doc();
    const data: C.ExportData = {
      schemaVersion: 1,
      exportedAt: "2026-09-26T00:00:00+08:00",
      policy: { ...d.policy, remainingLectures: 120 },
      semesters: d.semesters,
      reviews: [],
      events: [
        {
          id: "x",
          date: "2026-09-26",
          taskId: "lesson1",
          kind: "watched",
          minutes: 50,
          source: "self",
          selfReported: true,
        },
      ],
      notes: ["n"],
    };
    const parsed = parseImport(JSON.stringify(data));
    expect(parsed.kind).toBe("reference");
    expect(parsed.backup.doc?.progress).toEqual({
      lectureBaseline: 120,
      baselineDate: "2026-09-26",
      baselineStatus: "needs-refresh",
    });
    expect(parsed.backup.events[0]?.task_key).toBe("lesson1");
    expect(backupFromReference(data).doc?.goal).toBeNull();
  });

  it("round-trips a native backup and rejects foreign or unsafe files", () => {
    const backup = {
      format: "focus-garden-study-backup",
      version: 1,
      exported_at: "2026-09-26T00:00:00Z",
      doc: doc(),
      events: [],
      reviews: [],
      links: [],
      plans: [],
    };
    expect(parseImport(JSON.stringify(backup)).kind).toBe("native");
    expect(() => parseImport(JSON.stringify({ ...backup, version: 2 }))).toThrow(/版本/);
    expect(() => parseImport(JSON.stringify({ format: "focus-garden-backup" }))).toThrow();
    expect(() =>
      parseImport('{"format":"focus-garden-study-backup","__proto__":{"x":1}}'),
    ).toThrow();
    expect(() => parseImport("not json")).toThrow();
  });

  it("an accepted replan only applies to the settings revision it was made for", () => {
    const plan = {
      id: 3,
      date: "2026-09-28",
      input_revision: 4,
      status: "FEASIBLE",
      reason: "r",
      data: { blocks: [], timeline: [], now: 600, place: "home" as const, dropped: [] },
    };
    expect(acceptedPlan([plan], "2026-09-28", 4)).toBe(plan);
    expect(acceptedPlan([plan], "2026-09-28", 5)).toBeNull();
    expect(stalePlan([plan], "2026-09-28", 5)).toBe(true);
    const reset = { ...plan, id: 4, data: { reset: true as const } };
    expect(acceptedPlan([plan, reset], "2026-09-28", 4)).toBeNull();
  });

  it("diff shows kept, moved and shortened work", () => {
    const b = (id: string, start: number, end: number): C.Block => ({
      id,
      title: id,
      start,
      end,
      entry: "home",
      exit: "home",
      category: "law-video",
      segments: [],
      fixed: false,
    });
    const d = diffPlans(
      [b("a", 500, 550), b("b", 600, 650), b("c", 700, 750)],
      [b("a", 500, 550), b("b", 620, 670), b("c", 800, 830)],
      ["x"],
      ["y"],
    );
    expect(d).toEqual({ kept: ["a"], moved: ["b"], shortened: ["c"], dropped: ["x"], done: ["y"] });
  });
});

describe("planner entry points", () => {
  it("plans a synthetic weekday and the result passes the independent validator", () => {
    const d = doc();
    const policy = planningPolicy(d, [], "2026-09-28");
    const r = runPlan({ kind: "day", policy, semesters: d.semesters, date: "2026-09-28" });
    expect(r.kind).toBe("day");
    if (r.kind !== "day") return;
    expect(r.plan.status).toBe("FEASIBLE");
    expect(C.validateSchedule(r.plan.blocks, { start: 420, end: 1380 }, 15, r.plan.tasks)).toEqual(
      [],
    );
    const lectures = r.plan.blocks
      .filter((b) => b.category === "law-video")
      .map((b) => b.end - b.start);
    expect(lectures).toEqual([45, 70, 55]);
  });

  it("an unknown future term is never treated as free", () => {
    const d = doc();
    const r = runPlan({
      kind: "day",
      policy: d.policy,
      semesters: d.semesters,
      date: "2027-03-01",
    });
    expect(r.kind === "day" && r.plan.status).toBe("NEEDS_CALENDAR");
  });

  it("two lectures left asks for a phase decision instead of inventing a third", () => {
    const d = doc();
    d.progress.lectureBaseline = 2;
    const r = runPlan({
      kind: "day",
      policy: planningPolicy(d, [], "2026-09-28"),
      semesters: d.semesters,
      date: "2026-09-28",
    });
    expect(r.kind === "day" && r.plan.status).toBe("PHASE_CONFIRMATION");
  });

  it("a late start replans only the future and never marks work done", () => {
    const d = doc();
    const day = runPlan({
      kind: "day",
      policy: planningPolicy(d, [], "2026-09-28"),
      semesters: d.semesters,
      date: "2026-09-28",
    });
    if (day.kind !== "day") throw new Error("no plan");
    const r = runPlan({
      kind: "replan",
      tasks: day.plan.tasks,
      fixed: day.plan.blocks.filter((b) => b.fixed),
      completed: [],
      partial: {},
      dropped: ["breakfast"],
      now: 480,
      place: "home",
      sleep: 1380,
      route: 15,
      previous: day.plan.blocks,
    });
    expect(r.kind).toBe("replan");
    if (r.kind !== "replan") return;
    expect(["FEASIBLE", "SEARCH_LIMIT", "NO_PLAN_FOUND", "CAPACITY_EXCEEDED"]).toContain(
      r.result.status,
    );
    expect(r.result.blocks.every((b) => b.start >= 480)).toBe(true);
    expect(r.tasks.find((t) => t.id === "law-1")).toBeTruthy();
    if (r.result.status === "FEASIBLE")
      expect(C.validateSchedule(r.result.blocks, { start: 480, end: 1380 }, 15, r.tasks)).toEqual(
        [],
      );
  });

  it("an ongoing class blocks a replan instead of being cut", () => {
    const cls = C.blockForTask(
      {
        id: "cls",
        title: "课",
        minutes: 100,
        places: ["classroom"],
        windows: [{ start: 0, end: 1440 }],
        category: "other",
        fixed: true,
      },
      800,
      "classroom",
    );
    const r = runPlan({
      kind: "replan",
      tasks: [],
      fixed: [cls],
      completed: [],
      partial: {},
      dropped: [],
      now: 850,
      place: "classroom",
      sleep: 1380,
      route: 15,
      previous: [],
    });
    expect(r.kind === "replan" && r.result.status).toBe("INPUT_CONFLICT");
  });
});

describe("derived planning helpers", () => {
  it("the replan fingerprint ignores unrelated edits and today's progress", () => {
    const d = doc();
    const base = planInputKey(d, [], "2026-09-28");
    expect(
      planInputKey(
        { ...d, goal: { ...(d.goal ?? ({} as never)), school: "x" } as never },
        [],
        "2026-09-28",
      ),
    ).toBe(base);
    expect(planInputKey(d, [ev("1", { date: "2026-09-28" })], "2026-09-28")).toBe(base);
    expect(
      planInputKey({ ...d, policy: { ...d.policy, lunchMinutes: 90 } }, [], "2026-09-28"),
    ).not.toBe(base);
    expect(planInputKey(d, [], "2026-09-29")).not.toBe(base);
  });

  it("an accepted replan survives a goal edit but not a rule change", () => {
    const d = doc();
    const key = planInputKey(d, [], "2026-09-28");
    const plan = {
      id: 1,
      date: "2026-09-28",
      input_revision: 1,
      status: "FEASIBLE",
      reason: "",
      data: {
        blocks: [],
        timeline: [],
        now: 600,
        place: "home" as const,
        dropped: [],
        inputKey: key,
      },
    };
    expect(acceptedPlan([plan], "2026-09-28", 2, key)).toBe(plan);
    const changed = planInputKey(
      { ...d, policy: { ...d.policy, sleep: "22:30" } },
      [],
      "2026-09-28",
    );
    expect(acceptedPlan([plan], "2026-09-28", 2, changed)).toBeNull();
    expect(stalePlan([plan], "2026-09-28", 2, changed)).toBe(true);
  });

  it("actual lecture time adds up partial sessions of the same lecture", () => {
    const events = [
      ev("1", { kind: "partial", minutes: 30 }),
      ev("2", { minutes: 35 }),
      ev("3", { task_key: "lecture:c2", kind: "partial", minutes: 20 }),
    ];
    expect(lectureMinutes(events)).toEqual([65]);
  });

  it("pace projections are estimates that need enough days", () => {
    const d = doc();
    d.progress = { lectureBaseline: 12, baselineDate: "2026-09-01", baselineStatus: "confirmed" };
    const few = lecturePace(d, [], "2026-09-28", 14);
    expect(few.recentPerStudyDay).toBe(0);
    expect(few.finishAtRecentPace).toBeNull();
    // 3 per study day, Saturday off: 12 lectures take 4 study days.
    expect(few.finishAtPlannedPace).toBe("2026-10-01");
    const events = Array.from({ length: 12 }, (_, i) =>
      ev(`w${i}`, { task_key: `lecture:x${i}`, date: C.addDays("2026-09-15", i) }),
    );
    const pace = lecturePace(
      { ...d, progress: { ...d.progress, lectureBaseline: 30 } },
      events,
      "2026-09-28",
      14,
    );
    expect(pace.recentPerStudyDay).toBeGreaterThan(0);
    expect(pace.plannedPerWeek).toBe(18);
  });
});
