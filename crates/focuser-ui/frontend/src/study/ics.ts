/**
 * MIT. Importing timetables from iCalendar (.ics) files, e.g. exports from
 * WakeUp课程表、超级课程表、Apple/Google Calendar.
 *
 * Supported: VEVENT with DTSTART/DTEND or DURATION, UTC / TZID / floating
 * times, all-day events (reported, not imported as classes), RRULE with
 * FREQ=WEEKLY or DAILY plus INTERVAL / COUNT / UNTIL / BYDAY, EXDATE, and
 * RECURRENCE-ID overrides (moved or cancelled single occurrences).
 * Anything else (MONTHLY, BYSETPOS…) is listed as skipped — never guessed.
 *
 * Every occurrence is converted to Asia/Shanghai wall time, then grouped into
 * weekly rules with an explicit `weeks` list, so odd/even weeks and gaps come
 * through exactly.
 */
import * as C from "./core";

export interface IcsEvent {
  uid: string;
  summary: string;
  location: string;
  /** UTC milliseconds. */
  start: number;
  end: number;
  allDay: boolean;
  rrule: Record<string, string> | null;
  exdates: number[];
  recurrenceId: number | null;
  status: string;
  /** Original wall-clock fields in the event's own zone, for RRULE stepping. */
  zone: string;
}
export interface Occurrence {
  date: string;
  start: number;
  end: number;
  title: string;
  location: string;
  uid: string;
}
export interface IcsImport {
  occurrences: Occurrence[];
  skipped: string[];
  warnings: string[];
}

const TZ_ALIASES: Record<string, string> = {
  "China Standard Time": "Asia/Shanghai",
  "Asia/Chongqing": "Asia/Shanghai",
  "Asia/Chungking": "Asia/Shanghai",
  "Asia/Harbin": "Asia/Shanghai",
  PRC: "Asia/Shanghai",
  "China Time": "Asia/Shanghai",
};
const MAX_OCCURRENCES = 5000;
const DAY = 86_400_000;

function unfold(text: string): string[] {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}
interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}
function parseLine(line: string): Prop | null {
  // Split at the first ':' that is not inside a quoted parameter value.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [name = "", ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Offset (ms) of `zone` at UTC instant `utc`: local = utc + offset. */
function zoneOffset(utc: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return local - Math.floor(utc / 1000) * 1000;
}
/** UTC instant for a wall-clock time in `zone`. */
export function zonedToUtc(
  fields: [number, number, number, number, number, number],
  zone: string,
): number {
  const guess = Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]);
  let utc = guess - zoneOffset(guess, zone);
  utc = guess - zoneOffset(utc, zone);
  return utc;
}
function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface Parsed {
  utc: number;
  allDay: boolean;
  zone: string;
}
function parseTimeValue(value: string, params: Record<string, string>, warnings: string[]): Parsed {
  const v = value.trim();
  const date = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (date || params.VALUE === "DATE") {
    const m = date ?? v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) throw new Error(`无法识别的日期：${v}`);
    const n = (i: number) => Number(m[i] ?? 0);
    return { utc: Date.UTC(n(1), n(2) - 1, n(3)), allDay: true, zone: "UTC" };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) throw new Error(`无法识别的时间：${v}`);
  const n = (i: number) => Number(m[i] ?? 0);
  const fields: [number, number, number, number, number, number] = [
    n(1),
    n(2),
    n(3),
    n(4),
    n(5),
    n(6),
  ];
  if (m[7] === "Z")
    return {
      utc: Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]),
      allDay: false,
      zone: "UTC",
    };
  let zone = params.TZID ? (TZ_ALIASES[params.TZID] ?? params.TZID) : C.TIMEZONE_DEFAULT;
  if (!knownZone(zone)) {
    warnings.push(`未知时区 ${params.TZID}，按北京时间处理`);
    zone = C.TIMEZONE_DEFAULT;
  }
  return { utc: zonedToUtc(fields, zone), allDay: false, zone };
}
function parseDuration(v: string): number {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) throw new Error(`无法识别的时长：${v}`);
  const sign = m[1] === "-" ? -1 : 1;
  const n = (i: number) => Number(m[i] ?? 0);
  return sign * (((n(2) * 7 + n(3)) * 24 + n(4)) * 3_600_000 + n(5) * 60_000 + n(6) * 1000);
}

