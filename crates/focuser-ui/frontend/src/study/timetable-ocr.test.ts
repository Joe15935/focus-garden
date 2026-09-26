import { describe, expect, it } from "vitest";
import * as C from "./core";
import {
  detectCards,
  draftsFromShots,
  fromVision,
  inferDate,
  type OcrText,
  parseShot,
  readLayout,
} from "./timetable-ocr";

/**
 * A synthetic screenshot shaped like a common timetable app: page title,
 * weekday header with dates, period numbers and times down the left, pastel
 * course cards with white lettering, a bottom tab bar. Geometry mirrors a real
 * 1320 px wide phone capture; the text is invented.
 */
const W = 1320;
const H = 2700;
const COLS = [264, 420, 576, 732, 888, 1044, 1200];
const BG: [number, number, number] = [240, 241, 245];
const PERIODS: [number, string, string][] = [
  [2, "08:55", "09:40"],
  [3, "10:00", "10:45"],
  [4, "10:55", "11:40"],
  [5, "12:10", "12:55"],
  [6, "13:05", "13:50"],
  [7, "14:00", "14:45"],
  [8, "14:55", "15:40"],
  [9, "15:50", "16:35"],
  [10, "16:55", "17:40"],
  [11, "17:50", "18:35"],
  [12, "19:20", "20:05"],
  [13, "20:15", "21:00"],
  [14, "21:10", "21:55"],
];
const periodY = (n: number) => 435 + (n - 2) * 150; // number label top

interface CardSpec {
  weekday: number;
  from: number;
  to: number;
  lines: string[];
  colour: [number, number, number];
  clipTop?: boolean;
}

function shot(
  monday: string,
  week: number,
  cards: CardSpec[],
  options: { dropTuesdayHeader?: boolean } = {},
) {
  const texts: OcrText[] = [
    { text: "我的课表", x: 27, y: 78, w: 240, h: 50 },
    { text: `本周为第4周`, x: 26, y: 154, w: 230, h: 34 },
    { text: `${week}`, x: 95, y: 253, w: 36, h: 28 },
    { text: "周次", x: 80, y: 305, w: 60, h: 30 },
  ];
  ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].forEach((label, i) => {
    const x = COLS[i] ?? 0;
    if (!(options.dropTuesdayHeader && i === 1))
      texts.push({ text: label, x: x - 35, y: 251, w: 70, h: 32 });
    const d = C.addDays(monday, i);
    if (!(options.dropTuesdayHeader && i === 1))
      texts.push({ text: `${d.slice(5, 7)}/${d.slice(8)}`, x: x - 39, y: 309, w: 79, h: 22 });
  });
  texts.push({ text: "08:45", x: 75, y: 365, w: 68, h: 30 });
  for (const [n, s, e] of PERIODS) {
    const y = periodY(n);
    texts.push({ text: String(n), x: 95, y, w: 30, h: 32 });
    texts.push({ text: s, x: 76, y: y + 60, w: 67, h: 20 });
    texts.push({ text: e, x: 76, y: y + 92, w: 67, h: 20 });
  }
  texts.push({ text: `已切换到第${week}周`, x: 480, y: 2400, w: 360, h: 50 });
  for (const [i, label] of ["首页", "日程", "课表", "考试", "我的"].entries())
    texts.push({ text: label, x: 140 + i * 240, y: 2520, w: 70, h: 32 });

  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...BG, 255], i * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
      for (let x = x0; x < x1; x++) data.set([...c, 255], (y * W + x) * 4);
  };
  for (const card of cards) {
    const x = COLS[card.weekday - 1] ?? 0;
    const top = card.clipTop ? 300 : periodY(card.from) - 12;
    const bottom = periodY(card.to) + 140;
    fill(x - 66, top, x + 66, bottom, card.colour);
    // Location near the top, teacher near the bottom, title lines in between — like the real app.
    const n = card.lines.length;
    // A card scrolled under the header shows its text lower down.
    const first = card.clipTop ? top + 110 : top + 15;
    card.lines.forEach((line, i) => {
      const y = Math.round(
        n === 1 ? (top + bottom) / 2 : first + ((bottom - 60 - first) * i) / (n - 1),
      );
      texts.push({ text: line, x: x - 50, y, w: 100, h: 28 });
      // White lettering across most of the card width.
      fill(x - 48, y, x + 48, y + 28, [255, 255, 255]);
    });
  }
  // Header strip (white) above the grid.
  fill(0, 230, W, 340, [250, 250, 252]);
  return { texts, pixels: { width: W, height: H, data } };
}

const GREEN: [number, number, number] = [190, 216, 152];
const ORANGE: [number, number, number] = [245, 190, 110];
const PINK: [number, number, number] = [225, 120, 155];
const TERM: C.Semester = {
  id: "t",
  name: "合成学期",
  start: "2026-09-21",
  end: "2027-01-03",
  firstMonday: "2026-08-31",
  confirmedWeeks: [],
  confirmedDates: [],
  rules: [],
  exceptions: [],
};

function parse(name: string, s: ReturnType<typeof shot>) {
  const layout = readLayout(s.texts, H, "2026-09-26");
  const cards = detectCards(
    s.pixels,
    layout.columns.map((c) => c.x),
    layout.colWidth,
    layout.gridTop,
    layout.gridBottom,
  );
  return parseShot(name, s.texts, H, cards, "2026-09-26");
}

