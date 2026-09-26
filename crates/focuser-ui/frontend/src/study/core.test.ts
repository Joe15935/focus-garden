// @ts-nocheck -- ported untyped fixtures; core.ts itself is checked under strict mode.
// Ported from the delivery package's reference tests (module/tests/core.test.cjs).
// Behaviour is unchanged; only the runner moved to Vitest.
import a from "node:assert/strict";
import { test } from "vitest";
import * as Core from "./core";

// biome-ignore lint/suspicious/noExplicitAny: fixtures deliberately build loose objects
type Any = any;
const C: Any = Core;
function policy(): Any {
  return {
    timezone: "Asia/Shanghai",
    wake: "07:00",
    sleep: "23:00",
    travelMinutes: 15,
    restWeekdays: [6],
    lecturesPerStudyDay: 3,
    lectureDurations: [50, 50, 50],
    lectureOverhead: 5,
    lunchMinutes: 120,
    breakfastMinutes: 25,
    dinnerMinutes: 30,
    reviewMinutes: 20,
    practiceMinutes: 25,
    oralMinutes: 10,
    studyPlaces: ["home", "library"],
    englishTiers: [125, 100, 85, 40],
    gymWeekdays: [5, 7],
    gymMinutes: 60,
    phase: "first-pass",
    remainingLectures: 120,
    confirmedExceptions: {},
    confirmedSaturdayRunDates: [],
  };
}
function term(): Any {
  return {
    id: "synthetic",
    name: "合成测试学期",
    start: "2026-09-21",
    end: "2027-01-03",
    firstMonday: "2026-08-31",
    confirmedWeeks: [4, 5, 9, 10, 12, 13, 15, 16, 17, 18],
    confirmedDates: [],
    rules: [],
    exceptions: [],
  };
}
function simpleTask(id = "task", minutes = 50, place: Any = "home", start = 480, end = 660): Any {
  return {
    id,
    title: id,
    minutes,
    places: [place],
    windows: [{ start, end }],
    category: "law-video",
  };
}
function block(id: string, start: number, end: number, place: Any = "home"): Any {
  return C.blockForTask(simpleTask(id, end - start, place, 0, 1440), start, place);
}
function rule(id = "course", day = 2, start = "08:00", end = "10:45"): Any {
  return {
    id,
    title: "合成课程",
    weekday: day,
    start,
    end,
    from: "2026-10-26",
    until: "2026-11-22",
    location: "classroom",
    kind: "lab",
    evidence: "confirmed",
    source: "synthetic fixture",
  };
}
function data(): Any {
  return {
    schemaVersion: 1,
    exportedAt: "2026-09-26T00:00:00+08:00",
    policy: policy(),
    semesters: [term()],
    reviews: [],
    events: [],
    notes: [],
  };
}
for (const [input, want] of [
  ["00:00", 0],
  ["07:00", 420],
  ["23:59", 1439],
])
  test(`parse time ${input}`, () => a.equal(C.parseTime(input), want));
for (const s of ["7:00", "24:00", "22:60", "ab:cd", "-1:30"])
  test(`reject time ${s}`, () => a.throws(() => C.parseTime(s)));
for (const s of ["2026-02-29", "2026-13-01", "2026-09-31", "2026-9-01", "xxx"])
  test(`reject date ${s}`, () => a.throws(() => C.parseDate(s)));
test("leap day correct", () => a.equal(C.addDays("2028-02-28", 1), "2028-02-29"));
test("cross year correct", () => a.equal(C.addDays("2026-12-31", 1), "2027-01-01"));
test("date difference", () => a.equal(C.daysBetween("2026-11-03", "2026-11-10"), 7));
test("weekdays use explicit local date", () => a.equal(C.weekday("2026-10-28"), 3));
test("Shanghai date independent of host timezone", () =>
  a.equal(C.localToday(new Date("2026-09-25T18:00:00Z")), "2026-09-26"));
