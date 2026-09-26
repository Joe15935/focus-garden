/**
 * Focus Garden Study Planner — portable reference core, MIT.
 * Pure local computation. No network, filesystem, timers, credentials or AI.
 * Clock values are wall-clock minutes in an explicitly selected local day.
 * A bounded search returning no plan is NOT an infeasibility proof.
 */
export type Place = "home" | "classroom" | "library" | "track" | "gym";
export type EvidenceStatus = "confirmed" | "provisional";
export interface Window {
  start: number;
  end: number;
}
export interface Segment {
  offset: number;
  minutes: number;
  title: string;
  kind:
    | "study"
    | "class"
    | "lab"
    | "life"
    | "run"
    | "warmup"
    | "shower"
    | "travel"
    | "buffer"
    | "gym";
  place: Place;
  to?: Place;
}
export interface Task {
  id: string;
  title: string;
  minutes: number;
  places: Place[];
  windows: Window[];
  category:
    | "law-video"
    | "law-review"
    | "law-practice"
    | "law-output"
    | "english"
    | "life"
    | "run"
    | "gym"
    | "other";
  segments?: Segment[];
  exitPlace?: Place;
  after?: string[];
  preferredStart?: number;
  source?: string;
  fixed?: boolean;
}
export interface Block {
  id: string;
  title: string;
  start: number;
  end: number;
  entry: Place;
  exit: Place;
  category: string;
  segments: Segment[];
  fixed: boolean;
}
export interface CalendarRule {
  id: string;
  title: string;
  weekday: number;
  start: string;
  end: string;
  from: string;
  until: string;
  location: Place;
  kind: "class" | "lab" | "other";
  weeks?: number[];
  excludeDates?: string[];
  evidence: EvidenceStatus;
  source: string;
}
export interface CalendarException {
  date: string;
  ruleId: string;
  action: "cancel" | "replace";
  start?: string;
  end?: string;
  location?: Place;
  reason: string;
}
export interface Semester {
  id: string;
  name: string;
  start: string;
  end: string;
  firstMonday: string;
  confirmedWeeks: number[];
  confirmedDates: string[];
  rules: CalendarRule[];
  exceptions: CalendarException[];
  notes?: string[];
  /** Official no-class ranges (e.g. 国庆). Classes are cancelled; the dates count as known. */
  holidays?: Holiday[];
  /** Make-up days: `date` runs the class schedule of `followsDate` (e.g. 周六补周三的课). */
  swaps?: ScheduleSwap[];
}
export interface Holiday {
  from: string;
  until: string;
  reason: string;
  source: string;
}
export interface ScheduleSwap {
  date: string;
  followsDate: string;
  reason: string;
}
export interface CalendarDay {
  date: string;
  known: boolean;
  week: number | null;
  blocks: Block[];
  warnings: string[];
}
export interface Policy {
  timezone: "Asia/Shanghai";
  wake: string;
  sleep: string;
  travelMinutes: number;
  restWeekdays: number[];
  lecturesPerStudyDay: number;
  lectureDurations: number[];
  lectureOverhead: number;
  lunchMinutes: number;
  breakfastMinutes: number;
  dinnerMinutes: number;
  reviewMinutes: number;
  practiceMinutes: number;
  oralMinutes: number;
  studyPlaces: Place[];
  englishTiers: number[];
  gymWeekdays: number[];
  gymMinutes: number;
  phase: "first-pass" | "three-block-review";
  remainingLectures: number;
  confirmedExceptions: Record<string, Partial<Policy>>;
  confirmedSaturdayRunDates: string[];
  /** Standing rule: when a day cannot hold the full plan, drop that day's new lectures (no debt). */
  dropLecturesWhenFull?: boolean;
  /** Opening hours per place, [start, end) in minutes. A missing place is open all day. */
  placeHours?: Partial<Record<Place, Window[]>>;
}
export interface SearchOptions {
  maxNodes?: number;
  maxCandidates?: number;
  step?: number;
  previous?: Block[];
  startPlace?: Place;
  endPlace?: Place;
  placeHours?: Partial<Record<Place, Window[]>>;
}
export interface SearchResult {
  status: "FEASIBLE" | "NO_PLAN_FOUND" | "SEARCH_LIMIT" | "INPUT_CONFLICT" | "CAPACITY_EXCEEDED";
  blocks: Block[];
  diagnostics: string[];
  nodes: number;
  objective: string;
}
export interface TimelineItem {
  id: string;
  start: number;
  end: number;
  title: string;
  kind: string;
  place: Place;
  to?: Place;
  taskId?: string;
}
export interface DayPlan {
  date: string;
  status: SearchResult["status"] | "NEEDS_CALENDAR" | "PHASE_CONFIRMATION" | "REST_NEEDS_WINDOW";
  englishMinutes: number;
  warnings: string[];
  diagnostics: string[];
  blocks: Block[];
  timeline: TimelineItem[];
  tasks: Task[];
  nodes: number;
  unallocatedMinutes: number;
  gymPlanned: boolean;
  /** True when the day could not hold the full plan and, by the user's rule, got no new lectures. */
  lecturesSkipped?: boolean;
  provisional: boolean;
}
export const TIMEZONE_DEFAULT = "Asia/Shanghai";
export const PLACES: Place[] = ["home", "classroom", "library", "track", "gym"];
export const PLACE_NAMES: Record<Place, string> = {
  home: "住所",
  classroom: "教学楼",
  library: "图书馆",
  track: "操场",
  gym: "健身房",
};
const DAY_MS = 86400000;
export function parseDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`日期格式错误：${s}`);
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s)
    throw new Error(`无效日期：${s}`);
  return d;
}
export function addDays(s: string, n: number): string {
  if (!Number.isInteger(n)) throw new Error("天数必须为整数");
  return new Date(parseDate(s).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return (parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS;
}
export function weekday(s: string): number {
  return ((parseDate(s).getUTCDay() + 6) % 7) + 1;
}
export function parseTime(s: string): number {
  if (!/^\d{2}:\d{2}$/.test(s)) throw new Error(`时间格式错误：${s}`);
  const [h, m] = s.split(":").map(Number);
  if (h > 23 || m > 59) throw new Error(`无效时间：${s}`);
  return h * 60 + m;
}
export function timeText(m: number): string {
  if (!Number.isInteger(m) || m < 0 || m > 1440) throw new Error("分钟超出一天范围");
  return `${Math.floor(m / 60)
    .toString()
    .padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}
export function localToday(now: Date = new Date(), timezone = "Asia/Shanghai"): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function travel(a: Place, b: Place, minutes: number): number {
  return a === b ? 0 : minutes;
}
function assertInteger(n: number, lo: number, hi: number, label: string): void {
  if (!Number.isInteger(n) || n < lo || n > hi)
    throw new Error(`${label}必须为${lo}—${hi}之间的整数`);
}
function assertPlace(p: string): asserts p is Place {
  if (!PLACES.includes(p as Place)) throw new Error(`未知地点：${p}`);
}
export function validatePolicy(p: Policy): string[] {
  const errors: string[] = [];
  try {
    if (p.timezone !== "Asia/Shanghai")
      throw new Error("本参考核只支持 Asia/Shanghai；不静默跟随系统时区");
    if (
      !p.confirmedExceptions ||
      typeof p.confirmedExceptions !== "object" ||
      Array.isArray(p.confirmedExceptions)
    )
      throw new Error("缺少当日例外表");
    if (!Array.isArray(p.confirmedSaturdayRunDates)) throw new Error("缺少周六跑步确认表");
    p.confirmedSaturdayRunDates.forEach(parseDate);
    for (const [place, windows] of Object.entries(p.placeHours ?? {})) {
      assertPlace(place);
      if (!Array.isArray(windows) || !windows.length) throw new Error("开放时段不能为空");
      for (const w of windows) {
        assertInteger(w.start, 0, 1440, "开放时间");
        assertInteger(w.end, 0, 1440, "关闭时间");
        if (w.end <= w.start) throw new Error(`${PLACE_NAMES[place]}的开放时段错误`);
      }
    }
    for (const key of Object.keys(p.confirmedExceptions)) parseDate(key);
    const start = parseTime(p.wake),
      end = parseTime(p.sleep);
    if (end <= start) throw new Error("本版本要求起床和就寝在同一当地日期，夜间睡眠跨日期保护");
    if (1440 - end + start < 480)
      throw new Error("此初始配置保护至少8小时夜间卧床窗口；不能自动压缩");
    assertInteger(p.travelMinutes, 0, 120, "通勤");
    assertInteger(p.lecturesPerStudyDay, 0, 12, "新课数");
    if (p.lectureDurations.length !== p.lecturesPerStudyDay)
      throw new Error("每节课都需要时长估计；不能把三节当固定150分钟");
    for (const n of p.lectureDurations) assertInteger(n, 1, 300, "单节时长");
    assertInteger(p.lectureOverhead, 0, 60, "每节暂停与整理预算");
    for (const [key, lo, hi] of [
      ["lunchMinutes", 30, 240],
      ["breakfastMinutes", 15, 90],
      ["dinnerMinutes", 20, 120],
      ["reviewMinutes", 5, 180],
      ["practiceMinutes", 5, 180],
      ["oralMinutes", 3, 60],
      ["gymMinutes", 0, 180],
    ] as const)
      assertInteger(p[key], lo, hi, key);
    assertInteger(p.remainingLectures, 0, 10000, "剩余课程");
    if (!["first-pass", "three-block-review"].includes(p.phase)) throw new Error("阶段未知");
    if (!p.studyPlaces.length) throw new Error("至少选择一个已经可用的学习地点");
    p.studyPlaces.forEach(assertPlace);
    if (p.studyPlaces.some((x) => !["home", "library"].includes(x)))
      throw new Error("学习地点只允许住所或图书馆；不把教学楼课间当可用自习场地");
    if (
      p.englishTiers.length === 0 ||
      p.englishTiers.some((x) => ![40, 85, 100, 125, 140].includes(x))
    )
      throw new Error("英语档位只支持40/85/100/125/140");
    if ([...p.restWeekdays, ...p.gymWeekdays].some((x) => !Number.isInteger(x) || x < 1 || x > 7))
      throw new Error("星期必须为1至7");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return errors;
}
export function validateSemester(s: Semester): string[] {
  const errors: string[] = [];
  try {
    parseDate(s.start);
    parseDate(s.end);
    parseDate(s.firstMonday);
    if (s.start > s.end || weekday(s.firstMonday) !== 1) throw new Error("学期日期或首周周一错误");
    const ids = new Set<string>();
    for (const r of s.rules) {
      if (!r.id || ids.has(r.id)) throw new Error("课程ID为空或重复");
      ids.add(r.id);
      parseDate(r.from);
      parseDate(r.until);
      assertPlace(r.location);
      if (r.from > r.until || parseTime(r.end) <= parseTime(r.start))
        throw new Error(`课程时间错误：${r.title}`);
      assertInteger(r.weekday, 1, 7, "课程星期");
      if (r.weeks?.some((w) => !Number.isInteger(w) || w < 1 || w > 60))
        throw new Error("教学周范围错误");
      r.excludeDates?.forEach(parseDate);
    }
    for (const e of s.exceptions) {
      parseDate(e.date);
      if (!ids.has(e.ruleId)) throw new Error("例外引用不存在的课程");
      if (e.action === "replace" && (!e.start || !e.end || parseTime(e.end) <= parseTime(e.start)))
        throw new Error("改课必须给出完整起止时间");
      if (e.location) assertPlace(e.location);
    }
    s.confirmedDates.forEach(parseDate);
    for (const h of s.holidays ?? []) {
      parseDate(h.from);
      parseDate(h.until);
      if (h.from > h.until || !h.reason.trim()) throw new Error("假期日期或说明错误");
    }
    const swapDates = new Set<string>();
    for (const x of s.swaps ?? []) {
      parseDate(x.date);
      parseDate(x.followsDate);
      if (swapDates.has(x.date) || x.date === x.followsDate)
        throw new Error("调课日重复或指向自身");
      swapDates.add(x.date);
    }
    if (s.confirmedWeeks.some((w) => !Number.isInteger(w) || w < 1 || w > 60))
      throw new Error("确认周次错误");
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return errors;
}
export function calendarForDate(
  semesters: Semester[],
  date: string,
  arrivalBuffer = 5,
): CalendarDay {
  parseDate(date);
  assertInteger(arrivalBuffer, 0, 30, "到课缓冲");
  const matches = semesters.filter((s) => s.start <= date && date <= s.end);
  if (matches.length !== 1)
    return {
      date,
      known: false,
      week: null,
      blocks: [],
      warnings: [
        matches.length
          ? "学期范围重叠，先选择唯一有效课表。"
          : "尚未导入或确认这个日期的课表；不能当作无课日。",
      ],
    };
  const s = matches[0];
  const errs = validateSemester(s);
  if (errs.length) return { date, known: false, week: null, blocks: [], warnings: errs };
  const week = Math.floor(daysBetween(s.firstMonday, date) / 7) + 1;
  const holiday = (s.holidays ?? []).find((h) => h.from <= date && date <= h.until);
  if (holiday)
    return { date, known: true, week, blocks: [], warnings: [`${holiday.reason}：不上课`] };
  const swap = (s.swaps ?? []).find((x) => x.date === date);
  // A make-up day runs another date's timetable; the class still happens on `date`.
  const source = swap?.followsDate ?? date;
  const sourceWeek = Math.floor(daysBetween(s.firstMonday, source) / 7) + 1;
  const known =
    s.confirmedWeeks.includes(week) ||
    s.confirmedDates.includes(date) ||
    (!!swap && (s.confirmedWeeks.includes(sourceWeek) || s.confirmedDates.includes(source)));
  const warnings: string[] = known
    ? []
    : ["本周没有完整确认的课表；显示已知课，但暂停自动排满剩余时间。"];
  if (swap) warnings.push(`${swap.reason}：按 ${source} 的课表上课`);
  const blocks: Block[] = [];
  for (const r of s.rules) {
    if (
      source < r.from ||
      source > r.until ||
      weekday(source) !== r.weekday ||
      (r.weeks && !r.weeks.includes(sourceWeek)) ||
      r.excludeDates?.includes(source)
    )
      continue;
    const ex = s.exceptions.filter((e) => e.date === date && e.ruleId === r.id);
    if (ex.length > 1) {
      warnings.push(`同一课程有多个例外：${r.title}`);
      return { date, known: false, week, blocks, warnings };
    }
    if (ex[0]?.action === "cancel") continue;
    const start = parseTime(ex[0]?.start ?? r.start),
      end = parseTime(ex[0]?.end ?? r.end),
      place = ex[0]?.location ?? r.location;
    blocks.push({
      id: `class:${r.id}:${date}`,
      title: r.title,
      start: start - arrivalBuffer,
      end,
      entry: place,
      exit: place,
      category: r.kind,
      fixed: true,
      segments: [
        { offset: 0, minutes: arrivalBuffer, title: "到课准备", kind: "buffer", place },
        {
          offset: arrivalBuffer,
          minutes: end - start,
          title: r.title,
          kind: r.kind === "lab" ? "lab" : "class",
          place,
        },
      ],
    });
    if (r.evidence === "provisional" && !s.confirmedDates.includes(date))
      warnings.push(`课程依据待核对：${r.title}`);
  }
  return { date, known, week, blocks: blocks.sort((a, b) => a.start - b.start), warnings };
}
export function blockForTask(t: Task, start: number, place: Place): Block {
  return {
    id: t.id,
    title: t.title,
    start,
    end: start + t.minutes,
    entry: place,
    exit: t.exitPlace ?? place,
    category: t.category,
    fixed: !!t.fixed,
    segments: t.segments ?? [
      {
        offset: 0,
        minutes: t.minutes,
        title: t.title,
        kind: t.category === "life" ? "life" : "study",
        place,
      },
    ],
  };
}
function sorted(bs: Block[]): Block[] {
  return [...bs].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
/** Why a planned (non-fixed) block uses a place outside its opening hours, or null. */
export function outsideHours(b: Block, hours?: Partial<Record<Place, Window[]>>): string | null {
  if (!hours || b.fixed) return null;
  for (const part of b.segments) {
    if (part.kind === "travel" || part.minutes === 0) continue;
    const open = hours[part.place];
    if (!open) continue;
    const s = b.start + part.offset;
    const e = s + part.minutes;
    if (!open.some((w) => s >= w.start && e <= w.end))
      return `${PLACE_NAMES[part.place]}在 ${timeText(s)}–${timeText(e)} 不开放`;
  }
  return null;
}
export function validateSchedule(
  blocks: Block[],
  day: Window,
  route: number,
  expected: Task[] = [],
  startPlace: Place = "home",
  endPlace: Place = "home",
  hours?: Partial<Record<Place, Window[]>>,
): string[] {
  const errors: string[] = [];
  if (day.end <= day.start || day.start < 0 || day.end > 1440) return ["日边界错误"];
  const rows = sorted(blocks);
  const ids = new Set<string>();
  let prevEnd = day.start,
    prevPlace = startPlace;
  for (const b of rows) {
    if (ids.has(b.id)) errors.push(`重复任务：${b.id}`);
    ids.add(b.id);
    if (b.start < prevEnd + travel(prevPlace, b.entry, route))
      errors.push(`重叠或通勤不足：${b.title}`);
    if (b.start < day.start || b.end > day.end || b.end <= b.start)
      errors.push(`越过可用日界：${b.title}`);
    let offset = 0,
      place = b.entry;
    for (const part of b.segments) {
      if (part.minutes < 0 || part.offset !== offset || part.place !== place)
        errors.push(`任务内部时间/地点错误：${b.title}`);
      if (part.kind === "travel") {
        if (!part.to || part.minutes !== travel(part.place, part.to, route))
          errors.push(`内部通勤错误：${b.title}`);
        if (part.to) place = part.to;
      }
      offset += part.minutes;
    }
    if (offset !== b.end - b.start || place !== b.exit)
      errors.push(`内部时长或出口地点不一致：${b.title}`);
    const closed = outsideHours(b, hours);
    if (closed) errors.push(`${b.title}：${closed}`);
    prevEnd = b.end;
    prevPlace = b.exit;
  }
  if (prevEnd + travel(prevPlace, endPlace, route) > day.end)
    errors.push("就寝前没有返回住所的时间");
  for (const t of expected) {
    const b = rows.find((x) => x.id === t.id);
    if (!b) {
      errors.push(`缺少必需任务：${t.title}`);
      continue;
    }
    if (
      b.end - b.start !== t.minutes ||
      !t.places.includes(b.entry) ||
      b.exit !== (t.exitPlace ?? b.entry)
    )
      errors.push(`任务被截短或地点被更改：${t.title}`);
    if (!t.windows.some((w) => b.start >= w.start && b.end <= w.end))
      errors.push(`任务超出许可时段：${t.title}`);
    for (const dep of t.after ?? []) {
      const d = rows.find((x) => x.id === dep);
      if (!d || d.end > b.start) errors.push(`任务顺序错误：${t.title}`);
    }
  }
  return errors;
}
function candidates(
  t: Task,
  bs: Block[],
  day: Window,
  route: number,
  step: number,
  prior?: Block,
  startPlace: Place = "home",
  endPlace: Place = "home",
  hours?: Partial<Record<Place, Window[]>>,
): Block[] {
  const rows = sorted(bs),
    out: Block[] = [];
  let earliestDep = day.start;
  for (const dep of t.after ?? []) {
    const b = rows.find((x) => x.id === dep);
    if (!b) return [];
    earliestDep = Math.max(earliestDep, b.end);
  }
  const sentinels: Block[] = [
    {
      id: "__start",
      title: "",
      start: day.start,
      end: day.start,
      entry: startPlace,
      exit: startPlace,
      category: "life",
      segments: [],
      fixed: true,
    },
    ...rows,
    {
      id: "__end",
      title: "",
      start: day.end,
      end: day.end,
      entry: endPlace,
      exit: endPlace,
      category: "life",
      segments: [],
      fixed: true,
    },
  ];
  const seen = new Set<string>();
  for (let i = 0; i < sentinels.length - 1; i++) {
    const prev = sentinels[i],
      next = sentinels[i + 1];
    for (const place of t.places)
      for (const w of t.windows) {
        const lo = Math.max(
          w.start,
          prev.end + travel(prev.exit, place, route),
          earliestDep,
          day.start,
        );
        const hi =
          Math.min(w.end, next.start - travel(t.exitPlace ?? place, next.entry, route), day.end) -
          t.minutes;
        if (hi < lo) continue;
        const starts = [lo, hi];
        if (prior && prior.start >= lo && prior.start <= hi) starts.unshift(prior.start);
        if (t.preferredStart !== undefined && t.preferredStart >= lo && t.preferredStart <= hi)
          starts.unshift(t.preferredStart);
        for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) starts.push(m);
        for (const start of starts) {
          const key = `${start}:${place}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const b = blockForTask(t, start, place);
          // Dependencies may already have a successor inserted. Do not move before it.
          if (rows.some((x) => x.id !== b.id && x.start < b.end && x.end > b.start)) continue;
          if (outsideHours(b, hours)) continue;
          out.push(b);
        }
      }
  }
  const pref = prior?.start ?? t.preferredStart ?? day.start;
  return out.sort((a, b) => {
    const ca =
      prior && a.start === prior.start && a.entry === prior.entry
        ? -100000
        : Math.abs(a.start - pref);
    const cb =
      prior && b.start === prior.start && b.entry === prior.entry
        ? -100000
        : Math.abs(b.start - pref);
    return ca - cb || t.places.indexOf(a.entry) - t.places.indexOf(b.entry) || a.start - b.start;
  });
}
/**
 * Travel minutes no schedule can avoid, given the fixed blocks. Between two
 * fixed blocks at the same place where no task can happen, you either wait
 * (time lost) or leave and come back (two trips); between different places at
 * least one trip. Travel that a task carries inside itself (e.g. running then
 * walking home) is never counted twice.
 */
