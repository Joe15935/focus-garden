/**
 * MIT. Study navigator data model: what is stored natively and the pure
 * derivations the screens need. Facts (events) and settings (doc) stay apart:
 * nothing here turns a plan, a timer or an import into a completion.
 */
import * as C from "./core";

export interface Goal {
  school: string;
  program: string;
  admissionCycle: number | null;
  initialExamYear: number | null;
  /** Only an officially published date. Null means no countdown is shown. */
  examDate: string | null;
  status: "needs-confirmation" | "confirmed";
  source: string;
  checkedAt: string | null;
}
export interface CatalogItem {
  id: string;
  subject: string;
  title: string;
  /** Actual running time when known; otherwise the policy estimate is used. */
  minutes: number | null;
  location: string;
}
export interface Progress {
  /** Remaining lectures as last reported by the user on `baselineDate`. */
  lectureBaseline: number;
  baselineDate: string;
  baselineStatus: "needs-refresh" | "confirmed";
}
export interface EnglishRotation {
  listening: string[];
  reading: string[];
  output: string[];
}
export interface PhaseChange {
  phase: C.Policy["phase"];
  confirmedAt: string;
  note: string;
}
export interface StudyDoc {
  version: 1;
  policy: C.Policy;
  semesters: C.Semester[];
  goal: Goal | null;
  catalog: CatalogItem[];
  progress: Progress;
  englishRotation: EnglishRotation;
  phaseHistory: PhaseChange[];
  notes: string[];
}
export type EventKind =
  | "watched"
  | "closed-recall"
  | "exercise"
  | "retest"
  | "partial"
  | "english"
  | "output";
export interface StudyEvent {
  id: string;
  date: string;
  task_key: string;
  kind: EventKind;
  minutes: number;
  source: string;
  self_reported: boolean;
  session_id?: string | null;
  corrects?: string | null;
  recorded_at?: string | null;
}
export interface SessionLink {
  session_id: string;
  occurrence_id: string;
  date: string;
  task_key: string;
  title: string;
  minutes: number;
  created_at: string;
}
export interface PlanRevision {
  id?: number;
  date: string;
  input_revision: number;
  status: string;
  reason: string;
  data: AcceptedPlan | { reset: true };
  created_at?: string;
}
export interface AcceptedPlan {
  blocks: C.Block[];
  timeline: C.TimelineItem[];
  now: number;
  place: C.Place;
  dropped: string[];
  /** Fingerprint of the plan-relevant settings it was made from. */
  inputKey?: string;
}
export interface BackupInfo {
  file_name: string;
  kind: string;
  bytes: number;
  modified: string;
}
export interface StudySnapshot {
  schema_version: number;
  revision: number;
  doc: StudyDoc | null;
  updated_at: string | null;
  events: StudyEvent[];
  reviews: C.ReviewCard[];
  links: SessionLink[];
  plans: PlanRevision[];
  data_path: string;
  backup_dir: string;
  backups: BackupInfo[];
  /** Folder the phone copy is written to; device-local, never in backups. */
  mirror_dir?: string | null;
}
export interface NativeBackup {
  format: "focus-garden-study-backup";
  version: 1;
  exported_at: string;
  doc: StudyDoc | null;
  events: StudyEvent[];
  reviews: C.ReviewCard[];
  links: SessionLink[];
  plans: PlanRevision[];
}

export const TIMEZONE = "Asia/Shanghai";
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  watched: "听完",
  "closed-recall": "闭卷提取",
  exercise: "做题",
  retest: "延迟复测",
  partial: "部分完成",
  english: "英语完成",
  output: "口述/输出",
};
export const DEFAULT_ROTATION: EnglishRotation = {
  listening: ["长对话", "短文理解", "讲座/讲话"],
  reading: ["选词填空", "长篇阅读", "仔细阅读"],
  output: ["写作", "翻译"],
};
export const STATUS_TEXT: Record<C.DayPlan["status"], string> = {
  FEASIBLE: "找到一份逐项校验通过的安排（不代表最优）",
  NO_PLAN_FOUND: "当前候选时间里没有找到安排——不等于做不到",
  SEARCH_LIMIT: "搜索预算用完仍未找到——不等于做不到",
  INPUT_CONFLICT: "输入本身有冲突，需要先修正",
  CAPACITY_EXCEEDED: "有可核依据：必需时长已超过全部可用时间",
  NEEDS_CALENDAR: "这一天的课表未知或未确认，不当作空闲",
  PHASE_CONFIRMATION: "首轮课程余量不足，需要你确认下一阶段",
  REST_NEEDS_WINDOW: "休息日：不安排备考，跑步时段需要你确认",
};

