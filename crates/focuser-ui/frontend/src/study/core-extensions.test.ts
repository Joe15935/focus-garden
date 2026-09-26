import { describe, expect, it } from "vitest";
import * as C from "./core";
import { blankDoc } from "./model";

function policy(): C.Policy {
  return { ...blankDoc("2026-09-26").policy, remainingLectures: 100 };
}
function term(): C.Semester {
  return {
    id: "t",
    name: "合成学期",
    start: "2026-09-21",
    end: "2027-01-03",
    firstMonday: "2026-08-31",
    confirmedWeeks: [4, 5, 6, 9],
    confirmedDates: [],
    rules: [
      {
        id: "wed",
        title: "周三课",
        weekday: 3,
        start: "08:00",
        end: "11:40",
        from: "2026-09-21",
        until: "2026-12-20",
        location: "classroom",
        kind: "lab",
        evidence: "confirmed",
        source: "synthetic",
      },
      {
        id: "thu",
        title: "周四课",
        weekday: 4,
        start: "14:00",
        end: "15:40",
        from: "2026-09-21",
        until: "2026-12-20",
        location: "classroom",
        kind: "class",
        evidence: "confirmed",
        source: "synthetic",
      },
    ],
    exceptions: [],
  };
}
const HOURS: C.Policy["placeHours"] = {
  library: [{ start: 480, end: 1320 }],
  home: [{ start: 390, end: 1410 }],
};

describe("opening hours", () => {
  it("validates hour windows", () => {
    expect(C.validatePolicy({ ...policy(), placeHours: HOURS })).toEqual([]);
    expect(
      C.validatePolicy({ ...policy(), placeHours: { library: [{ start: 600, end: 500 }] } }),
    ).not.toEqual([]);
    expect(C.validatePolicy({ ...policy(), placeHours: { library: [] } })).not.toEqual([]);
  });

  it("the validator rejects library work after closing", () => {
    const t: C.Task = {
      id: "x",
      title: "图书馆自习",
      minutes: 60,
      places: ["library"],
      windows: [{ start: 420, end: 1380 }],
      category: "law-review",
    };
    const late = C.blockForTask(t, 1290, "library");
    expect(C.outsideHours(late, HOURS)).toMatch(/图书馆/);
    expect(
      C.validateSchedule([late], { start: 420, end: 1380 }, 15, [], "home", "home", HOURS).join(),
    ).toMatch(/不开放/);
    expect(C.outsideHours(C.blockForTask(t, 600, "library"), HOURS)).toBeNull();
  });

  it("a library-only plan never uses the library while it is closed", () => {
    const p = { ...policy(), studyPlaces: ["library"] as C.Place[], placeHours: HOURS };
    const plan = C.planDay(p, [term()], "2026-09-28", { maxNodes: 3000 });
    if (plan.status === "FEASIBLE") {
      for (const b of plan.blocks.filter((x) => x.entry === "library")) {
        expect(b.start).toBeGreaterThanOrEqual(480);
        expect(b.end).toBeLessThanOrEqual(1320);
      }
      expect(
        C.validateSchedule(
          plan.blocks,
          { start: 420, end: 1380 },
          15,
          plan.tasks,
          "home",
          "home",
          HOURS,
        ),
      ).toEqual([]);
    } else {
      expect(["SEARCH_LIMIT", "NO_PLAN_FOUND", "CAPACITY_EXCEEDED"]).toContain(plan.status);
    }
  });

  it("with home allowed, early and late work moves home instead of the closed library", () => {
    const p = { ...policy(), placeHours: HOURS };
    const plan = C.planDay(p, [term()], "2026-09-28", { maxNodes: 3000 });
    expect(plan.status).toBe("FEASIBLE");
    for (const b of plan.blocks) expect(C.outsideHours(b, HOURS)).toBeNull();
  });

  it("fixed classes are never judged against opening hours", () => {
    const cls = C.calendarForDate([term()], "2026-09-30").blocks[0];
    expect(cls).toBeTruthy();
    if (cls) expect(C.outsideHours(cls, { classroom: [{ start: 600, end: 700 }] })).toBeNull();
  });
});

describe("holidays and make-up days", () => {
  it("a holiday cancels classes and counts as known", () => {
    const t = {
      ...term(),
      holidays: [
        { from: "2026-10-01", until: "2026-10-07", reason: "国庆节", source: "国务院通知" },
      ],
    };
    const day = C.calendarForDate([t], "2026-10-01");
    expect(day.blocks).toEqual([]);
    expect(day.known).toBe(true);
    expect(day.warnings.join()).toMatch(/国庆节/);
    // Outside the range nothing changes.
    expect(C.calendarForDate([t], "2026-10-08").blocks.length).toBe(1);
  });

  it("a make-up Saturday runs the named weekday's timetable", () => {
    const t = {
      ...term(),
      swaps: [{ date: "2026-10-10", followsDate: "2026-10-08", reason: "国庆调课" }],
    };
    const day = C.calendarForDate([t], "2026-10-10");
    expect(day.blocks.map((b) => b.title)).toEqual(["周四课"]);
    expect(day.blocks[0]?.id).toContain("2026-10-10");
    expect(day.known).toBe(true);
  });

  it("an unconfirmed make-up source stays unknown", () => {
    const t = {
      ...term(),
      swaps: [{ date: "2026-11-14", followsDate: "2026-11-12", reason: "调课" }],
    };
    expect(C.calendarForDate([t], "2026-11-14").known).toBe(false);
  });

  it("rejects bad holiday or swap data", () => {
    expect(
      C.validateSemester({
        ...term(),
        holidays: [{ from: "2026-10-07", until: "2026-10-01", reason: "x", source: "" }],
      }),
    ).not.toEqual([]);
    expect(
      C.validateSemester({
        ...term(),
        swaps: [{ date: "2026-10-10", followsDate: "2026-10-10", reason: "x" }],
      }),
    ).not.toEqual([]);
  });

  it("a weekday holiday is still a study day, just without classes", () => {
    const t = {
      ...term(),
      holidays: [{ from: "2026-10-01", until: "2026-10-07", reason: "国庆节", source: "s" }],
    };
    const plan = C.planDay(policy(), [t], "2026-10-01", { maxNodes: 3000 });
    expect(plan.status).toBe("FEASIBLE");
    expect(plan.blocks.some((b) => b.category === "class")).toBe(false);
    expect(plan.blocks.filter((b) => b.category === "law-video")).toHaveLength(3);
  });
});