export function unavoidableTravel(
  fixed: Block[],
  tasks: Task[],
  route: number,
  startPlace: Place,
  endPlace: Place,
): number {
  if (!fixed.length || route <= 0) return 0;
  const taskPlaces = new Set(tasks.flatMap((t) => t.places));
  const internalFrom = new Set(
    tasks.flatMap((t) => (t.segments ?? []).filter((s) => s.kind === "travel").map((s) => s.place)),
  );
  const rows = sorted(fixed);
  let total = 0;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first && first.entry !== startPlace && !internalFrom.has(startPlace)) total += route;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (!a || !b || internalFrom.has(a.exit)) continue;
    if (a.exit === b.entry) {
      if (!taskPlaces.has(a.exit)) total += Math.max(0, Math.min(b.start - a.end, 2 * route));
    } else total += route;
  }
  if (last && last.exit !== endPlace && !internalFrom.has(last.exit)) total += route;
  return total;
}
export function solve(
  tasks: Task[],
  fixed: Block[],
  day: Window,
  route: number,
  options: SearchOptions = {},
): SearchResult {
  const maxNodes = options.maxNodes ?? 2500,
    maxCandidates = options.maxCandidates ?? 80,
    step = options.step ?? 5;
  const objective = "找一份逐项验证通过的可行安排；有界启发式搜索，不宣称全局最优。";
  const initialErrors = validateSchedule(
    fixed,
    day,
    route,
    [],
    options.startPlace,
    options.endPlace,
  );
  if (initialErrors.length)
    return {
      status: "INPUT_CONFLICT",
      blocks: fixed,
      diagnostics: initialErrors,
      nodes: 0,
      objective,
    };
  if (!Number.isInteger(step) || step < 1 || maxNodes < 1 || maxCandidates < 1)
    return {
      status: "INPUT_CONFLICT",
      blocks: fixed,
      diagnostics: ["搜索参数错误"],
      nodes: 0,
      objective,
    };
  const unique = new Set(fixed.map((b) => b.id));
  for (const t of tasks) {
    if (
      unique.has(t.id) ||
      !Number.isInteger(t.minutes) ||
      t.minutes <= 0 ||
      !t.places.length ||
      !t.windows.length
    )
      return {
        status: "INPUT_CONFLICT",
        blocks: fixed,
        diagnostics: ["任务ID、分钟、地点或时间窗无效"],
        nodes: 0,
        objective,
      };
    unique.add(t.id);
    if (
      t.places.some((x) => !PLACES.includes(x)) ||
      t.windows.some(
        (w) => !Number.isInteger(w.start) || !Number.isInteger(w.end) || w.end <= w.start,
      )
    )
      return {
        status: "INPUT_CONFLICT",
        blocks: fixed,
        diagnostics: ["任务地点或时间窗错误"],
        nodes: 0,
        objective,
      };
  }
  if (tasks.some((t) => (t.after ?? []).some((id) => !unique.has(id))))
    return {
      status: "INPUT_CONFLICT",
      blocks: fixed,
      diagnostics: ["任务引用不存在的先行任务"],
      nodes: 0,
      objective,
    };
  // Lower bound: workload plus only the travel that fixed commitments make unavoidable.
  // It never overstates a deficit, so exceeding it is a real proof, not a heuristic.
  const occupied =
    fixed.reduce((n, b) => n + b.end - b.start, 0) + tasks.reduce((n, t) => n + t.minutes, 0);
  const forcedTravel = unavoidableTravel(
    fixed,
    tasks,
    route,
    options.startPlace ?? "home",
    options.endPlace ?? "home",
  );
  const capacity = day.end - day.start;
  if (occupied + forcedTravel > capacity)
    return {
      status: "CAPACITY_EXCEEDED",
      blocks: fixed,
      diagnostics: [
        forcedTravel
          ? `只算必需任务、固定课程和躲不开的 ${forcedTravel} 分钟往返，就已超出 ${occupied + forcedTravel - capacity} 分钟；这是下界，实际缺口可能更大。`
          : `即使暂不计新增往返，仍超出${occupied - capacity}分钟；这是下界，不是完整所需调整量。`,
      ],
      nodes: 0,
      objective,
    };
  let nodes = 0,
    limited = false,
    truncated = false;
  const memo = new Set<string>();
  function dfs(todo: Task[], bs: Block[]): Block[] | null {
    if (nodes++ >= maxNodes) {
      limited = true;
      return null;
    }
    if (todo.length === 0)
      return validateSchedule(
        bs,
        day,
        route,
        tasks,
        options.startPlace,
        options.endPlace,
        options.placeHours,
      ).length === 0
        ? sorted(bs)
        : null;
    const key =
      todo
        .map((t) => t.id)
        .sort()
        .join(",") +
      "|" +
      sorted(bs)
        .map((b) => `${b.id}@${b.start}:${b.entry}`)
        .join(";");
    if (memo.has(key)) return null;
    memo.add(key);
    let chosen: Task | undefined;
    let opts: Block[] = [];
    for (const t of todo) {
      if ((t.after ?? []).some((id) => !bs.some((b) => b.id === id))) continue;
      const cs = candidates(
        t,
        bs,
        day,
        route,
        step,
        options.previous?.find((b) => b.id === t.id),
        options.startPlace,
        options.endPlace,
        options.placeHours,
      );
      if (!cs.length) return null;
      if (
        !chosen ||
        cs.length < opts.length ||
        (cs.length === opts.length && t.minutes > chosen.minutes)
      ) {
        chosen = t;
        opts = cs;
      }
    }
    if (!chosen) return null; // cyclic/missing dependencies: correctly not a successful plan
    if (opts.length > maxCandidates) truncated = true;
    for (const b of opts.slice(0, maxCandidates)) {
      const result = dfs(
        todo.filter((t) => t.id !== chosen?.id),
        [...bs, b],
      );
      if (result) return result;
      if (limited) return null;
    }
    return null;
  }
  const answer = dfs(tasks, fixed);
  if (answer) return { status: "FEASIBLE", blocks: answer, diagnostics: [], nodes, objective };
  return {
    status: limited || truncated ? "SEARCH_LIMIT" : "NO_PLAN_FOUND",
    blocks: fixed,
    diagnostics: [
      limited || truncated
        ? "搜索预算内未找到方案；不能据此断言数学上不可能。"
        : "当前候选时间窗内未找到方案；检查任务连续时长、通勤和固定事项。",
      "没有删掉新课、占用本科课堂、缩短午休或改动睡眠。修改规则需要明确确认。",
    ],
    nodes,
    objective,
  };
}
export function timelineFor(
  blocks: Block[],
  day: Window,
  route: number,
  startPlace: Place = "home",
): TimelineItem[] {
  const out: TimelineItem[] = [];
  let end = day.start,
    place: Place = startPlace;
  for (const b of sorted(blocks)) {
    const distance = travel(place, b.entry, route);
    if (distance)
      out.push({
        id: `travel:${b.id}`,
        start: b.start - distance,
        end: b.start,
        title: `${PLACE_NAMES[place]} → ${PLACE_NAMES[b.entry]}`,
        kind: "travel",
        place,
        to: b.entry,
      });
    for (const [i, s] of b.segments.entries())
      if (s.minutes)
        out.push({
          id: `${b.id}:${i}`,
          start: b.start + s.offset,
          end: b.start + s.offset + s.minutes,
          title: s.title,
          kind: s.kind,
          place: s.place,
          to: s.to,
          taskId: b.id,
        });
    end = b.end;
    place = b.exit;
  }
  if (place !== "home")
    out.push({
      id: "return-home",
      start: end,
      end: end + route,
      title: `${PLACE_NAMES[place]} → 住所`,
      kind: "travel",
      place,
      to: "home",
    });
  return out;
}
export function effectivePolicy(base: Policy, date: string): Policy {
  parseDate(date);
  const override = base.confirmedExceptions[date];
  return { ...base, ...(override ?? {}), confirmedExceptions: base.confirmedExceptions };
}
function task(
  id: string,
  title: string,
  minutes: number,
  places: Place[],
  windows: Window[],
  category: Task["category"],
  preferredStart?: number,
): Task {
  return { id, title, minutes, places, windows, category, preferredStart };
}
export function dailyTasks(p: Policy, date: string, english: number, includeGym = false): Task[] {
  const wake = parseTime(p.wake),
    sleep = parseTime(p.sleep),
    windows = [{ start: wake, end: sleep }];
  const rest = p.restWeekdays.includes(weekday(date));
  const result: Task[] = [
    task(
      "breakfast",
      "早餐、洗漱",
      p.breakfastMinutes,
      ["home"],
      [{ start: wake, end: wake + p.breakfastMinutes }],
      "life",
      wake,
    ),
    task(
      "lunch",
      "吃饭、午休（受保护）",
      p.lunchMinutes,
      ["home"],
      [{ start: 660, end: 990 }],
      "life",
      720,
    ),
    task("dinner", "晚饭", p.dinnerMinutes, ["home"], [{ start: 1005, end: 1150 }], "life", 1050),
    {
      id: "run",
      title: "跑步及返回洗澡",
      minutes: 45 + p.travelMinutes,
      places: ["track"],
      exitPlace: "home",
      windows: [{ start: 1065, end: Math.min(sleep, 1350) }],
      category: "run",
      preferredStart: 1200,
      segments: [
        { offset: 0, minutes: 5, title: "热身", kind: "warmup", place: "track" },
        { offset: 5, minutes: 20, title: "操场跑步20分钟", kind: "run", place: "track" },
        { offset: 25, minutes: 5, title: "缓和", kind: "warmup", place: "track" },
        {
          offset: 30,
          minutes: p.travelMinutes,
          title: "操场 → 住所",
          kind: "travel",
          place: "track",
          to: "home",
        },
        {
          offset: 30 + p.travelMinutes,
          minutes: 15,
          title: "洗澡、更衣",
          kind: "shower",
          place: "home",
        },
      ],
    },
  ];
  if (!rest) {
    result.push(
      task(
        "law-review",
        "旧知识闭卷复习",
        p.reviewMinutes,
        p.studyPlaces,
        windows,
        "law-review",
        480,
      ),
    );
    for (let i = 0; i < p.lecturesPerStudyDay; i++) {
      const t = task(
        `law-${i + 1}`,
        p.phase === "first-pass"
          ? `法硕第${i + 1}节（课名需绑定）`
          : `法律训练块${i + 1}（不是视频）`,
        p.lectureDurations[i] + p.lectureOverhead,
        p.studyPlaces,
        windows,
        p.phase === "first-pass" ? "law-video" : "law-practice",
        500 + i * 65,
      );
      // In the initial pass, preserve lecture sequence. The IDs are daily slots, not mastery IDs.
      if (i) t.after = [`law-${i}`];
      result.push(t);
    }
    result.push({
      ...task(
        "law-practice",
        "对应题目、订正",
        p.practiceMinutes,
        p.studyPlaces,
        windows,
        "law-practice",
        680,
      ),
      after: p.lecturesPerStudyDay ? ["law-1"] : [],
    });
    result.push({
      ...task(
        "law-output",
        "闭卷讲解、核术语",
        p.oralMinutes,
        ["home"],
        [
          { start: 720, end: 1080 },
          { start: 1260, end: sleep },
        ],
        "law-output",
        750,
      ),
      after: p.lecturesPerStudyDay ? ["law-1"] : [],
    });
    const parts: Record<number, number[]> = {
      40: [20, 10, 0, 10],
      85: [25, 20, 30, 10],
      100: [30, 25, 30, 15],
      125: [45, 30, 35, 15],
      140: [50, 35, 40, 15],
    };
    const labels =
      english === 40
        ? ["英语：旧词复习", "英语：旧听力复听", "英语阅读", "英语：错句精读＋闭卷回译"]
        : ["英语：单词（复习优先）", "英语：听力＋纠错", "英语：阅读＋依据分析", "英语：书面输出"];
    const durations = parts[english];
    if (!durations) throw new Error("未知英语档位");
    durations.forEach((d, i) => {
      if (d)
        result.push(
          task(`english-${i}`, labels[i], d, p.studyPlaces, windows, "english", 930 + i * 40),
        );
    });
    if (includeGym && p.gymMinutes > 0)
      result.push({
        id: "gym",
        title: "健身及返回更衣",
        minutes: p.gymMinutes + p.travelMinutes + 15,
        places: ["gym"],
        exitPlace: "home",
        windows: [{ start: 900, end: 1150 }],
        category: "gym",
        preferredStart: 990,
        segments: [
          { offset: 0, minutes: p.gymMinutes, title: "健身训练", kind: "gym", place: "gym" },
          {
            offset: p.gymMinutes,
            minutes: p.travelMinutes,
            title: "健身房 → 住所",
            kind: "travel",
            place: "gym",
            to: "home",
          },
          {
            offset: p.gymMinutes + p.travelMinutes,
            minutes: 15,
            title: "洗澡、更衣",
            kind: "shower",
            place: "home",
          },
        ],
      });
  }
  return result;
}
export function planDay(
  base: Policy,
  semesters: Semester[],
  date: string,
  searchOptions: SearchOptions = {},
): DayPlan {
  const options: SearchOptions = {
    ...searchOptions,
    placeHours: searchOptions.placeHours ?? effectivePolicy(base, date).placeHours,
  };
  const p = effectivePolicy(base, date),
    errors = validatePolicy(p),
    calendar = calendarForDate(semesters, date);
  const day = {
    start: errors.length ? 420 : parseTime(p.wake),
    end: errors.length ? 1380 : parseTime(p.sleep),
  };
  const result: DayPlan = {
    date,
    status: "NO_PLAN_FOUND",
    englishMinutes: 0,
    warnings: [...calendar.warnings],
    diagnostics: [],
    blocks: calendar.blocks,
    timeline: [],
    tasks: [],
    nodes: 0,
    unallocatedMinutes: 0,
    gymPlanned: false,
    provisional: calendar.warnings.length > 0,
  };
  if (errors.length) return { ...result, status: "INPUT_CONFLICT", diagnostics: errors };
  if (!calendar.known)
    return {
      ...result,
      status: "NEEDS_CALENDAR",
      diagnostics: ["导入本学期课表或明确确认这个日期；新学期未知不等于放假。"],
    };
  const rest = p.restWeekdays.includes(weekday(date));
  if (rest && !p.confirmedSaturdayRunDates.includes(date))
    return {
      ...result,
      status: "REST_NEEDS_WINDOW",
      diagnostics: [
        "今天不安排备考。周六固定事务的具体时段未提供，请确认实际可用于跑步的窗口；不能假定晚上必然有空。",
      ],
    };
  if (!rest && p.phase === "first-pass" && p.remainingLectures < p.lecturesPerStudyDay)
    return {
      ...result,
      status: "PHASE_CONFIRMATION",
      diagnostics: [
        `当前登记剩余${p.remainingLectures}节，不制造课程凑数。完成剩余内容后确认下一阶段；不会自动安排从头重听。`,
      ],
    };
  const tiers = rest ? [0] : [...new Set(p.englishTiers)].sort((a, b) => b - a);
  const attempt = (pp: Policy): { plan: DayPlan | null; latest: SearchResult | undefined } => {
    let latest: SearchResult | undefined;
    const warnings = [...result.warnings];
    for (const tier of tiers) {
      const tasks = dailyTasks(pp, date, tier, false);
      const r = solve(tasks, calendar.blocks, day, pp.travelMinutes, options);
      result.nodes += r.nodes;
      latest = r;
      if (r.status === "INPUT_CONFLICT") break;
      if (r.status !== "FEASIBLE") continue;
      let chosen = r,
        finalTasks = tasks,
        gymPlanned = false;
      if (!rest && pp.gymWeekdays.includes(weekday(date))) {
        const gt = dailyTasks(pp, date, tier, true);
        const g = solve(gt, calendar.blocks, day, pp.travelMinutes, {
          ...options,
          previous: r.blocks,
        });
        result.nodes += g.nodes;
        if (g.status === "FEASIBLE") {
          chosen = g;
          finalTasks = gt;
          gymPlanned = true;
        } else warnings.push("本次未加入健身房；不为健身降低已经找到的英语档位。");
      }
      const timeline = timelineFor(chosen.blocks, day, pp.travelMinutes);
      const unallocatedMinutes =
        day.end - day.start - timeline.reduce((n, x) => n + x.end - x.start, 0);
      if (unallocatedMinutes < 30)
        warnings.push("紧凑安排：未分配余量不足30分钟。超时需重新排程，不能自动晚睡。");
      if (tier > 0 && tier < Math.max(...pp.englishTiers))
        warnings.push(`本日找到英语${tier}分钟版本，不计标准英语日；未覆盖题型要在周复盘中保留。`);
      return {
        plan: {
          ...result,
          warnings,
          status: "FEASIBLE",
          englishMinutes: tier,
          blocks: chosen.blocks,
          timeline,
          tasks: finalTasks,
          unallocatedMinutes,
          gymPlanned,
        },
        latest,
      };
    }
    return { plan: null, latest };
  };
  const full = attempt(p);
  if (full.plan) return full.plan;
  // The user's standing rule: on a day that cannot hold the full plan, schedule no new
  // lectures at all. Nothing is carried over as debt; the next lectures simply wait.
  if (
    !rest &&
    p.dropLecturesWhenFull &&
    p.lecturesPerStudyDay > 0 &&
    full.latest?.status !== "INPUT_CONFLICT"
  ) {
    const lighter = attempt({ ...p, lecturesPerStudyDay: 0, lectureDurations: [] });
    if (lighter.plan)
      return {
        ...lighter.plan,
        lecturesSkipped: true,
        warnings: [
          `这天放不下完整安排（${STATUS_REASON[full.latest?.status ?? "NO_PLAN_FOUND"]}），按你的规则今天不排新课；不会补到其他日子。`,
          ...lighter.plan.warnings,
        ],
      };
  }
  const latest = full.latest;
  return {
    ...result,
    status: latest?.status ?? "NO_PLAN_FOUND",
    diagnostics: latest?.diagnostics ?? ["未找到安排"],
    tasks: dailyTasks(p, date, rest ? 0 : Math.min(...p.englishTiers), false),
  };
}
const STATUS_REASON: Record<SearchResult["status"], string> = {
  FEASIBLE: "可行",
  NO_PLAN_FOUND: "没有找到可行排法",
  SEARCH_LIMIT: "搜索预算内没有找到排法",
  INPUT_CONFLICT: "输入冲突",
  CAPACITY_EXCEEDED: "必需时长加必要往返已超过全天",
};
/** Generic replan: preserve completed/running/pinned blocks, never fabricate completion.
 * nowBlock must describe where the user actually is. Callers explicitly split partial work.
 * The remainder's IDs/durations are passed in, rather than silently reducing the daily quota.
 */