/**
 * Which term the timetable page opens on: the one covering `today` (a regular
 * term over an overlapping break), else the next one to start, else the latest.
 */
export function defaultSemesterId(semesters: C.Semester[], today: string): string {
  const covering = semesters.filter((s) => s.start <= today && today <= s.end);
  const current = covering.find((s) => !s.vacation) ?? covering[0];
  if (current) return current.id;
  const upcoming = semesters
    .filter((s) => s.start > today)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  return upcoming?.id ?? semesters[semesters.length - 1]?.id ?? "";
}

export function localToday(now = new Date()): string {
  return C.localToday(now, TIMEZONE);
}
/** Minutes since local midnight in the planning timezone, independent of the Mac's zone. */
export function localMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** A neutral starting point. Every value is an estimate the user must calibrate; no personal data. */
export function blankDoc(today: string): StudyDoc {
  return {
    version: 1,
    policy: {
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
      studyPlaces: ["library", "home"],
      englishTiers: [125, 100, 85, 40],
      gymWeekdays: [],
      gymMinutes: 60,
      phase: "first-pass",
      remainingLectures: 0,
      confirmedExceptions: {},
      confirmedSaturdayRunDates: [],
    },
    semesters: [],
    goal: null,
    catalog: [],
    progress: { lectureBaseline: 0, baselineDate: today, baselineStatus: "needs-refresh" },
    englishRotation: DEFAULT_ROTATION,
    phaseHistory: [],
    notes: ["空白模板：所有时长都是初值，请在「规则与数据」里校准。"],
  };
}

function checkDate(value: string, label: string, errors: string[]): void {
  try {
    C.parseDate(value);
  } catch {
    errors.push(`${label}日期无效：${value}`);
  }
}

export function validateDoc(doc: StudyDoc): string[] {
  const errors = [...C.validatePolicy(doc.policy)];
  const semesterIds = new Set<string>();
  for (const s of doc.semesters) {
    if (semesterIds.has(s.id)) errors.push(`学期ID重复：${s.id}`);
    semesterIds.add(s.id);
    errors.push(...C.validateSemester(s).map((e) => `${s.name}：${e}`));
  }
  const ids = new Set<string>();
  for (const item of doc.catalog) {
    if (!item.id || ids.has(item.id)) errors.push("课程目录ID为空或重复");
    ids.add(item.id);
    if (!item.title.trim()) errors.push("课程目录有空标题");
    if (
      item.minutes !== null &&
      (!Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 300)
    )
      errors.push(`课程时长需为1—300分钟：${item.title}`);
  }
  if (!Number.isInteger(doc.progress.lectureBaseline) || doc.progress.lectureBaseline < 0)
    errors.push("剩余课数必须是非负整数");
  checkDate(doc.progress.baselineDate, "剩余课数登记", errors);
  if (doc.goal?.examDate) checkDate(doc.goal.examDate, "初试", errors);
  for (const key of ["listening", "reading", "output"] as const)
    if (!doc.englishRotation[key].length || doc.englishRotation[key].some((t) => !t.trim()))
      errors.push("英语题型轮换列表不能为空");
  return errors;
}

// ─── Import adapters ─────────────────────────────────────────────────────

function rejectUnsafeKeys(x: unknown): void {
  if (x === null || typeof x !== "object") return;
  for (const k of Object.keys(x)) {
    if (["__proto__", "prototype", "constructor"].includes(k)) throw new Error("导入含不安全字段");
    rejectUnsafeKeys((x as Record<string, unknown>)[k]);
  }
}

export function eventFromCompletion(e: C.CompletionEvent): StudyEvent {
  return {
    id: e.id,
    date: e.date,
    task_key: e.taskId,
    kind: e.kind,
    minutes: e.minutes,
    source: e.source,
    self_reported: e.selfReported,
    session_id: null,
    corrects: null,
  };
}

