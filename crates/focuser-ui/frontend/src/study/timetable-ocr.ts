/**
 * MIT. Turning screenshots of a weekly timetable app (grid: weekday columns,
 * numbered periods down the left, coloured course cards) into calendar rules.
 *
 * Text comes from the Mac's own Vision OCR (no network). Card rectangles come
 * from the pixels: cards are saturated colour on a near-grey background. The
 * two are combined here with pure functions, so every step is testable and a
 * doubtful result is flagged for the user rather than silently guessed.
 */
import * as C from "./core";
import { type Occurrence, type RuleDraft, rulesFromOccurrences } from "./ics";

export interface OcrText {
  text: string;
  /** Pixels, origin top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Card extends Rect {
  clippedTop: boolean;
  clippedBottom: boolean;
}
export interface Period {
  n: number;
  start: number | null;
  end: number | null;
  yTop: number;
  yBottom: number;
}
export interface ParsedCourse {
  weekday: number;
  title: string;
  location: string;
  teacher: string;
  startPeriod: number;
  endPeriod: number;
  notes: string[];
}
export interface ParsedShot {
  name: string;
  weekNumber: number | null;
  dates: (string | null)[];
  columns: { weekday: number; x: number }[];
  periods: Period[];
  courses: ParsedCourse[];
  warnings: string[];
  gridTop: number;
  gridBottom: number;
}
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
}

const WEEKDAY_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WEEKDAYS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const LOCATION = /教\d|楼|室|馆|实验|online|learning|线上|网课|^[A-Za-z]?\d{3,4}$/i;
const PERSON = /^[一-龥·]{2,4}$/u;
const NAV = /^(首页|日程|课表|考试|我的)$/;

const cx = (t: OcrText) => t.x + t.w / 2;
const cy = (t: OcrText) => t.y + t.h / 2;
const clean = (s: string) => s.replace(/\s+/g, "").replace(/[：]/g, ":");

/** Year for a MM/DD label: the one closest to `reference`. */
export function inferDate(month: number, day: number, reference: string): string | null {
  const ref = C.parseDate(reference).getTime();
  const year = Number(reference.slice(0, 4));
  let best: string | null = null;
  for (const y of [year - 1, year, year + 1]) {
    const s = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    try {
      C.parseDate(s);
    } catch {
      continue;
    }
    if (
      !best ||
      Math.abs(C.parseDate(s).getTime() - ref) < Math.abs(C.parseDate(best).getTime() - ref)
    )
      best = s;
  }
  return best;
}

export function isColored(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 70) return false;
  return (max - min) / max > 0.2;
}