describe("timetable screenshots", () => {
  it("infers the year closest to today", () => {
    expect(inferDate(1, 3, "2026-12-20")).toBe("2027-01-03");
    expect(inferDate(12, 28, "2027-01-02")).toBe("2026-12-28");
    expect(inferDate(2, 30, "2026-09-26")).toBeNull();
  });

  it("converts Vision's bottom-left normalised boxes to pixels", () => {
    expect(fromVision([{ text: "a", x: 0.1, y: 0.8, w: 0.2, h: 0.1 }], 1000, 2000)[0]).toEqual({
      text: "a",
      x: 100,
      y: 200,
      w: 200,
      h: 200,
    });
  });

  it("reads columns, dates, week and periods, even with the highlighted header unread", () => {
    const s = shot("2026-11-02", 10, [], { dropTuesdayHeader: true });
    const layout = readLayout(s.texts, H, "2026-09-26");
    expect(layout.columns.map((c) => Math.round(c.x))).toEqual(COLS);
    expect(layout.dates).toEqual(Array.from({ length: 7 }, (_, i) => C.addDays("2026-11-02", i)));
    expect(layout.weekNumber).toBe(10);
    const p7 = layout.periods.find((p) => p.n === 7);
    expect([p7?.start, p7?.end]).toEqual([840, 885]);
    expect(layout.periods[0]).toMatchObject({ n: 1, start: null, end: 525 });
    expect(layout.gridBottom).toBeLessThan(2400);
  });

  it("finds cards, splits location / title / teacher and maps periods", () => {
    const s = shot("2026-11-02", 10, [
      {
        weekday: 2,
        from: 7,
        to: 9,
        lines: ["5教101", "植物生", "理学与", "生态学", "李明"],
        colour: GREEN,
      },
      { weekday: 4, from: 7, to: 8, lines: ["5教101", "遗传学", "王芳"], colour: ORANGE },
      {
        weekday: 4,
        from: 12,
        to: 13,
        lines: ["Online Learning", "数据科", "学", "赵刚"],
        colour: PINK,
      },
      { weekday: 2, from: 2, to: 3, lines: ["遗传学", "陈静"], colour: ORANGE, clipTop: true },
    ]);
    const parsed = parse("w10", s);
    const byTitle = Object.fromEntries(parsed.courses.map((c) => [c.title, c]));
    expect(byTitle.植物生理学与生态学).toMatchObject({
      weekday: 2,
      startPeriod: 7,
      endPeriod: 9,
      location: "5教101",
      teacher: "李明",
    });
    expect(byTitle.遗传学 && [byTitle.遗传学.startPeriod, byTitle.遗传学.endPeriod]).toBeTruthy();
    const lab = parsed.courses.find((c) => c.weekday === 2 && c.startPeriod < 7);
    expect(lab).toMatchObject({ title: "遗传学", startPeriod: 1, endPeriod: 3 });
    expect(lab?.notes.join()).toMatch(/遮住/);
    expect(parsed.courses.find((c) => c.title === "数据科学")).toMatchObject({
      weekday: 4,
      startPeriod: 12,
      endPeriod: 13,
      location: "OnlineLearning",
    });
  });

  it("merges weekly screenshots into rules with exact weeks, and flags inferred times", () => {
    const w10 = shot("2026-11-02", 10, [
      { weekday: 2, from: 12, to: 13, lines: ["5教309", "数据科学", "赵刚"], colour: PINK },
      { weekday: 2, from: 2, to: 3, lines: ["遗传学", "陈静"], colour: ORANGE, clipTop: true },
    ]);
    const w12 = shot("2026-11-16", 12, [
      {
        weekday: 2,
        from: 12,
        to: 13,
        lines: ["Online Learning", "数据科学", "赵刚"],
        colour: PINK,
      },
      { weekday: 2, from: 2, to: 3, lines: ["遗传学", "周雪"], colour: ORANGE, clipTop: true },
    ]);
    const r = draftsFromShots([parse("w10", w10), parse("w12", w12)], TERM);
    expect(r.weeks).toEqual([10, 12]);
    const lab = r.drafts.find((d) => d.rule.title === "遗传学");
    expect(lab?.rule).toMatchObject({ weekday: 2, start: "08:00", end: "10:45" });
    expect(lab?.weeks).toEqual([10, 12]);
    expect(lab?.rule.source).toMatch(/45 分钟/);
    const online = r.drafts.find((d) => d.rule.title === "数据科学" && d.rule.location === "home");
    const room = r.drafts.find(
      (d) => d.rule.title === "数据科学" && d.rule.location === "classroom",
    );
    expect(online?.weeks).toEqual([12]);
    expect(room?.weeks).toEqual([10]);
    expect(r.drafts.every((d) => d.rule.evidence === "provisional")).toBe(true);
  });

  it("an empty week yields no rules but still counts as a screenshot week", () => {
    const r = draftsFromShots([parse("w18", shot("2026-12-28", 18, []))], TERM);
    expect(r.drafts).toEqual([]);
    expect(r.weeks).toEqual([18]);
  });

  it("skips screenshots outside the semester", () => {
    const r = draftsFromShots([parse("x", shot("2027-03-01", 1, []))], TERM);
    expect(r.weeks).toEqual([]);
    expect(r.notes.join()).toMatch(/不在/);
  });
});