test("time text", () => a.equal(C.timeText(885), "14:45"));
test("invalid time text fails", () => a.throws(() => C.timeText(1441)));
test("valid policy", () => a.deepEqual(C.validatePolicy(policy()), []));
test("sleep never compressed below policy window", () =>
  a.ok(C.validatePolicy({ ...policy(), sleep: "23:30" }).length));
test("all places exactly 15 min apart", () => {
  for (const x of C.PLACES) for (const y of C.PLACES) a.equal(C.travel(x, y, 15), x === y ? 0 : 15);
});
test("classroom not a study location", () =>
  a.ok(C.validatePolicy({ ...policy(), studyPlaces: ["classroom"] }).length));
test("each lecture has duration", () =>
  a.ok(C.validatePolicy({ ...policy(), lectureDurations: [50] }).length));
test("future semester unknown, not a holiday", () =>
  a.equal(C.calendarForDate([term()], "2027-03-01").known, false));
test("missing week stays unknown", () =>
  a.equal(C.calendarForDate([term()], "2026-12-02").known, false));
test("explicit date can confirm missing week", () => {
  const t = term();
  t.confirmedDates = ["2026-12-02"];
  a.equal(C.calendarForDate([t], "2026-12-02").known, true);
});
test("overlapping semesters require decision", () =>
  a.equal(C.calendarForDate([term(), term()], "2026-09-28").known, false));
test("lab keeps whole time and arrival buffer", () => {
  const t = term();
  t.rules = [rule()];
  const b = C.calendarForDate([t], "2026-11-03").blocks[0];
  a.equal(b.start, 475);
  a.equal(b.end, 645);
  a.equal(b.segments[1].kind, "lab");
});
test("Tuesday lab ends by Nov24", () => {
  const t = term();
  t.rules = [rule()];
  a.equal(C.calendarForDate([t], "2026-11-24").blocks.length, 0);
});
test("Wednesday lab is Wednesday not duplicate Tuesday", () => {
  const t = term();
  t.rules = [rule("w", 3, "08:00", "11:40")];
  a.equal(C.calendarForDate([t], "2026-11-03").blocks.length, 0);
  a.equal(C.calendarForDate([t], "2026-11-04").blocks.length, 1);
});
test("cancel exception wins", () => {
  const t = term();
  t.rules = [rule()];
  t.exceptions = [{ date: "2026-11-03", ruleId: "course", action: "cancel", reason: "test" }];
  a.equal(C.calendarForDate([t], "2026-11-03").blocks.length, 0);
});
test("replace exception changes time and place", () => {
  const t = term();
  t.rules = [rule()];
  t.exceptions = [
    {
      date: "2026-11-03",
      ruleId: "course",
      action: "replace",
      start: "09:00",
      end: "10:00",
      location: "home",
      reason: "test",
    },
  ];
  const b = C.calendarForDate([t], "2026-11-03").blocks[0];
  a.equal(b.start, 535);
  a.equal(b.entry, "home");
});
test("duplicate exception rejected as unresolved", () => {
  const t = term();
  t.rules = [rule()];
  const e = { date: "2026-11-03", ruleId: "course", action: "cancel", reason: "test" };
  t.exceptions = [e, e];
  a.equal(C.calendarForDate([t], "2026-11-03").known, false);
});
test("invalid semester weekday rejected", () => {
  const t = term();
  t.rules = [{ ...rule(), weekday: 9 }];
  a.ok(C.validateSemester(t).length);
});
test("no overlapping task accepted", () =>
  a.ok(
    C.validateSchedule([block("a", 480, 540), block("b", 530, 570)], { start: 420, end: 1380 }, 15)
      .length,
  ));
test("15 minute move required before next task", () =>
  a.ok(
    C.validateSchedule(
      [block("a", 480, 540), block("b", 550, 600, "library")],
      { start: 420, end: 1380 },
      15,
    ).length,
  ));
