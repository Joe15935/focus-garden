/**
 * MIT. A read-only copy of the coming week for the phone, written into a
 * folder the user picks (typically iCloud Drive). No server, no account: the
 * phone opens a static HTML file in the Files app. Nothing flows back — the
 * Mac stays the only place records are made.
 */
import * as C from "./core";
import { STATUS_TEXT } from "./model";

export interface MirrorDay {
  date: string;
  status: C.DayPlan["status"];
  timeline: C.TimelineItem[];
  notes: string[];
}
export interface MirrorInput {
  generatedAt: string;
  days: MirrorDay[];
  due: { prompt: string; dueDate: string }[];
  remainingLectures: number;
}

const WEEKDAY = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function mirrorHtml(input: MirrorInput): string {
  const days = input.days
    .map((d) => {
      const rows = d.timeline
        .filter((i) => i.kind !== "buffer")
        .map(
          (i) =>
            `<li class="k-${esc(i.kind)}"><span>${C.timeText(i.start)}–${C.timeText(i.end)}</span>${esc(i.title)}</li>`,
        )
        .join("");
      const notes = d.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("");
      return `<section><h2>${esc(d.date.slice(5))} ${WEEKDAY[C.weekday(d.date)] ?? ""}</h2><p class="status">${esc(
        STATUS_TEXT[d.status],
      )}</p>${notes}${rows ? `<ol>${rows}</ol>` : ""}</section>`;
    })
    .join("");
  const due = input.due.length
    ? `<section><h2>到期复习 ${input.due.length} 张</h2><ol>${input.due
        .slice(0, 12)
        .map((c) => `<li><span>${esc(c.dueDate.slice(5))}</span>${esc(c.prompt)}</li>`)
        .join("")}</ol></section>`
    : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>学习导航 · 本周</title><style>
:root{--bg:#f8f8f1;--fg:#303c30;--muted:#6c7867;--line:rgba(71,87,55,.14);--accent:#587647}
@media (prefers-color-scheme:dark){:root{--bg:#20261f;--fg:#e6eadc;--muted:#b6bfaa;--line:rgba(210,225,197,.14);--accent:#a7c78e}}
body{margin:0;padding:18px 16px 40px;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 4px}
section{padding:14px 0;border-top:1px solid var(--line)}
.meta,.status,.note{color:var(--muted);font-size:12px;margin:2px 0}
ol{list-style:none;margin:6px 0 0;padding:0}li{padding:4px 0;display:flex;gap:10px}
li span{flex:0 0 96px;color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px}
.k-travel,.k-warmup,.k-shower{color:var(--muted);font-size:13px}.k-class,.k-lab{font-weight:600}.k-study{color:var(--accent)}
</style></head><body><h1>学习导航 · 本周</h1><p class="meta">在 Mac 上生成于 ${esc(input.generatedAt)} · 首轮剩余 ${
    input.remainingLectures
  } 节 · 只读副本，记录请在 Mac 上完成</p>${days}${due}</body></html>`;
}

/** One calendar file for several days, reusing the single-day exporter's escaping and folding. */
export function mirrorIcs(days: MirrorDay[]): string {
  const events = days.flatMap((d) => {
    const text = C.exportIcs(
      d.date,
      d.timeline.filter((i) => i.kind !== "buffer"),
    );
    const lines = text.split("\r\n");
    const out: string[] = [];
    let inside = false;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") inside = true;
      if (inside) out.push(line);
      if (line === "END:VEVENT") inside = false;
    }
    return out;
  });
  return `${[
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Focus Garden//Study Planner//ZH",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n")}\r\n`;
}