export function parseIcs(text: string): { events: IcsEvent[]; warnings: string[] } {
  if (text.length > 5_000_000) throw new Error("日历文件超过 5 MB");
  const lines = unfold(text);
  if (!lines.some((l) => l.trim().toUpperCase() === "BEGIN:VCALENDAR"))
    throw new Error("这不是 iCalendar (.ics) 文件");
  const events: IcsEvent[] = [];
  const warnings: string[] = [];
  let current: Prop[] | null = null;
  let depth = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      depth = 0;
      continue;
    }
    if (!current) continue;
    if (upper.startsWith("BEGIN:")) depth++;
    else if (upper.startsWith("END:") && upper !== "END:VEVENT") depth--;
    else if (upper === "END:VEVENT") {
      try {
        events.push(buildEvent(current, warnings));
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : String(e));
      }
      current = null;
      continue;
    }
    if (depth > 0) continue; // VALARM etc.
    const prop = parseLine(line);
    if (prop) current.push(prop);
  }
  return { events, warnings };
}

function buildEvent(props: Prop[], warnings: string[]): IcsEvent {
  const get = (n: string) => props.find((p) => p.name === n);
  const dtstart = get("DTSTART");
  if (!dtstart) throw new Error("有事件缺少开始时间，已跳过");
  const start = parseTimeValue(dtstart.value, dtstart.params, warnings);
  let end: number;
  const dtend = get("DTEND");
  const duration = get("DURATION");
  if (dtend) end = parseTimeValue(dtend.value, dtend.params, warnings).utc;
  else if (duration) end = start.utc + parseDuration(duration.value);
  else end = start.utc + (start.allDay ? DAY : 0);
  const rruleProp = get("RRULE");
  const rrule = rruleProp
    ? Object.fromEntries(
        rruleProp.value.split(";").map((kv) => {
          const [k = "", v = ""] = kv.split("=");
          return [k.toUpperCase(), v];
        }),
      )
    : null;
  const exdates = props
    .filter((p) => p.name === "EXDATE")
    .flatMap((p) => p.value.split(",").map((v) => parseTimeValue(v, p.params, warnings).utc));
  const rid = get("RECURRENCE-ID");
  return {
    uid: get("UID")?.value ?? `no-uid-${start.utc}`,
    summary: unescapeText(get("SUMMARY")?.value ?? "（无标题）"),
    location: unescapeText(get("LOCATION")?.value ?? ""),
    start: start.utc,
    end,
    allDay: start.allDay,
    rrule,
    exdates,
    recurrenceId: rid ? parseTimeValue(rid.value, rid.params, warnings).utc : null,
    status: (get("STATUS")?.value ?? "").toUpperCase(),
    zone: start.zone,
  };
}

const BYDAY: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

/** Wall-clock parts in `zone` for a UTC instant. */
function wall(utc: number, zone: string): { date: string; minutes: number; weekday: number } {
  const local = utc + (zone === "UTC" ? 0 : zoneOffset(utc, zone));
  const d = new Date(local);
  const date = d.toISOString().slice(0, 10);
  return { date, minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: C.weekday(date) };
}