test("exact 15 minute move accepted", () =>
  a.deepEqual(
    C.validateSchedule(
      [block("a", 480, 540), block("b", 555, 600, "library")],
      { start: 420, end: 1380 },
      15,
    ),
    [],
  ));
test("must return home before sleep", () =>
  a.ok(
    C.validateSchedule([block("a", 1320, 1380, "library")], { start: 420, end: 1380 }, 15).length,
  ));
test("all required tasks validated", () =>
  a.ok(C.validateSchedule([], { start: 420, end: 1380 }, 15, [simpleTask()]).length));
test("no shortened lecture", () =>
  a.ok(
    C.validateSchedule([block("task", 480, 500)], { start: 420, end: 1380 }, 15, [simpleTask()])
      .length,
  ));
test("spoken recall only in window", () => {
  const t = { ...simpleTask("s", 10), windows: [{ start: 720, end: 1080 }] };
  a.ok(C.validateSchedule([block("s", 600, 610)], { start: 420, end: 1380 }, 15, [t]).length);
});
test("simple scheduling succeeds", () => {
  const ts = [simpleTask("a"), simpleTask("b")];
  const r = C.solve(ts, [], { start: 420, end: 1380 }, 15);
  a.equal(r.status, "FEASIBLE");
  a.deepEqual(C.validateSchedule(r.blocks, { start: 420, end: 1380 }, 15, ts), []);
});
test("fixed conflict rejected before search", () =>
  a.equal(
    C.solve([], [block("a", 480, 540), block("b", 500, 530)], { start: 420, end: 1380 }, 15).status,
    "INPUT_CONFLICT",
  ));
test("capacity lower bound is not a heuristic", () =>
  a.equal(
    C.solve([simpleTask("a", 90, "home", 480, 540)], [], { start: 480, end: 540 }, 15).status,
    "CAPACITY_EXCEEDED",
  ));
test("failure never labelled proof of impossibility", () => {
  const r = C.solve([simpleTask("a", 50, "home", 480, 500)], [], { start: 420, end: 1380 }, 15);
  a.equal(r.status, "NO_PLAN_FOUND");
});
test("tiny budget is explicitly limited", () =>
  a.equal(
    C.solve([simpleTask("a"), simpleTask("b")], [], { start: 420, end: 1380 }, 15, { maxNodes: 1 })
      .status,
    "SEARCH_LIMIT",
  ));
test("duplicate task ID rejected", () =>
  a.equal(
    C.solve([simpleTask(), simpleTask()], [], { start: 420, end: 1380 }, 15).status,
    "INPUT_CONFLICT",
  ));
test("missing dependency rejected", () =>
  a.equal(
    C.solve([{ ...simpleTask(), after: ["missing"] }], [], { start: 420, end: 1380 }, 15).status,
    "INPUT_CONFLICT",
  ));
test("dependencies preserve lecture sequence", () => {
  const r = C.solve(
    [simpleTask("a"), { ...simpleTask("b"), after: ["a"] }],
    [],
    { start: 420, end: 1380 },
    15,
  );
  a.equal(r.status, "FEASIBLE");
  const aa = r.blocks.find((b) => b.id === "a"),
    bb = r.blocks.find((b) => b.id === "b");
  a.ok(aa.end <= bb.start);
});
test("deterministic repeat", () => {
  const ts = [simpleTask("a"), simpleTask("b")];
  a.deepEqual(
    C.solve(ts, [], { start: 420, end: 1380 }, 15),
    C.solve(ts, [], { start: 420, end: 1380 }, 15),
  );
});
test("three lectures survive day generation", () =>
  a.equal(
    C.dailyTasks(policy(), "2026-09-28", 125).filter((t) => t.category === "law-video").length,
    3,
  ));
test("English125 is sum of four modules", () =>
  a.equal(
    C.dailyTasks(policy(), "2026-09-28", 125)
      .filter((t) => t.category === "english")
      .reduce((n, t) => n + t.minutes, 0),
    125,
  ));