/** Reference HTML export (schemaVersion 1) → native backup. Reported counts stay "needs refresh". */
export function backupFromReference(data: C.ExportData): NativeBackup {
  const date = localToday(new Date(data.exportedAt));
  return {
    format: "focus-garden-study-backup",
    version: 1,
    exported_at: data.exportedAt,
    doc: {
      version: 1,
      policy: data.policy,
      semesters: data.semesters,
      goal: null,
      catalog: [],
      progress: {
        lectureBaseline: data.policy.remainingLectures,
        baselineDate: date,
        baselineStatus: "needs-refresh",
      },
      englishRotation: DEFAULT_ROTATION,
      phaseHistory: [],
      notes: data.notes,
    },
    events: data.events.map(eventFromCompletion),
    reviews: data.reviews,
    links: [],
    plans: [],
  };
}

export type ParsedImport =
  | { kind: "native"; backup: NativeBackup }
  | { kind: "reference"; backup: NativeBackup };

export function parseImport(text: string): ParsedImport {
  if (text.length > 5_000_000) throw new Error("文件超过 5 MB");
  const raw: unknown = JSON.parse(text);
  rejectUnsafeKeys(raw);
  if (raw && typeof raw === "object" && "schemaVersion" in raw) {
    const data = C.decodeExport(text);
    return { kind: "reference", backup: backupFromReference(data) };
  }
  const b = raw as NativeBackup;
  if (b?.format !== "focus-garden-study-backup")
    throw new Error("不是学习导航备份，也不是参考版导出；原数据未改动");
  if (b.version !== 1) throw new Error("不支持的备份版本；已停止导入，原数据未改动");
  if (!Array.isArray(b.events) || !Array.isArray(b.reviews) || !Array.isArray(b.links))
    throw new Error("备份缺少必要字段");
  if (b.doc) {
    const errors = validateDoc(b.doc);
    if (errors.length) throw new Error(errors.join("；"));
  }
  return { kind: "native", backup: { ...b, plans: b.plans ?? [] } };
}

// ─── Derived progress ────────────────────────────────────────────────────

/** Events that a later correction replaced are kept on disk but not counted. */
export function activeEvents(events: StudyEvent[]): StudyEvent[] {
  const corrected = new Set(events.map((e) => e.corrects).filter(Boolean));
  return events.filter((e) => !corrected.has(e.id));
}

const DONE_KINDS = new Set<EventKind>([
  "watched",
  "closed-recall",
  "exercise",
  "retest",
  "english",
  "output",
]);

export interface TaskProgress {
  done: boolean;
  partialMinutes: number;
  events: StudyEvent[];
}
export function taskProgress(taskKey: string, events: StudyEvent[]): TaskProgress {
  const mine = activeEvents(events).filter((e) => e.task_key === taskKey);
  return {
    done: mine.some((e) => DONE_KINDS.has(e.kind)),
    partialMinutes: mine.filter((e) => e.kind === "partial").reduce((n, e) => n + e.minutes, 0),
    events: mine,
  };
}

/** Distinct lectures watched on/after the baseline date. Rewatching one lecture counts once. */
export function lecturesWatchedSince(events: StudyEvent[], since: string): number {
  return new Set(
    activeEvents(events)
      .filter((e) => e.kind === "watched" && e.task_key.startsWith("lecture:") && e.date >= since)
      .map((e) => e.task_key),
  ).size;
}

export function remainingLectures(doc: StudyDoc, events: StudyEvent[]): number {
  return Math.max(
    0,
    doc.progress.lectureBaseline - lecturesWatchedSince(events, doc.progress.baselineDate),
  );
}

export interface LectureSlot {
  taskId: string;
  taskKey: string;
  item: CatalogItem | null;
}
/**
 * Binds today's lecture slots to the next unwatched catalogue items. Items
 * watched today stay in today's slots so the day does not shift under the user.
 */
export function lectureSlots(doc: StudyDoc, events: StudyEvent[], date: string): LectureSlot[] {
  const watchedBefore = new Set(
    activeEvents(events)
      .filter((e) => e.kind === "watched" && e.date < date)
      .map((e) => e.task_key),
  );
  const pending = doc.catalog.filter((item) => !watchedBefore.has(`lecture:${item.id}`));
  return Array.from({ length: doc.policy.lecturesPerStudyDay }, (_, i) => {
    const item = pending[i] ?? null;
    return {
      taskId: `law-${i + 1}`,
      taskKey: item ? `lecture:${item.id}` : `lecture:auto:${date}:law-${i + 1}`,
      item,
    };
  });
}