/** Expands recurring events between `from` and `until` (inclusive local dates). */
export function expandIcs(events: IcsEvent[], from: string, until: string): IcsImport {
  const skipped: string[] = [];
  const warnings: string[] = [];
  const occurrences: Occurrence[] = [];
  const overrides = new Map<string, IcsEvent>();
  for (const e of events)
    if (e.recurrenceId !== null) overrides.set(`${e.uid}@${e.recurrenceId}`, e);
  const push = (e: IcsEvent, start: number, end: number) => {
    if (e.status === "CANCELLED") return;
    const s = wall(start, C.TIMEZONE_DEFAULT);
    const f = wall(end, C.TIMEZONE_DEFAULT);
    if (s.date < from || s.date > until) return;
    if (f.date !== s.date) {
      warnings.push(`「${e.summary}」跨过午夜，已跳过`);
      return;
    }
    if (f.minutes <= s.minutes) return;
    occurrences.push({
      date: s.date,
      start: s.minutes,
      end: f.minutes,
      title: e.summary,
      location: e.location,
      uid: e.uid,
    });
  };
  for (const e of events) {
    if (e.recurrenceId !== null) continue; // handled via its master
    if (e.allDay) {
      skipped.push(
        `全天事件「${e.summary}」没有具体钟点，未作为课程导入（假期请在「放假与补课日」里添加）`,
      );
      continue;
    }
    const length = e.end - e.start;
    const emit = (start: number) => {
      if (e.exdates.includes(start)) return;
      const override = overrides.get(`${e.uid}@${start}`);
      if (override) push(override, override.start, override.end);
      else push(e, start, start + length);
    };
    if (!e.rrule) {
      emit(e.start);
      continue;
    }
    const freq = e.rrule.FREQ;
    const unsupported = Object.keys(e.rrule).filter(
      (k) => !["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "WKST"].includes(k),
    );
    if ((freq !== "WEEKLY" && freq !== "DAILY") || unsupported.length) {
      skipped.push(
        `「${e.summary}」的重复规则（${Object.entries(e.rrule)
          .map(([k, v]) => `${k}=${v}`)
          .join(";")}）暂不支持，未导入`,
      );
      continue;
    }
    const interval = Math.max(1, Number(e.rrule.INTERVAL ?? 1) || 1);
    const count = e.rrule.COUNT ? Number(e.rrule.COUNT) : Number.POSITIVE_INFINITY;
    let untilUtc = Number.POSITIVE_INFINITY;
    if (e.rrule.UNTIL) {
      try {
        untilUtc = parseTimeValue(
          e.rrule.UNTIL,
          e.rrule.UNTIL.endsWith("Z") ? {} : { TZID: e.zone },
          warnings,
        ).utc;
        if (/^\d{8}$/.test(e.rrule.UNTIL)) untilUtc += DAY - 1;
      } catch {
        skipped.push(`「${e.summary}」的结束日期无法识别，未导入`);
        continue;
      }
    }
    const startWall = wall(e.start, e.zone);
    const days =
      freq === "WEEKLY"
        ? (e.rrule.BYDAY
            ? e.rrule.BYDAY.split(",").map((d) => BYDAY[d.trim().slice(-2)])
            : [startWall.weekday]
          ).filter((d): d is number => !!d)
        : [1, 2, 3, 4, 5, 6, 7];
    // Step through local calendar days so DST (if any) keeps the wall-clock time.
    const firstMonday = C.addDays(startWall.date, 1 - startWall.weekday);
    const [hh, mm] = [Math.floor(startWall.minutes / 60), startWall.minutes % 60];
    const seconds = Math.floor((e.start / 1000) % 60);
    let n = 0;
    for (let i = 0; i < 3660 && n < count; i++) {
      const date = C.addDays(startWall.date, i);
      if (freq === "DAILY" && i % interval !== 0) continue;
      if (freq === "WEEKLY") {
        const weekIndex = Math.floor(C.daysBetween(firstMonday, date) / 7);
        if (weekIndex % interval !== 0 || !days.includes(C.weekday(date))) continue;
      }
      const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
      const start =
        e.zone === "UTC"
          ? Date.UTC(y, mo - 1, d, hh, mm, seconds)
          : zonedToUtc([y, mo, d, hh, mm, seconds], e.zone);
      if (start > untilUtc) break;
      n++;
      emit(start);
      if (occurrences.length > MAX_OCCURRENCES) {
        warnings.push("事件太多，只取前 5000 次");
        return { occurrences, skipped, warnings };
      }
    }
  }
  occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  return { occurrences, skipped, warnings };
}

export function guessPlace(location: string): C.Place {
  const l = location.toLowerCase();
  if (/online|线上|网课|腾讯会议|zoom|直播|慕课|mooc/.test(l)) return "home";
  if (/图书馆|library/.test(l)) return "library";
  if (/操场|田径|体育场|track/.test(l)) return "track";
  if (/健身|gym/.test(l)) return "gym";
  return "classroom";
}

export interface RuleDraft {
  key: string;
  rule: C.CalendarRule;
  weeks: number[];
  dates: string[];
  locationText: string;
  include: boolean;
}

/**
 * Groups dated occurrences into weekly rules (same title, weekday, times and
 * location text). Each rule carries the exact teaching weeks it happens in.
 */
export function rulesFromOccurrences(
  occurrences: Occurrence[],
  semester: Pick<C.Semester, "id" | "firstMonday">,
  source: string,
): RuleDraft[] {
  const groups = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const key = [o.title, C.weekday(o.date), o.start, o.end, o.location].join("|");
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const drafts: RuleDraft[] = [];
  let n = 0;
  for (const [key, list] of groups) {
    const first = list[0];
    if (!first) continue;
    const dates = [...new Set(list.map((o) => o.date))].sort();
    const weeks = [
      ...new Set(dates.map((d) => Math.floor(C.daysBetween(semester.firstMonday, d) / 7) + 1)),
    ].sort((a, b) => a - b);
    const valid = weeks.every((w) => w >= 1 && w <= 60);
    n++;
    drafts.push({
      key,
      weeks,
      dates,
      locationText: first.location,
      include: valid,
      rule: {
        id: `${semester.id}-ics-${Date.now().toString(36)}-${n}`,
        title: first.title.slice(0, 120),
        weekday: C.weekday(first.date),
        start: C.timeText(first.start),
        end: C.timeText(first.end),
        from: dates[0] ?? first.date,
        until: dates[dates.length - 1] ?? first.date,
        location: guessPlace(first.location),
        kind: /实验|lab/i.test(first.title) ? "lab" : "class",
        ...(valid ? { weeks } : {}),
        evidence: "provisional",
        source: `${source}${first.location ? `；原地点：${first.location}` : ""}`,
      },
    });
  }
  return drafts.sort(
    (a, b) => a.rule.weekday - b.rule.weekday || a.rule.start.localeCompare(b.rule.start),
  );
}