export function replanRemainder(
  tasks: Task[],
  futureFixed: Block[],
  now: number,
  currentPlace: Place,
  sleep: number,
  route: number,
  options: SearchOptions = {},
): SearchResult {
  assertInteger(now, 0, 1439, "当前分钟");
  assertPlace(currentPlace);
  if (futureFixed.some((b) => b.start < now && b.end > now))
    return {
      status: "INPUT_CONFLICT",
      blocks: futureFixed,
      diagnostics: [
        "当前有进行中的固定事项。先保留它到结束，再以实际结束地点重排；不能裁掉本科课或正在进行的任务。",
      ],
      nodes: 0,
      objective: "不改写进行中事项",
    };
  const bounded = tasks.map((t) => ({
    ...t,
    windows: t.windows
      .map((w) => ({ start: Math.max(w.start, now), end: Math.min(w.end, sleep) }))
      .filter((w) => w.end > w.start),
  }));
  if (bounded.some((t) => t.windows.length === 0))
    return {
      status: "NO_PLAN_FOUND",
      blocks: futureFixed,
      diagnostics: ["有必需任务的许可时间窗已经结束；未将其假记为完成。"],
      nodes: 0,
      objective: "仅安排未来，历史不改写",
    };
  const r = solve(
    bounded,
    futureFixed.filter((b) => b.start >= now),
    { start: now, end: sleep },
    route,
    { ...options, startPlace: currentPlace, endPlace: "home" },
  );
  return { ...r, objective: "只重排未来部分；调用者原样保留历史、进行中任务和人工锁定事项" };
}