/** The policy actually planned with: derived remaining count and real lecture lengths. */
export function planningPolicy(doc: StudyDoc, events: StudyEvent[], date: string): C.Policy {
  const slots = lectureSlots(doc, events, date);
  const durations = doc.policy.lectureDurations.map((d, i) => slots[i]?.item?.minutes ?? d);
  return {
    ...doc.policy,
    remainingLectures: remainingLectures(doc, events),
    lectureDurations: durations,
  };
}

export function taskKeyFor(
  date: string,
  taskId: string,
  slots: LectureSlot[],
  phase: C.Policy["phase"],
): string {
  if (phase === "first-pass") {
    const slot = slots.find((s) => s.taskId === taskId);
    if (slot) return slot.taskKey;
  }
  return `${date}:${taskId}`;
}

export function titleFor(
  task: { id: string; title: string },
  slots: LectureSlot[],
  phase: C.Policy["phase"],
): string {
  if (phase !== "first-pass") return task.title;
  const slot = slots.find((s) => s.taskId === task.id);
  if (!slot) return task.title;
  if (!slot.item) return `${task.title.replace("（课名需绑定）", "")}（待绑定课名）`;
  return `${slot.item.subject ? `${slot.item.subject}·` : ""}${slot.item.title}`;
}

const ENGLISH_MODULES: Record<string, keyof EnglishRotation> = {
  "english-1": "listening",
  "english-2": "reading",
  "english-3": "output",
};
export const TYPE_PREFIX = "题型：";
/** Next question type = the one after the most recently *completed* one; skipped days never advance it. */
export function englishFocus(doc: StudyDoc, events: StudyEvent[], taskId: string): string | null {
  const module = ENGLISH_MODULES[taskId];
  if (!module) return null;
  const list = doc.englishRotation[module];
  const done = activeEvents(events).filter(
    (e) =>
      e.kind === "english" && e.task_key.endsWith(`:${taskId}`) && e.source.startsWith(TYPE_PREFIX),
  );
  const last = done[done.length - 1]?.source.slice(TYPE_PREFIX.length);
  const index = last ? list.indexOf(last) : -1;
  return list[(index + 1) % list.length] ?? null;
}

export function eventKindFor(category: string): EventKind {
  switch (category) {
    case "law-video":
      return "watched";
    case "law-review":
      return "closed-recall";
    case "law-practice":
      return "exercise";
    case "law-output":
      return "output";
    case "english":
      return "english";
    default:
      return "partial";
  }
}

export interface LearningSummary {
  watched: number;
  recalled: number;
  exercised: number;
  retested: number;
  english: number;
  minutes: number;
}
/** Separate columns on purpose: hearing a lecture is not evidence of recall. */
export function summarize(events: StudyEvent[], from: string, to: string): LearningSummary {
  const rows = activeEvents(events).filter((e) => e.date >= from && e.date <= to);
  const uniq = (kind: EventKind) =>
    new Set(rows.filter((e) => e.kind === kind).map((e) => e.task_key)).size;
  return {
    watched: uniq("watched"),
    recalled: uniq("closed-recall"),
    exercised: uniq("exercise"),
    retested: uniq("retest"),
    english: rows.filter((e) => e.kind === "english").length,
    minutes: rows.reduce((n, e) => n + e.minutes, 0),
  };
}

/** The accepted replan for a date, only if made against the current settings revision. */
/**
 * Fingerprint of what a day's plan depends on: rules, timetable, the lecture
 * lengths bound for that day. Deliberately excludes the remaining-lecture
 * count, so recording today's finished lecture does not void today's replan,
 * and excludes unrelated edits (goal, review cards, notes).
 */