describe("capacity with unavoidable travel", () => {
  const block = (
    id: string,
    start: number,
    end: number,
    place: C.Place = "classroom",
  ): C.Block => ({
    id,
    title: id,
    start,
    end,
    entry: place,
    exit: place,
    category: "class",
    segments: [{ offset: 0, minutes: end - start, title: id, kind: "class", place }],
    fixed: true,
  });
  it("counts trips in and out and the dead time between classes", () => {
    const fixed = [block("a", 475, 645), block("b", 835, 995), block("c", 1155, 1260)];
    // in 15 + two gaps capped at 30 + out 15
    expect(C.unavoidableTravel(fixed, [], 15, "home", "home")).toBe(90);
    // A gap shorter than a round trip only costs the gap.
    expect(
      C.unavoidableTravel([block("a", 480, 500), block("b", 510, 540)], [], 15, "home", "home"),
    ).toBe(40);
  });
  it("never double-counts travel carried inside a task", () => {
    const run: C.Task = {
      id: "run",
      title: "跑步",
      minutes: 60,
      places: ["track"],
      exitPlace: "home",
      windows: [{ start: 0, end: 1440 }],
      category: "run",
      segments: [
        { offset: 0, minutes: 30, title: "跑", kind: "run", place: "track" },
        { offset: 30, minutes: 15, title: "回", kind: "travel", place: "track", to: "home" },
        { offset: 45, minutes: 15, title: "洗澡", kind: "shower", place: "home" },
      ],
    };
    expect(
      C.unavoidableTravel(
        [block("t", 600, 700, "track"), block("h", 800, 900, "home")],
        [run],
        15,
        "home",
        "home",
      ),
    ).toBe(15);
  });
  it("a heavy lab + two classes day is reported as provably over capacity, not a search failure", () => {
    const p = { ...policy(), englishTiers: [40] };
    const t: C.Semester = {
      ...term(),
      confirmedWeeks: [10],
      rules: [
        {
          ...(term().rules[0] as C.CalendarRule),
          id: "lab",
          weekday: 2,
          start: "08:00",
          end: "10:45",
        },
        {
          ...(term().rules[0] as C.CalendarRule),
          id: "pm",
          weekday: 2,
          start: "14:00",
          end: "16:35",
          kind: "class",
        },
        {
          ...(term().rules[0] as C.CalendarRule),
          id: "eve",
          weekday: 2,
          start: "19:20",
          end: "21:00",
          kind: "class",
        },
      ],
    };
    const plan = C.planDay(p, [t], "2026-11-03", { maxNodes: 500 });
    expect(plan.status).toBe("CAPACITY_EXCEEDED");
    expect(plan.diagnostics.join()).toMatch(/往返/);
  });
});

describe("skipping lectures on overfull days", () => {
  const heavy = (): C.Semester => ({
    ...term(),
    confirmedWeeks: [10],
    rules: [
      {
        ...(term().rules[0] as C.CalendarRule),
        id: "lab",
        weekday: 2,
        start: "08:00",
        end: "10:45",
      },
      {
        ...(term().rules[0] as C.CalendarRule),
        id: "pm",
        weekday: 2,
        start: "14:00",
        end: "16:35",
        kind: "class",
      },
      {
        ...(term().rules[0] as C.CalendarRule),
        id: "eve",
        weekday: 2,
        start: "19:20",
        end: "21:00",
        kind: "class",
      },
    ],
  });
  it("with the rule on, an overfull day keeps everything except new lectures", () => {
    const p = { ...policy(), dropLecturesWhenFull: true };
    const plan = C.planDay(p, [heavy()], "2026-11-03", { maxNodes: 2500 });
    expect(plan.status).toBe("FEASIBLE");
    expect(plan.lecturesSkipped).toBe(true);
    expect(plan.blocks.some((b) => b.category === "law-video")).toBe(false);
    expect(plan.blocks.some((b) => b.id === "law-practice")).toBe(true);
    expect(plan.blocks.some((b) => b.id === "run")).toBe(true);
    expect(plan.warnings[0]).toMatch(/不排新课/);
    expect(C.validateSchedule(plan.blocks, { start: 420, end: 1380 }, 15, plan.tasks)).toEqual([]);
  });
  it("a day that fits keeps its three lectures even with the rule on", () => {
    const plan = C.planDay({ ...policy(), dropLecturesWhenFull: true }, [term()], "2026-09-28", {
      maxNodes: 2500,
    });
    expect(plan.lecturesSkipped).toBeFalsy();
    expect(plan.blocks.filter((b) => b.category === "law-video")).toHaveLength(3);
  });
  it("with the rule off, the honest failure stays", () => {
    const plan = C.planDay(policy(), [heavy()], "2026-11-03", { maxNodes: 500 });
    expect(plan.status).not.toBe("FEASIBLE");
  });
});