test("floor40 includes recall output and not new output overload", () =>
  a.equal(
    C.dailyTasks(policy(), "2026-09-28", 40)
      .filter((t) => t.category === "english")
      .reduce((n, t) => n + t.minutes, 0),
    40,
  ));
test("run exactly20, not roundtrip20", () => {
  const t = C.dailyTasks(policy(), "2026-09-28", 125).find((t) => t.id === "run");
  a.equal(
    t.segments.filter((x) => x.kind === "run").reduce((n, x) => n + x.minutes, 0),
    20,
  );
  a.equal(t.minutes + 15, 75);
});
test("Saturday has no study or compensation", () =>
  a.equal(
    C.dailyTasks(policy(), "2026-09-26", 0).filter(
      (t) => t.category.startsWith("law") || t.category === "english",
    ).length,
    0,
  ));
test("Saturday still needs actual run availability", () =>
  a.equal(C.planDay(policy(), [term()], "2026-09-26").status, "REST_NEEDS_WINDOW"));
test("phase completion not automatic rewatch", () =>
  a.equal(
    C.planDay({ ...policy(), remainingLectures: 0 }, [term()], "2026-09-28").status,
    "PHASE_CONFIRMATION",
  ));
test("second phase only by explicit value and not called videos", () => {
  const ts = C.dailyTasks({ ...policy(), phase: "three-block-review" }, "2026-09-28", 125);
  a.equal(ts.filter((t) => t.category === "law-video").length, 0);
  a.equal(ts.filter((t) => /^law-[123]$/.test(t.id)).length, 3);
});
test("full empty-class weekday passes validator", () => {
  const p = policy(),
    r = C.planDay(p, [term()], "2026-09-28", { maxNodes: 500 });
  a.equal(r.status, "FEASIBLE");
  a.deepEqual(C.validateSchedule(r.blocks, { start: 420, end: 1380 }, 15, r.tasks), []);
});
test("lunch stays120 without consent", () => {
  const p = policy(),
    r = C.planDay(p, [term()], "2026-09-28", { maxNodes: 500 });
  a.equal(
    r.blocks.find((b) => b.id === "lunch").end - r.blocks.find((b) => b.id === "lunch").start,
    120,
  );
  a.equal(p.lunchMinutes, 120);
});
test("exception applies only its date", () => {
  const p = policy();
  p.confirmedExceptions["2026-11-03"] = { lunchMinutes: 75 };
  a.equal(C.effectivePolicy(p, "2026-11-03").lunchMinutes, 75);
  a.equal(C.effectivePolicy(p, "2026-11-04").lunchMinutes, 120);
});
test("future unconfirmed semester never feasible", () =>
  a.equal(C.planDay(policy(), [term()], "2027-03-01").status, "NEEDS_CALENDAR"));
test("all drawn travel has real duration", () => {
  const r = C.planDay(policy(), [term()], "2026-09-28", { maxNodes: 500 });
  for (const t of r.timeline.filter((x) => x.kind === "travel")) a.equal(t.end - t.start, 15);
});
test("English does not overlap any class", () => {
  const t = term();
  t.rules = [{ ...rule("pm", 1, "14:00", "16:35"), from: "2026-09-21", until: "2026-12-01" }];
  const r = C.planDay(policy(), [t], "2026-09-28", { maxNodes: 500 });
  if (r.status === "FEASIBLE")
    a.deepEqual(C.validateSchedule(r.blocks, { start: 420, end: 1380 }, 15, r.tasks), []);
  else a.ok(["SEARCH_LIMIT", "NO_PLAN_FOUND", "CAPACITY_EXCEEDED"].includes(r.status));
});
test("replan never puts remaining work in past", () => {
  const ts = [simpleTask("a", 30, "home", 480, 1000)];
  const r = C.replanRemainder(ts, [], 900, "home", 1380, 15);
  a.equal(r.status, "FEASIBLE");
  a.ok(r.blocks.every((b) => b.start >= 900));
});
test("replan honours actual current place", () => {
  const ts = [simpleTask("a", 30, "home", 480, 1000)];
  const r = C.replanRemainder(ts, [], 900, "library", 1380, 15);
  a.equal(r.status, "FEASIBLE");
  a.ok(r.blocks[0].start >= 915);
});
test("ongoing class not cut by replan", () =>
  a.equal(
    C.replanRemainder([], [block("class", 800, 1000, "classroom")], 900, "classroom", 1380, 15)
      .status,
    "INPUT_CONFLICT",
  ));