export function planInputKey(doc: StudyDoc, events: StudyEvent[], date: string): string {
  const { remainingLectures: _ignored, ...policy } = planningPolicy(doc, events, date);
  const text = JSON.stringify({ policy, semesters: doc.semesters, date });
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

function latestFor(plans: PlanRevision[], date: string): PlanRevision | undefined {
  return plans.filter((p) => p.date === date).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
}
function matches(plan: PlanRevision, revision: number, key: string | undefined): boolean {
  if ("reset" in plan.data) return false;
  return plan.data.inputKey && key ? plan.data.inputKey === key : plan.input_revision === revision;
}

/** The accepted replan for a date, only if it was made from the current plan inputs. */
export function acceptedPlan(
  plans: PlanRevision[],
  date: string,
  revision: number,
  key?: string,
): PlanRevision | null {
  const latest = latestFor(plans, date);
  return latest && matches(latest, revision, key) ? latest : null;
}
export function stalePlan(
  plans: PlanRevision[],
  date: string,
  revision: number,
  key?: string,
): boolean {
  const latest = latestFor(plans, date);
  return !!latest && !("reset" in latest.data) && !matches(latest, revision, key);
}

export interface PlanDiff {
  kept: string[];
  moved: string[];
  shortened: string[];
  dropped: string[];
  done: string[];
}
export function diffPlans(
  before: C.Block[],
  after: C.Block[],
  dropped: string[],
  done: string[],
): PlanDiff {
  const diff: PlanDiff = { kept: [], moved: [], shortened: [], dropped, done };
  for (const b of after.filter((x) => !x.fixed)) {
    const old = before.find((x) => x.id === b.id);
    if (!old) continue;
    if (b.end - b.start < old.end - old.start) diff.shortened.push(b.id);
    else if (old.start === b.start && old.entry === b.entry) diff.kept.push(b.id);
    else diff.moved.push(b.id);
  }
  return diff;
}

export function nativeBackup(snapshot: StudySnapshot, doc: StudyDoc | null): NativeBackup {
  return {
    format: "focus-garden-study-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    doc,
    events: snapshot.events,
    reviews: snapshot.reviews,
    links: snapshot.links,
    plans: snapshot.plans,
  };
}

export function dueReviewCount(snapshot: StudySnapshot, today: string): number {
  return snapshot.reviews.filter((card) => card.dueDate <= today).length;
}

/** Actual minutes spent per finished lecture (all sessions and partial records added up). */
export function lectureMinutes(events: StudyEvent[]): number[] {
  const active = activeEvents(events).filter((e) => e.task_key.startsWith("lecture:"));
  const done = new Set(active.filter((e) => e.kind === "watched").map((e) => e.task_key));
  const totals = new Map<string, number>();
  for (const e of active)
    if (done.has(e.task_key)) totals.set(e.task_key, (totals.get(e.task_key) ?? 0) + e.minutes);
  return [...totals.values()].filter((m) => m > 0);
}

export interface Pace {
  recentPerStudyDay: number | null;
  recentDays: number;
  plannedPerWeek: number;
  finishAtRecentPace: string | null;
  finishAtPlannedPace: string | null;
}
/** Where first-pass progress is heading. Estimates only, clearly labelled in the UI. */
export function lecturePace(doc: StudyDoc, events: StudyEvent[], today: string, window = 14): Pace {
  const rest = doc.policy.restWeekdays;
  const from = C.addDays(today, -window);
  const studyDays = Array.from({ length: window }, (_, i) => C.addDays(from, i)).filter(
    (d) => !rest.includes(C.weekday(d)) && d >= doc.progress.baselineDate,
  ).length;
  const watched = new Set(
    activeEvents(events)
      .filter(
        (e) =>
          e.kind === "watched" &&
          e.task_key.startsWith("lecture:") &&
          e.date >= from &&
          e.date < today,
      )
      .map((e) => e.task_key),
  ).size;
  const remaining = remainingLectures(doc, events);
  const perDay = studyDays >= 5 ? watched / studyDays : null;
  const finish = (rate: number | null): string | null => {
    if (!rate || rate <= 0) return null;
    let left = remaining;
    let d = today;
    for (let i = 0; i < 3650 && left > 0; i++) {
      if (!rest.includes(C.weekday(d))) left -= rate;
      if (left > 0) d = C.addDays(d, 1);
    }
    return left <= 0 ? d : null;
  };
  return {
    recentPerStudyDay: perDay,
    recentDays: studyDays,
    plannedPerWeek: doc.policy.lecturesPerStudyDay * (7 - rest.length),
    finishAtRecentPace: remaining === 0 ? today : finish(perDay),
    finishAtPlannedPace: remaining === 0 ? today : finish(doc.policy.lecturesPerStudyDay),
  };
}