/** Finds coloured card rectangles in each weekday column between gridTop and gridBottom. */
export function detectCards(
  img: Pixels,
  columns: number[],
  colWidth: number,
  gridTop: number,
  gridBottom: number,
): Card[] {
  const cards: Card[] = [];
  const rgb = (x: number, y: number): [number, number, number] => {
    const xi = Math.max(0, Math.min(img.width - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(img.height - 1, Math.round(y)));
    const i = (yi * img.width + xi) * 4;
    return [Number(img.data[i]), Number(img.data[i + 1]), Number(img.data[i + 2])];
  };
  const at = (x: number, y: number) => isColored(...rgb(x, y));
  // The page background is the most common colour in the grid; lettering blended into a card is not.
  const counts = new Map<string, number>();
  for (let y = Math.round(gridTop); y < gridBottom; y += 7)
    for (let x = 0; x < img.width; x += 11) {
      const [r, g, b] = rgb(x, y);
      const key = `${r >> 3},${g >> 3},${b >> 3}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const mode = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0]
    ?.split(",")
    .map((v) => Number(v) * 8 + 4) ?? [240, 241, 245];
  const background = (x: number, y: number) => {
    const c = rgb(x, y);
    return c.every((v, i) => Math.abs(v - (mode[i] ?? 0)) <= 10);
  };
  const top = Math.max(0, Math.round(gridTop));
  const bottom = Math.min(img.height, Math.round(gridBottom));
  for (const x of columns) {
    const samples = [-3, -2, -1, 0, 1, 2, 3].map((k) => x + k * colWidth * 0.11);
    let runStart = -1;
    let lastColored = -1;
    const close = (end: number) => {
      if (runStart >= 0 && end - runStart >= 25 && colWidth > 0) {
        // A card never leaves its weekday column; neighbours' glow must not widen it.
        const x0 = x - colWidth * 0.46;
        const x1 = x + colWidth * 0.46;
        cards.push({
          x0,
          x1,
          y0: runStart,
          y1: end,
          clippedTop: runStart <= top + 25,
          clippedBottom: end >= bottom - 3,
        });
      }
      runStart = -1;
    };
    for (let y = top; y < bottom; y++) {
      const hits = samples.filter((sx) => at(sx, y)).length;
      if (hits >= 3) {
        if (runStart < 0) runStart = y;
        lastColored = y;
      } else if (runStart >= 0) {
        const bg = samples.filter((sx) => background(sx, y)).length;
        // Close on real page background; lettering inside a card does not end it.
        if (bg >= 5) close(lastColored + 1);
        else if (hits >= 1) lastColored = y;
      }
    }
    if (runStart >= 0) close(lastColored + 1);
  }
  return cards;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
}

/** Header, periods and grid bounds from the OCR text alone. */
export function readLayout(texts: OcrText[], height: number, reference: string) {
  const warnings: string[] = [];
  const items = texts.map((t) => ({ ...t, text: clean(t.text) })).filter((t) => t.text);
  // Column anchors come from weekday headers and from dated labels (a date tells its weekday).
  const anchors: { weekday: number; x: number; y: number; bottom: number }[] = [];
  const dated: { x: number; y: number; bottom: number; date: string }[] = [];
  for (const t of items) {
    const m = t.text.match(/^周([一二三四五六日天])(?:(\d{1,2})\/(\d{1,2}))?$/);
    if (m?.[1]) {
      anchors.push({ weekday: WEEKDAYS[m[1]] ?? 0, x: cx(t), y: t.y, bottom: t.y + t.h });
      const date = m[2] && m[3] ? inferDate(+m[2], +m[3], reference) : null;
      if (date) dated.push({ x: cx(t), y: t.y, bottom: t.y + t.h, date });
      continue;
    }
    const d = t.text.match(/^(\d{1,2})\/(\d{1,2})$/);
    const date = d ? inferDate(Number(d[1]), Number(d[2]), reference) : null;
    if (date) {
      dated.push({ x: cx(t), y: t.y, bottom: t.y + t.h, date });
      anchors.push({ weekday: C.weekday(date), x: cx(t), y: t.y, bottom: t.y + t.h });
    }
  }
  // Fit x = a + b·weekday so a header the OCR missed (e.g. the highlighted day) is still placed.
  const distinct = [...new Map(anchors.map((a) => [a.weekday, a])).values()];
  const columns: { weekday: number; x: number }[] = [];
  let colWidth = 100;
  if (distinct.length >= 2) {
    const n = anchors.length;
    const mw = anchors.reduce((s, a) => s + a.weekday, 0) / n;
    const mx = anchors.reduce((s, a) => s + a.x, 0) / n;
    const b =
      anchors.reduce((s, a) => s + (a.weekday - mw) * (a.x - mx), 0) /
      anchors.reduce((s, a) => s + (a.weekday - mw) ** 2, 0);
    const a0 = mx - b * mw;
    colWidth = Math.abs(b);
    for (let w = 1; w <= 7; w++) columns.push({ weekday: w, x: a0 + b * w });
  } else warnings.push("没有认出星期表头，请确认截图包含「周一…周日」和日期一行");
  const headerY = anchors.length ? Math.min(...anchors.map((a) => a.y)) : 0;
  const headerBottom = anchors.length ? Math.max(...anchors.map((a) => a.bottom)) : 0;
  const dates: (string | null)[] = [null, null, null, null, null, null, null];
  for (const d of dated) {
    if (d.y < headerY - 5) continue;
    dates[C.weekday(d.date) - 1] = d.date;
  }
  // Fill the unread dates of the same week from any one that was read.
  const anyDate = dates.findIndex(Boolean);
  if (anyDate >= 0) {
    const monday = C.addDays(dates[anyDate] as string, -anyDate);
    for (let i = 0; i < 7; i++) dates[i] = dates[i] ?? C.addDays(monday, i);
  }
  // Week number: the digit printed above "周次", or the "已切换到第N周" toast.
  let weekNumber: number | null = null;
  const label = items.find((t) => t.text === "周次");
  if (label) {
    const digit = items
      .filter(
        (t) =>
          /^\d{1,2}$/.test(t.text) &&
          Math.abs(cx(t) - cx(label)) < 60 &&
          t.y < label.y &&
          label.y - t.y < 100,
      )
      .sort((a, b) => b.y - a.y)[0];
    if (digit) weekNumber = Number(digit.text);
  }
  if (weekNumber === null) {
    const m = items.map((t) => t.text.match(/切换到第(\d+)周/)).find(Boolean);
    if (m?.[1]) weekNumber = Number(m[1]);
  }
  // Bottom tab bar / toast only; the page title "我的课表" at the top must not end the grid.
  const navTop = items
    .filter((t) => (NAV.test(t.text) || /切换到第/.test(t.text)) && t.y > height * 0.7)
    .map((t) => t.y);
  const gridTop = headerBottom + 4;
  const gridBottom = navTop.length ? Math.min(...navTop) - 6 : height;

  // Periods: HH:MM labels left of the first column, in start/end pairs.
  const leftEdge = (columns[0]?.x ?? 0) - colWidth * 0.55;
  const left = items.filter((t) => cx(t) < leftEdge && cy(t) > gridTop - 30 && cy(t) < gridBottom);
  const times = left
    .map((t) => ({ t, m: t.text.match(/^(\d{1,2})[:.]?(\d{2})$/) }))
    .filter((x) => x.m)
    .map(({ t, m }) => ({ y: cy(t), minutes: Number(m?.[1]) * 60 + Number(m?.[2]) }))
    .filter((x) => x.minutes < 1440)
    .sort((a, b) => a.y - b.y);
  // Keep the longest run of labels whose times increase downwards; a misread label breaks it.
  {
    const n = times.length;
    const len = new Array<number>(n).fill(1);
    const prev = new Array<number>(n).fill(-1);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < i; j++)
        if (
          (times[j]?.minutes ?? 0) < (times[i]?.minutes ?? 0) &&
          (len[j] ?? 0) + 1 > (len[i] ?? 0)
        ) {
          len[i] = (len[j] ?? 0) + 1;
          prev[i] = j;
        }
    let best = len.indexOf(Math.max(0, ...len));
    const keep = new Set<number>();
    while (best >= 0) {
      keep.add(best);
      best = prev[best] ?? -1;
    }
    const kept = times.filter((_, i) => keep.has(i));
    if (kept.length < times.length) warnings.push("有节次时间读得不清楚，已忽略");
    times.splice(0, times.length, ...kept);
  }
  const gaps = times.slice(1).map((x, i) => x.y - (times[i]?.y ?? 0));
  const cut = gaps.length ? (Math.min(...gaps) + Math.max(...gaps)) / 2 : 0;
  const pairs: { start: number | null; end: number | null; y: number }[] = [];
  for (let i = 0; i < times.length; i++) {
    const cur = times[i];
    const next = times[i + 1];
    if (!cur) continue;
    const closeNext = next && next.y - cur.y < cut && Math.min(...gaps) < cut;
    if (closeNext && next) {
      pairs.push({ start: cur.minutes, end: next.minutes, y: cur.y });
      i++;
    } else if (i === 0) {
      // Scrolled-off first period: only its end time is visible.
      pairs.push({ start: null, end: cur.minutes, y: cur.y });
    } else pairs.push({ start: cur.minutes, end: null, y: cur.y });
  }
  const spacing = median(pairs.slice(1).map((p, i) => p.y - (pairs[i]?.y ?? 0))) || 120;
  // Number the pairs from any readable period digits; otherwise from a scrolled-off first period.
  const votes = new Map<number, number>();
  for (const num of left.filter((t) => /^\d{1,2}$/.test(t.text))) {
    const idx = pairs.findIndex(
      (p) => p.start !== null && p.y - cy(num) > 0 && p.y - cy(num) < spacing * 0.8,
    );
    if (idx >= 0) {
      const offset = Number(num.text) - idx;
      votes.set(offset, (votes.get(offset) ?? 0) + 1);
    }
  }
  let offset = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (offset === undefined) {
    offset = 1;
    if (pairs.length) warnings.push("节次序号没有读到，按从第 1 节开始编号，请核对");
  }
  const periods: Period[] = pairs.map((p, i) => ({
    n: i + offset,
    start: p.start,
    end: p.end,
    yTop: p.start === null ? p.y - spacing * 0.9 : p.y - spacing * 0.45,
    yBottom: p.start === null ? p.y + spacing * 0.1 : p.y + spacing * 0.55,
  }));
  if (periods.length < 4) warnings.push("左侧节次时间没有认全，时间需要手动核对");
  return { columns, colWidth, dates, weekNumber, gridTop, gridBottom, periods, warnings };
}

/** Full parse of one screenshot. `cards` come from detectCards on the same image. */
export function parseShot(
  name: string,
  texts: OcrText[],
  height: number,
  cards: Card[],
  reference: string,
): ParsedShot {
  const layout = readLayout(texts, height, reference);
  const { columns, colWidth, periods, gridTop, gridBottom } = layout;
  const warnings = [...layout.warnings];
  const courses: ParsedCourse[] = [];
  const leftEdge = (columns[0]?.x ?? 0) - colWidth * 0.55;
  const inGrid = texts
    .map((t) => ({ ...t, text: clean(t.text) }))
    .filter((t) => t.text && cx(t) > leftEdge && cy(t) > gridTop && cy(t) < gridBottom);
  const maxVisible = periods.length ? Math.max(...periods.map((p) => p.n)) : 0;
  for (const card of cards) {
    const inside = inGrid
      .filter(
        (t) =>
          cx(t) >= card.x0 - 4 &&
          cx(t) <= card.x1 + 4 &&
          cy(t) >= card.y0 - 4 &&
          cy(t) <= card.y1 + 4,
      )
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const column = columns.reduce<{ weekday: number; x: number } | null>(
      (best, c) =>
        !best ||
        Math.abs(c.x - (card.x0 + card.x1) / 2) < Math.abs(best.x - (card.x0 + card.x1) / 2)
          ? c
          : best,
      null,
    );
    if (!column) continue;
    if (!inside.length) {
      warnings.push(`${WEEKDAY_NAMES[column.weekday] ?? ""}有一个色块没有读到文字，已跳过`);
      continue;
    }
    const lines = inside.map((t) => t.text);
    const notes: string[] = [];
    const location: string[] = [];
    while (lines.length > 1 && LOCATION.test(lines[0] ?? "") && location.length < 2)
      location.push(lines.shift() ?? "");
    let teacher = "";
    const last = inside[inside.length - 1];
    if (
      lines.length > 1 &&
      last &&
      PERSON.test(lines[lines.length - 1] ?? "") &&
      cy(last) > card.y0 + (card.y1 - card.y0) * 0.5
    )
      teacher = lines.pop() ?? "";
    const title = lines.join("");
    if (card.clippedTop && !location.length) notes.push("卡片上方被截图遮住，地点没有读到");
    const covered = periods.filter((p) => {
      const mid = (p.yTop + p.yBottom) / 2;
      return mid >= card.y0 && mid <= card.y1;
    });
    if (!covered.length) {
      warnings.push(`「${title}」没有对上节次，已跳过`);
      continue;
    }
    let startPeriod = Math.min(...covered.map((p) => p.n));
    const endPeriod = Math.max(...covered.map((p) => p.n));
    if (card.clippedTop && startPeriod > 1) {
      const earlier = periods.filter((p) => p.n < startPeriod);
      if (earlier.every((p) => p.start === null || p.yBottom <= card.y0 + 5)) {
        startPeriod = Math.min(1, ...earlier.map((p) => p.n));
        notes.push("上方被遮住，按从第 1 节开始推断，需核对");
      }
    }
    if (card.clippedBottom && endPeriod === maxVisible) notes.push("下方被遮住，结束节次需核对");
    courses.push({
      weekday: column.weekday,
      title,
      location: location.join(" "),
      teacher,
      startPeriod,
      endPeriod,
      notes,
    });
  }
  return {
    name,
    weekNumber: layout.weekNumber,
    dates: layout.dates,
    columns,
    periods,
    courses,
    warnings,
    gridTop,
    gridBottom,
  };
}

/** One period table from all screenshots in the batch; fills gaps where the same period was visible elsewhere. */
export function mergePeriods(
  shots: ParsedShot[],
): Map<number, { start: number | null; end: number | null }> {
  const table = new Map<number, { start: number | null; end: number | null }>();
  for (const shot of shots)
    for (const p of shot.periods) {
      const cur = table.get(p.n) ?? { start: null, end: null };
      table.set(p.n, { start: cur.start ?? p.start, end: cur.end ?? p.end });
    }
  return table;
}

export interface ShotImport {
  drafts: RuleDraft[];
  weeks: number[];
  notes: string[];
}

/** Combines several weekly screenshots into rule drafts with exact teaching weeks. */
export function draftsFromShots(shots: ParsedShot[], semester: C.Semester): ShotImport {
  const table = mergePeriods(shots);
  const notes: string[] = [];
  const occurrences: Occurrence[] = [];
  const flagged = new Map<string, string[]>();
  const weeks = new Set<number>();
  for (const shot of shots) {
    notes.push(...shot.warnings.map((w) => `${shot.name}：${w}`));
    const known = shot.dates
      .map((d, i) => (d ? C.addDays(d, -i) : null))
      .filter((d): d is string => !!d);
    const monday =
      known[0] ??
      (shot.weekNumber ? C.addDays(semester.firstMonday, (shot.weekNumber - 1) * 7) : null);
    if (!monday) {
      notes.push(`${shot.name}：没有认出日期和周次，已跳过`);
      continue;
    }
    if (known.some((d) => d !== monday))
      notes.push(`${shot.name}：表头日期不连续，按 ${monday} 这一周处理，请核对`);
    const week = Math.floor(C.daysBetween(semester.firstMonday, monday) / 7) + 1;
    if (shot.weekNumber !== null && shot.weekNumber !== week)
      notes.push(
        `${shot.name}：截图写第 ${shot.weekNumber} 周，但日期对应本学期第 ${week} 周；以日期为准`,
      );
    if (C.daysBetween(semester.start, monday) < -6 || monday > semester.end) {
      notes.push(`${shot.name}：${monday} 这一周不在「${semester.name}」范围内，已跳过`);
      continue;
    }
    weeks.add(week);
    for (const course of shot.courses) {
      const start = table.get(course.startPeriod)?.start ?? null;
      let startMin = start;
      const courseNotes = [...course.notes];
      const endMin = table.get(course.endPeriod)?.end ?? null;
      if (startMin === null && endMin !== null && course.startPeriod === course.endPeriod)
        startMin = endMin - 45;
      if (startMin === null) {
        const firstEnd = table.get(course.startPeriod)?.end;
        if (firstEnd != null) {
          startMin = firstEnd - 45;
          courseNotes.push(`第 ${course.startPeriod} 节开始时间按 45 分钟一节推算`);
        }
      }
      if (startMin === null || endMin === null || endMin <= startMin) {
        notes.push(`${shot.name}：「${course.title}」的节次时间不全，已跳过`);
        continue;
      }
      const date = C.addDays(monday, course.weekday - 1);
      const location = course.location || "（未读到地点）";
      occurrences.push({
        date,
        start: startMin,
        end: endMin,
        title: course.title,
        location,
        uid: shot.name,
      });
      const key = [course.title, course.weekday, startMin, endMin, location].join("|");
      if (courseNotes.length) flagged.set(key, [...(flagged.get(key) ?? []), ...courseNotes]);
    }
  }
  const drafts = rulesFromOccurrences(occurrences, semester, "课表截图识别，需核对").map((d) => {
    const extra = flagged.get(d.key);
    return extra
      ? { ...d, rule: { ...d.rule, source: `${d.rule.source}；${[...new Set(extra)].join("；")}` } }
      : d;
  });
  return { drafts, weeks: [...weeks].sort((a, b) => a - b), notes };
}

/** Vision returns normalised boxes with a bottom-left origin; convert to pixels. */
export function fromVision(
  boxes: { text: string; x: number; y: number; w: number; h: number }[],
  width: number,
  height: number,
): OcrText[] {
  return boxes.map((b) => ({
    text: b.text,
    x: Math.round(b.x * width),
    y: Math.round((1 - b.y - b.h) * height),
    w: Math.round(b.w * width),
    h: Math.round(b.h * height),
  }));
}