export interface ReviewCard {
  id: string;
  prompt: string;
  source: string;
  stage: number;
  dueDate: string;
  history: ReviewLog[];
}
export interface ReviewLog {
  eventId: string;
  date: string;
  result: "forgot" | "hard" | "good" | "easy";
  closedBook: boolean;
  afterFeedback: boolean;
  sourceChecked: boolean;
}
const LADDER = [1, 3, 7, 14, 30, 60, 90];
export function recordReview(
  card: ReviewCard,
  log: ReviewLog,
  restWeekdays: number[] = [6],
): ReviewCard {
  parseDate(log.date);
  if (!log.eventId || !["forgot", "hard", "good", "easy"].includes(log.result))
    throw new Error("复测结果无效");
  if (card.history.some((h) => h.eventId === log.eventId)) return card;
  if (card.history.length && log.date < card.history[card.history.length - 1].date)
    throw new Error("历史复测必须按实际时间追加，不能悄悄回填");
  const history = [...card.history, log];
  if (!log.closedBook || log.afterFeedback || !log.sourceChecked) return { ...card, history }; // learning feedback ≠ delayed proof
  let stage =
    log.result === "forgot"
      ? 0
      : log.result === "hard"
        ? Math.max(0, card.stage - 1)
        : Math.min(LADDER.length - 1, card.stage + (log.result === "easy" ? 2 : 1));
  // Same-day repeated successes must not inflate interval.
  if (
    card.history.some(
      (h) => h.date === log.date && h.closedBook && !h.afterFeedback && h.sourceChecked,
    )
  )
    stage = Math.min(stage, card.stage);
  const dueDate = addDays(log.date, LADDER[stage]);
  // Store the actual due date. Rest-day deferral is a scheduling projection, not rewritten history.
  void restWeekdays;
  return { ...card, stage, dueDate, history };
}
export function nextReviewStudyDate(due: string, restWeekdays: number[] = [6]): string {
  if (restWeekdays.length >= 7) throw new Error("全部设成休息日，无法安排复测");
  let d = due;
  for (let i = 0; i < 7; i++) {
    if (!restWeekdays.includes(weekday(d))) return d;
    d = addDays(d, 1);
  }
  throw new Error("复测日期无解");
}
export function reviewQueue(cards: ReviewCard[], date: string, limit = 5): ReviewCard[] {
  parseDate(date);
  assertInteger(limit, 0, 100, "复测条数");
  return cards
    .filter((c) => c.dueDate <= date)
    .sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.stage - b.stage || a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
export function estimateMinutes(
  samples: number[],
  initial: number,
): { minutes: number; sampleCount: number; basis: string } {
  const xs = samples
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 600)
    .slice(-10)
    .sort((a, b) => a - b);
  if (xs.length < 3)
    return { minutes: initial, sampleCount: xs.length, basis: "样本不足，使用明确标记的初始估计" };
  const q = xs[Math.floor((xs.length - 1) * 0.75)];
  return {
    minutes: Math.ceil(q / 5) * 5,
    sampleCount: xs.length,
    basis: "最近最多10次实际用时的75%分位，向上取整至5分钟；规划启发式，不是能力测量",
  };
}
export interface CompletionEvent {
  id: string;
  date: string;
  taskId: string;
  kind: "watched" | "closed-recall" | "exercise" | "retest" | "partial";
  minutes: number;
  source: string;
  selfReported: boolean;
}
export function appendCompletion(events: CompletionEvent[], e: CompletionEvent): CompletionEvent[] {
  parseDate(e.date);
  assertInteger(e.minutes, 0, 600, "实际分钟");
  if (!e.id || !e.taskId) throw new Error("完成事件必须有唯一ID和任务ID");
  if (events.some((x) => x.id === e.id)) return events;
  return [...events, e];
}
export function learningSummary(events: CompletionEvent[]): {
  watched: number;
  retrieved: number;
  exercised: number;
  retested: number;
  minutes: number;
} {
  const uniq = (kind: CompletionEvent["kind"]) =>
    new Set(events.filter((e) => e.kind === kind).map((e) => e.taskId)).size;
  return {
    watched: uniq("watched"),
    retrieved: uniq("closed-recall"),
    exercised: uniq("exercise"),
    retested: uniq("retest"),
    minutes: events.reduce((n, e) => n + e.minutes, 0),
  };
}
export interface ExportData {
  schemaVersion: 1;
  exportedAt: string;
  policy: Policy;
  semesters: Semester[];
  reviews: ReviewCard[];
  events: CompletionEvent[];
  notes: string[];
}
export function encodeExport(data: ExportData): string {
  validateImport(data);
  return JSON.stringify(data, null, 2);
}
function badKeys(x: unknown): void {
  if (x === null || typeof x !== "object") return;
  for (const k of Object.keys(x)) {
    if (["__proto__", "prototype", "constructor"].includes(k)) throw new Error("导入含不安全字段");
    badKeys((x as Record<string, unknown>)[k]);
  }
}
export function validateImport(raw: unknown): asserts raw is ExportData {
  badKeys(raw);
  if (!raw || typeof raw !== "object") throw new Error("备份不是对象");
  const d = raw as ExportData;
  if (typeof d.exportedAt !== "string" || !Number.isFinite(Date.parse(d.exportedAt)))
    throw new Error("备份导出时间错误");
  if (d.schemaVersion !== 1) throw new Error("不支持的备份版本；停止导入，保留原数据");
  if (
    !d.policy ||
    !Array.isArray(d.semesters) ||
    !Array.isArray(d.reviews) ||
    !Array.isArray(d.events) ||
    !Array.isArray(d.notes)
  )
    throw new Error("备份缺少必要字段");
  const pe = validatePolicy(d.policy);
  if (pe.length) throw new Error(pe.join("；"));
  d.semesters.forEach((s) => {
    const e = validateSemester(s);
    if (e.length) throw new Error(e.join("；"));
  });
  const ids = new Set<string>();
  for (const e of d.events) {
    if (!e.id || ids.has(e.id)) throw new Error("完成事件ID重复");
    ids.add(e.id);
    parseDate(e.date);
    assertInteger(e.minutes, 0, 600, "完成分钟");
    if (
      !e.taskId ||
      !["watched", "closed-recall", "exercise", "retest", "partial"].includes(e.kind) ||
      typeof e.selfReported !== "boolean" ||
      typeof e.source !== "string"
    )
      throw new Error("完成事件字段错误");
  }
  const cids = new Set<string>();
  for (const c of d.reviews) {
    if (!c.id || cids.has(c.id) || !c.prompt || !c.source || !Array.isArray(c.history))
      throw new Error("复习卡字段错误");
    cids.add(c.id);
    parseDate(c.dueDate);
    assertInteger(c.stage, 0, LADDER.length - 1, "复习阶段");
    for (const h of c.history) {
      parseDate(h.date);
      if (
        !h.eventId ||
        !["forgot", "hard", "good", "easy"].includes(h.result) ||
        [h.closedBook, h.afterFeedback, h.sourceChecked].some((v) => typeof v !== "boolean")
      )
        throw new Error("复测历史字段错误");
    }
  }
}
export function decodeExport(text: string): ExportData {
  if (text.length > 5_000_000) throw new Error("备份超过5MB参考版上限，请使用正式SQLite迁移工具");
  const raw: unknown = JSON.parse(text);
  validateImport(raw);
  return raw;
}
/** Export uses explicit UTC instants derived from the fixed Asia/Shanghai day (+08:00).
 * Import of arbitrary ICS/RRULE is intentionally not implemented; use a mature parser in integration.
 */