test("remaining partial work conserves minutes", () => {
  const r = C.remainingTasks([simpleTask("a", 50), { ...simpleTask("b"), after: ["a"] }], [], {
    a: 20,
  });
  a.equal(r[0].minutes, 30);
  a.equal(r[1].minutes, 50);
});
test("completed predecessor removed from remaining dependencies", () => {
  const r = C.remainingTasks([simpleTask("a"), { ...simpleTask("b"), after: ["a"] }], ["a"]);
  a.deepEqual(r[0].after, []);
});
test("cannot imply completion from elapsed time", () =>
  a.throws(() => C.remainingTasks([simpleTask("a", 50)], [], { a: 50 })));
function card(): Any {
  return {
    id: "c",
    prompt: "复述一个制度",
    source: "用户合法持有教材，第10页",
    stage: 0,
    dueDate: "2026-09-27",
    history: [],
  };
}
function log(id = "e", date = "2026-09-27", result = "good"): Any {
  return { eventId: id, date, result, closedBook: true, afterFeedback: false, sourceChecked: true };
}
test("correct recall moves due forward", () =>
  a.equal(C.recordReview(card(), log()).dueDate, "2026-09-30"));
test("forgotten is not hard", () => {
  const c = card();
  c.stage = 4;
  a.equal(C.recordReview(c, log("e", "2026-09-27", "forgot")).stage, 0);
});
test("feedback reread not delayed proof", () => {
  const c = card(),
    r = C.recordReview(c, { ...log(), afterFeedback: true });
  a.equal(r.stage, c.stage);
  a.equal(r.dueDate, c.dueDate);
  a.equal(r.history.length, 1);
});
test("open book does not update retention", () =>
  a.equal(C.recordReview(card(), { ...log(), closedBook: false }).stage, 0));
test("unverified answer does not update retention", () =>
  a.equal(C.recordReview(card(), { ...log(), sourceChecked: false }).stage, 0));
test("review event is idempotent", () => {
  const c = C.recordReview(card(), log());
  a.deepEqual(C.recordReview(c, log()), c);
});
test("same-day repeat cannot farm intervals", () => {
  const c = C.recordReview(card(), log());
  a.equal(C.recordReview(c, log("e2")).stage, c.stage);
});
test("history cannot be backdated silently", () =>
  a.throws(() => C.recordReview(C.recordReview(card(), log()), log("older", "2026-09-26"))));
test("Saturday due date scheduling deferred without rewriting due", () => {
  const c = card();
  c.dueDate = "2026-10-03";
  a.equal(C.nextReviewStudyDate(c.dueDate), "2026-10-04");
  a.equal(c.dueDate, "2026-10-03");
});
test("review queue is bounded", () => {
  const cs = Array.from({ length: 100 }, (_, i) => ({ ...card(), id: `${i}` }));
  a.equal(C.reviewQueue(cs, "2026-10-01", 5).length, 5);
});
test("queue has no future card", () => a.equal(C.reviewQueue([card()], "2026-09-26").length, 0));
test("not enough samples leaves estimate explicit", () =>
  a.equal(C.estimateMinutes([60], 50).minutes, 50));
test("actual time estimate rounds up", () =>
  a.equal(C.estimateMinutes([50, 52, 58, 60], 50).minutes, 60));
