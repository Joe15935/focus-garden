import { useMemo, useState } from "react";
import { Flame, Leaf, ShieldCheck } from "lucide-react";
import { duration, localDate, useGarden, type GardenDay, type Session } from "@/garden/api";
import { GardenError, GardenLoading } from "@/garden/common";
import { useBlockedEvents } from "@/lib/commands";
import { ExportActions } from "@/garden/export";
import { SessionReflection } from "./dashboard";

type Period = "today" | "week" | "month" | "year" | "all";
const PERIODS: [Period, string][] = [
  ["today", "今天"],
  ["week", "本周"],
  ["month", "本月"],
  ["year", "今年"],
  ["all", "全部"],
];
export function periodStart(period: Period, now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "all") return "0000-01-01";
  if (period === "week") date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  if (period === "month") date.setDate(1);
  if (period === "year") date.setMonth(0, 1);
  return localDate(date);
}
export function Statistics() {
  const garden = useGarden();
  const [period, setPeriod] = useState<Period>("week");
  const start = periodStart(period);
  const startDate = new Date(
    `${start === "0000-01-01" ? "1970-01-01" : start}T00:00:00`,
  ).toISOString();
  const nextDay = new Date();
  nextDay.setHours(24, 0, 0, 0);
  const events = useBlockedEvents(startDate, nextDay.toISOString());
  const appBlocks = events.data?.filter((event) => event.domain_or_app.startsWith("app:")).length;
  const websiteBlocks = events.data?.filter((event) =>
    event.domain_or_app.startsWith("website:"),
  ).length;
  if (garden.isPending) return <GardenLoading />;
  if (!garden.data)
    return (
      <div className="garden-page">
        <GardenError error={garden.error} />
      </div>
    );
  const data = garden.data;
  const sessions = data.sessions.filter((s) => s.local_date >= start);
  const days = data.days.filter((day) => day.date >= start);
  const total = days.reduce((sum, day) => sum + day.seconds, 0);
  const completed = sessions.filter((s) => s.status === "completed" || s.status === "break").length;
  const interrupted = sessions.filter((s) => s.status === "interrupted").length;
  const categories = Object.entries(
    sessions
      .filter((s) => s.outcome === "completed")
      .reduce<Record<string, number>>((map, s) => {
        map[s.category] = (map[s.category] ?? 0) + 1;
        return map;
      }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const goalDays = days.filter((day) => day.seconds >= data.config.daily_goal_minutes * 60).length;
  const firstDate =
    period === "all"
      ? ([...data.days].sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? localDate())
      : start;
  const dayCount = Math.max(
    1,
    Math.round(
      (new Date(`${localDate()}T12:00:00`).getTime() -
        new Date(`${firstDate}T12:00:00`).getTime()) /
        86400000,
    ) + 1,
  );
  const weeklySeconds = data.days
    .filter((day) => day.date >= periodStart("week"))
    .reduce((sum, day) => sum + day.seconds, 0);
  return (
    <div className="garden-page">
      <header className="garden-page-header">
        <div>
          <p className="garden-date">积累看得见</p>
          <h1>你的专注足迹</h1>
        </div>
        <ExportActions />
      </header>
      <div className="garden-segmented" aria-label="统计时间范围">
        {PERIODS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            className={period === value ? "selected" : ""}
            onClick={() => setPeriod(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="garden-stat-line">
        <div>
          <span>投入时间</span>
          <strong>{duration(total)}</strong>
        </div>
        <div>
          <span>完成专注</span>
          <strong>
            {completed}
            <small> 次</small>
          </strong>
        </div>
        <div>
          <span>提前结束</span>
          <strong>
            {interrupted}
            <small> 次</small>
          </strong>
        </div>
        <div>
          <span>每日目标完成率</span>
          <strong>
            {Math.round((goalDays / dayCount) * 100)}
            <small>%</small>
          </strong>
        </div>
      </div>
      <div className="garden-stat-notes">
        <span>
          <Flame size={17} /> 连续 {data.current_streak} 天 · 最长 {data.longest_streak} 天
        </span>
        <span>
          <ShieldCheck size={17} /> 当前范围拦截应用 {appBlocks ?? "—"} 次 · 网站{" "}
          {websiteBlocks ?? "—"} 次
        </span>
        <span>
          <Leaf size={17} /> 最常完成 {categories[0]?.[0] ?? "尚未记录任务完成情况"}
        </span>
      </div>
      <div className="garden-goal garden-week-goal">
        <div>
          <span>本周目标</span>
          <span>
            {Math.floor(weeklySeconds / 60)} / {data.config.weekly_goal_minutes} 分钟
          </span>
        </div>
        <progress
          value={Math.min(weeklySeconds / 60, data.config.weekly_goal_minutes)}
          max={data.config.weekly_goal_minutes}
        />
      </div>
      <GardenError error={events.error} />
      <Heatmap days={data.days} />
      <section className="garden-history">
        <div className="garden-section-heading">
          <h2>每一段认真投入</h2>
          <span>{sessions.length} 段记录</span>
        </div>
        {sessions.length === 0 ? (
          <p className="garden-empty">这里会留下你的第一段专注。慢慢来。</p>
        ) : (
          [...sessions]
            .sort((a, b) => b.started_at.localeCompare(a.started_at))
            .slice(0, 80)
            .map((session) => <HistoryRow key={session.id} session={session} />)
        )}
        {sessions.length > 80 && <p className="garden-muted">显示最近 80 条，完整记录可导出。</p>}
      </section>
    </div>
  );
}
function HistoryRow({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="garden-history-row">
      <button
        className="garden-history-toggle"
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span>
          <strong>{session.task}</strong>
          <small>
            {new Date(session.started_at).toLocaleString("zh-CN", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · {session.category}
          </small>
        </span>
        <span>
          {duration(session.elapsed_secs)}
          <small>
            {session.status === "interrupted"
              ? "提前结束"
              : session.status === "work"
                ? "进行中"
                : "已完成"}
          </small>
        </span>
      </button>
      {expanded && (
        <>
          <p className="garden-muted">{session.reason ? `结束原因：${session.reason}` : ""}</p>
          {session.status !== "work" && <SessionReflection session={session} />}
        </>
      )}
    </article>
  );
}
function Heatmap({ days }: { days: GardenDay[] }) {
  const [range, setRange] = useState(365);
  const [selected, setSelected] = useState(localDate());
  const cells = useMemo(() => {
    const values = new Map(days.map((day) => [day.date, day]));
    return Array.from({ length: range }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - range + i + 1);
      const key = localDate(date);
      return values.get(key) ?? { date: key, seconds: 0, sessions: 0, tasks: [] };
    });
  }, [days, range]);
  const day = days.find((d) => d.date === selected);
  return (
    <section className="garden-heatmap-section">
      <div className="garden-section-heading">
        <h2>把日子连成一片绿意</h2>
        <div className="garden-segmented compact">
          {[7, 30, 90, 365].map((value) => (
            <button
              type="button"
              key={value}
              className={range === value ? "selected" : ""}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {value} 天
            </button>
          ))}
        </div>
      </div>
      <div
        className={`garden-heatmap garden-heatmap-${range}`}
        role="group"
        aria-label="每日专注热力图"
      >
        {cells.map((day) => {
          const level =
            day.seconds === 0
              ? 0
              : day.seconds < 1800
                ? 1
                : day.seconds < 3600
                  ? 2
                  : day.seconds < 7200
                    ? 3
                    : 4;
          return (
            <button
              type="button"
              key={day.date}
              className={`heat-${level} ${selected === day.date ? "selected" : ""}`}
              title={`${day.date} · ${duration(day.seconds)} · ${day.sessions} 次`}
              aria-label={`${day.date}，${duration(day.seconds)}，${day.sessions} 次专注`}
              onClick={() => setSelected(day.date)}
            />
          );
        })}
      </div>
      <div className="garden-heatmap-footer">
        <span>浅色到深色，记录每天投入的时间。</span>
        <span>
          少 <i className="heat-0" />
          <i className="heat-1" />
          <i className="heat-2" />
          <i className="heat-3" />
          <i className="heat-4" /> 多
        </span>
      </div>
      <div className="garden-day-detail" aria-live="polite">
        <strong>{selected}</strong>
        <span>
          {duration(day?.seconds ?? 0)} · {day?.sessions ?? 0} 次专注
        </span>
        <p>{day?.tasks.length ? day.tasks.join(" · ") : "这一天还没有记录的任务。"}</p>
      </div>
    </section>
  );
}