export function exportIcs(date: string, items: TimelineItem[]): string {
  parseDate(date);
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  const stamp = (m: number) =>
    `${new Date(parseDate(date).getTime() + (m - 480) * 60000)
      .toISOString()
      .replace(/[-:]/g, "")
      .slice(0, 15)}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Focus Garden//Study Planner Reference//ZH",
    "CALSCALE:GREGORIAN",
  ];
  for (const x of items)
    lines.push(
      "BEGIN:VEVENT",
      `UID:${date}-${encodeURIComponent(x.id)}@focus-garden.local`,
      `DTSTAMP:${stamp(0)}`,
      `DTSTART:${stamp(x.start)}`,
      `DTEND:${stamp(x.end)}`,
      `SUMMARY:${esc(x.title)}`,
      `LOCATION:${esc(PLACE_NAMES[x.place])}`,
      "END:VEVENT",
    );
  lines.push("END:VCALENDAR");
  // RFC5545 folding limit is octets, not JavaScript string length.
  const enc = new TextEncoder();
  return `${lines
    .flatMap((line) => {
      const a: string[] = [];
      let chunk = "";
      for (const ch of line) {
        if (enc.encode(chunk + ch).length > 73) {
          a.push(chunk);
          chunk = ` ${ch}`;
        } else chunk += ch;
      }
      a.push(chunk);
      return a;
    })
    .join("\r\n")}\r\n`;
}
export function parseCsv(text: string): string[][] {
  if (text.length > 1_000_000) throw new Error("CSV超过1MB上限");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV引号未闭合");
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export function calendarRulesFromCsv(text: string, idPrefix = "import"): CalendarRule[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV缺少数据");
  const header = (rows.shift() ?? []).map((x) => x.trim());
  const required = ["title", "weekday", "start", "end", "from", "until", "location", "kind"];
  if (required.some((x) => !header.includes(x)) || new Set(header).size !== header.length)
    throw new Error("CSV表头缺少必需列或有重复");
  return rows.map((row, i) => {
    if (row.length !== header.length) throw new Error(`第${i + 2}行列数不一致`);
    const get = (key: string) => row[header.indexOf(key)]?.trim() ?? "";
    const location = get("location");
    assertPlace(location);
    const kind = get("kind");
    if (!["class", "lab", "other"].includes(kind)) throw new Error(`第${i + 2}行课程类型错误`);
    const wd = Number(get("weekday"));
    assertInteger(wd, 1, 7, "星期");
    const from = get("from"),
      until = get("until");
    parseDate(from);
    parseDate(until);
    if (from > until || parseTime(get("end")) <= parseTime(get("start")))
      throw new Error(`第${i + 2}行日期或钟点错误`);
    if (!get("title")) throw new Error("课程名称不能为空");
    return {
      id: `${idPrefix}-${i + 1}`,
      title: get("title"),
      weekday: wd,
      start: get("start"),
      end: get("end"),
      from,
      until,
      location,
      kind: kind as CalendarRule["kind"],
      evidence: "provisional",
      source: "用户CSV导入，核对后确认适用周",
    };
  });
}
export function remainingTasks(
  tasks: Task[],
  completedIds: string[],
  partialMinutes: Record<string, number> = {},
): Task[] {
  const known = new Set(tasks.map((t) => t.id));
  if (
    completedIds.some((id) => !known.has(id)) ||
    Object.keys(partialMinutes).some((id) => !known.has(id))
  )
    throw new Error("完成/部分完成引用未知任务");
  const completed = new Set(completedIds);
  return tasks
    .filter((t) => !completed.has(t.id))
    .map((t) => {
      const used = partialMinutes[t.id] ?? 0;
      assertInteger(used, 0, t.minutes, "部分完成分钟");
      if (used === t.minutes)
        throw new Error("部分时长已达全部；需要用户明确标记完成，不能自动完成");
      if (used > 0 && t.segments)
        throw new Error("跑步/生活复合任务不能只减总分钟，需分段核对实际位置");
      return {
        ...t,
        minutes: t.minutes - used,
        after: (t.after ?? []).filter((id) => !completed.has(id)),
      };
    });
}