test("timer counts not mastery", () => {
  const e = {
    id: "e",
    date: "2026-09-27",
    taskId: "lesson1",
    kind: "watched",
    minutes: 50,
    source: "self",
    selfReported: true,
  };
  const s = C.learningSummary(C.appendCompletion([], e));
  a.equal(s.watched, 1);
  a.equal(s.retrieved, 0);
  a.equal(s.retested, 0);
});
test("completion event duplicate is idempotent", () => {
  const e = {
    id: "e",
    date: "2026-09-27",
    taskId: "lesson1",
    kind: "watched",
    minutes: 50,
    source: "self",
    selfReported: true,
  };
  a.equal(C.appendCompletion(C.appendCompletion([], e), e).length, 1);
});
test("rewatch not another distinct lecture", () => {
  const es = [1, 2].map((n) => ({
    id: `${n}`,
    date: "2026-09-27",
    taskId: "lesson1",
    kind: "watched",
    minutes: 50,
    source: "self",
    selfReported: true,
  }));
  a.equal(C.learningSummary(es).watched, 1);
});
test("export import round trip", () => a.deepEqual(C.decodeExport(C.encodeExport(data())), data()));
test("unknown schema rejected without changing input", () => {
  const d = data(),
    before = JSON.stringify(d);
  a.throws(() => C.decodeExport(JSON.stringify({ ...d, schemaVersion: 999 })));
  a.equal(JSON.stringify(d), before);
});
test("prototype poisoning rejected", () =>
  a.throws(() => C.decodeExport('{"schemaVersion":1,"__proto__":{"polluted":true}}')));
test("malformed backup rejected", () => a.throws(() => C.decodeExport("[]")));
test("oversize rejected", () => a.throws(() => C.decodeExport(" ".repeat(5_000_001))));
test("ICS has CRLF and UTC time", () => {
  const s = C.exportIcs("2026-09-28", [
    { id: "x", start: 480, end: 530, title: "测试", kind: "study", place: "home" },
  ]);
  a.ok(s.includes("DTSTART:20260928T000000Z\r\n"));
});
test("ICS Chinese lines fold by octets", () => {
  const s = C.exportIcs("2026-09-28", [
    { id: "x", start: 480, end: 530, title: "长标题".repeat(60), kind: "study", place: "home" },
  ]);
  a.ok(s.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75));
});
test("ICS escapes newline injection", () => {
  const s = C.exportIcs("2026-09-28", [
    { id: "x", start: 480, end: 530, title: "x\nBEGIN:VEVENT", kind: "study", place: "home" },
  ]);
  a.equal(s.split("\r\n").filter((l) => l === "BEGIN:VEVENT").length, 1);
});
test("CSV parses quoted commas", () =>
  a.deepEqual(C.parseCsv('a,b\n"a,b",c'), [
    ["a", "b"],
    ["a,b", "c"],
  ]));
test("CSV broken quote rejected", () => a.throws(() => C.parseCsv('a,b\n"x,y')));
const csv =
  "title,weekday,start,end,from,until,location,kind\n测试,2,08:00,10:45,2027-03-01,2027-06-01,classroom,lab";
test("CSV course import marked provisional", () =>
  a.equal(C.calendarRulesFromCsv(csv)[0].evidence, "provisional"));
test("CSV never guesses malformed headers", () =>
  a.throws(() => C.calendarRulesFromCsv("x,y\na,b")));
test("CSV unknown place rejected", () =>
  a.throws(() => C.calendarRulesFromCsv(csv.replace("classroom", "moon"))));
test("randomized returned plans all obey validator (200 scenarios)", () => {
  let seed = 271828;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 200; i++) {
    const ts = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, j) =>
      simpleTask(
        `t${j}`,
        10 + Math.floor(rand() * 9) * 5,
        rand() < 0.5 ? "home" : "library",
        480,
        900,
      ),
    );
    const r = C.solve(ts, [], { start: 420, end: 960 }, 15, { maxNodes: 100, maxCandidates: 12 });
    if (r.status === "FEASIBLE")
      a.deepEqual(C.validateSchedule(r.blocks, { start: 420, end: 960 }, 15, ts), []);
  }
});
