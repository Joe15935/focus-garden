import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Play, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  GARDEN_KEY,
  gardenCommand,
  type Session,
  type Strictness,
  strictLabels,
  useGarden,
} from "@/garden/api";
import { GardenError } from "@/garden/common";
import { useBlockLists } from "@/lib/commands";
import { ActiveSession } from "@/routes/dashboard";
import { STUDY_KEY, studyCommand, usePlan, useStartTask } from "./api";
import * as C from "./core";
import { buildTaskStart, STUDY_CATEGORIES } from "./garden-adapter";
import { makeEvent, mondayOf, saveText, useAppendEvent, useSaveDoc, weekdayName } from "./hooks";
import {
  acceptedPlan,
  diffPlans,
  EVENT_KIND_LABELS,
  englishFocus,
  eventKindFor,
  type LectureSlot,
  lectureSlots,
  localMinutes,
  localToday,
  planInputKey,
  planningPolicy,
  STATUS_TEXT,
  type StudyDoc,
  type StudySnapshot,
  stalePlan,
  summarize,
  TYPE_PREFIX,
  taskKeyFor,
  taskProgress,
  titleFor,
} from "./model";
import type { PlanRequest } from "./planner";

type Tab = "today" | "calendar" | "reviews" | "rules";

export function TodayPanel({
  snapshot,
  doc,
  goTo,
}: {
  snapshot: StudySnapshot;
  doc: StudyDoc;
  goTo: (tab: Tab) => void;
}) {
  const today = localToday();
  const [date, setDate] = useState(today);
  const garden = useGarden();
  const policy = useMemo(
    () => planningPolicy(doc, snapshot.events, date),
    [doc, snapshot.events, date],
  );
  const slots = useMemo(
    () => lectureSlots(doc, snapshot.events, date),
    [doc, snapshot.events, date],
  );
  const request = useMemo<PlanRequest>(
    () => ({ kind: "day", policy, semesters: doc.semesters, date }),
    [policy, doc.semesters, date],
  );
  const response = usePlan(request);
  const plan = response?.kind === "day" ? response.plan : null;
  const inputKey = useMemo(
    () => planInputKey(doc, snapshot.events, date),
    [doc, snapshot.events, date],
  );
  const accepted = acceptedPlan(snapshot.plans, date, snapshot.revision, inputKey);
  const stale = stalePlan(snapshot.plans, date, snapshot.revision, inputKey);
  const acceptedData = accepted && !("reset" in accepted.data) ? accepted.data : null;
  const blocks = acceptedData?.blocks ?? plan?.blocks ?? [];
  const timeline = acceptedData ? acceptedData.timeline : (plan?.timeline ?? []);
  const active = garden.data?.active ?? null;
  const week = summarize(snapshot.events, mondayOf(today), C.addDays(mondayOf(today), 6));
  const lastMonday = C.addDays(mondayOf(today), -7);
  const lastWeek = summarize(snapshot.events, lastMonday, C.addDays(lastMonday, 6));
  const lastWeekPlanned =
    doc.policy.phase === "first-pass"
      ? Array.from({ length: 7 }, (_, i) => C.addDays(lastMonday, i)).filter(
          (d) => !doc.policy.restWeekdays.includes(C.weekday(d)) && d >= doc.progress.baselineDate,
        ).length * doc.policy.lecturesPerStudyDay
      : null;
  const overdue = snapshot.reviews.filter((c) => c.dueDate < today).length;

  return (
    <div className="study-today">
      {active && (
        <section className="study-card">
          <h2>正在进行的专注</h2>
          <p className="garden-muted">
            计时、屏蔽和提前结束规则都由原有花园负责，学习导航不会缩短或结束它。
          </p>
          <ActiveSession session={active} />
        </section>
      )}

      <div className="study-toolbar">
        <div className="garden-inline-actions">
          <button
            type="button"
            className="garden-icon-button"
            aria-label="前一天"
            onClick={() => setDate(C.addDays(date, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={date}
            aria-label="查看日期"
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <button
            type="button"
            className="garden-icon-button"
            aria-label="后一天"
            onClick={() => setDate(C.addDays(date, 1))}
          >
            <ChevronRight size={16} />
          </button>
          {date !== today && (
            <button
              type="button"
              className="garden-button secondary small"
              onClick={() => setDate(today)}
            >
              回到今天
            </button>
          )}
          <span className="garden-muted">{weekdayName(C.weekday(date))} · 北京时间</span>
        </div>
        {timeline.length > 0 && (
          <button
            type="button"
            className="garden-button secondary small"
            onClick={() =>
              saveText(C.exportIcs(date, timeline), `学习导航-${date}.ics`, "ics").catch(() => {})
            }
          >
            <Download size={14} /> 导出这天的日历
          </button>
        )}
      </div>

      {!plan ? (
        response?.kind === "error" ? (
          <p className="garden-error">{response.message}</p>
        ) : (
          <p className="garden-muted" role="status">
            正在计算这一天的安排…
          </p>
        )
      ) : (
        <>
          <PlanStatus plan={plan} doc={doc} date={date} snapshot={snapshot} goTo={goTo} />
          {stale && (
            <p className="study-note warning">
              这一天之前采用过一次重排，但规则或课表已经改变，旧重排不再使用；下面是按当前设置重新计算的安排。
            </p>
          )}
          {acceptedData && accepted && (
            <AcceptedBanner
              snapshot={snapshot}
              date={date}
              reason={accepted.reason}
              at={acceptedData.now}
            />
          )}
          {timeline.length > 0 && (
            <Timeline
              snapshot={snapshot}
              doc={doc}
              date={date}
              blocks={blocks}
              timeline={timeline}
              slots={slots}
              sessions={garden.data?.sessions ?? []}
              activeSession={active}
            />
          )}
          {date === today && plan.status === "FEASIBLE" && (
            <Replan
              snapshot={snapshot}
              doc={doc}
              date={date}
              plan={plan}
              current={blocks}
              currentTimeline={timeline}
              slots={slots}
              busy={!!active}
            />
          )}
        </>
      )}

      <section className="study-card">
        <h2>本周记录（周一到周日）</h2>
        <div className="study-stats">
          <div>
            <span>听完的课</span>
            <strong>{week.watched}</strong>
          </div>
          <div>
            <span>闭卷提取</span>
            <strong>{week.recalled}</strong>
          </div>
          <div>
            <span>做题</span>
            <strong>{week.exercised}</strong>
          </div>
          <div>
            <span>延迟复测</span>
            <strong>{week.retested}</strong>
          </div>
          <div>
            <span>英语完成</span>
            <strong>{week.english}</strong>
          </div>
          <div>
            <span>记录分钟</span>
            <strong>{week.minutes}</strong>
          </div>
        </div>
        <p className="garden-muted">
          这几栏分开统计：听完不等于记住，计时不等于掌握。花园经验只来自真实专注计时。
        </p>
        <p className="garden-muted">
          上周（{lastMonday.slice(5)} 起）：听完 {lastWeek.watched} 节
          {lastWeekPlanned !== null ? `（按规则计划 ${lastWeekPlanned} 节）` : ""} · 闭卷提取{" "}
          {lastWeek.recalled} · 做题 {lastWeek.exercised} · 延迟复测 {lastWeek.retested} · 英语{" "}
          {lastWeek.english} 次{overdue > 0 ? ` · 目前积压复习卡 ${overdue} 张` : ""}
          。复盘时只看差距出在哪里，不补前一周的任务债。
        </p>
      </section>
    </div>
  );
}

function PlanStatus({
  plan,
  doc,
  date,
  snapshot,
  goTo,
}: {
  plan: C.DayPlan;
  doc: StudyDoc;
  date: string;
  snapshot: StudySnapshot;
  goTo: (tab: Tab) => void;
}) {
  const save = useSaveDoc(snapshot);
  const ok = plan.status === "FEASIBLE";
  return (
    <section className={`study-status ${ok ? "ok" : "attention"}`}>
      <strong>{STATUS_TEXT[plan.status]}</strong>
      {plan.status === "FEASIBLE" && (
        <p className="garden-muted">
          英语 {plan.englishMinutes} 分钟档{plan.gymPlanned ? " · 含健身" : ""} · 未分配余量{" "}
          {plan.unallocatedMinutes} 分钟 · 搜索 {plan.nodes} 步
        </p>
      )}
      {[...plan.warnings, ...plan.diagnostics].map((line) => (
        <p key={line} className="garden-muted">
          {line}
        </p>
      ))}
      {plan.status === "NEEDS_CALENDAR" && (
        <button type="button" className="garden-button small" onClick={() => goTo("calendar")}>
          <CalendarDays size={14} /> 去导入或确认课表
        </button>
      )}
      {plan.status === "PHASE_CONFIRMATION" && (
        <button type="button" className="garden-button small" onClick={() => goTo("rules")}>
          去确认下一阶段
        </button>
      )}
      {plan.status === "REST_NEEDS_WINDOW" && (
        <div className="garden-inline-actions">
          <button
            type="button"
            className="garden-button small"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                ...doc,
                policy: {
                  ...doc.policy,
                  confirmedSaturdayRunDates: [...doc.policy.confirmedSaturdayRunDates, date],
                },
              })
            }
          >
            我确认这天晚上可以去跑步
          </button>
          <span className="garden-muted">只影响这一天；不会安排备考。</span>
        </div>
      )}
      {(plan.status === "NO_PLAN_FOUND" ||
        plan.status === "SEARCH_LIMIT" ||
        plan.status === "CAPACITY_EXCEEDED") && (
        <p className="garden-muted">
          可以考虑的取舍（都需要你决定）：去掉健身或可选整理；英语用 100/85/40
          分钟档；在「规则与数据」为这一天单独确认午休例外。三节课、睡眠和本科课不会被自动挤掉。
        </p>
      )}
      <GardenError error={save.error} />
    </section>
  );
}

function AcceptedBanner({
  snapshot,
  date,
  reason,
  at,
}: {
  snapshot: StudySnapshot;
  date: string;
  reason: string;
  at: number;
}) {
  const query = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="study-note">
      正在使用 {C.timeText(at)} 采用的重排{reason ? `（${reason}）` : ""}。
      <button
        type="button"
        className="garden-link"
        onClick={() =>
          studyCommand("record_plan", {
            plan: {
              date,
              input_revision: snapshot.revision,
              status: "RESET",
              reason: "恢复原计划",
              data: { reset: true },
            },
          })
            .then(() => query.invalidateQueries({ queryKey: STUDY_KEY }))
            .catch(setError)
        }
      >
        <RotateCcw size={12} /> 恢复原计划
      </button>
      <GardenError error={error} />
    </div>
  );
}

const PLACE_OPTIONS = C.PLACES.map((p) => ({ value: p, label: C.PLACE_NAMES[p] }));

function Timeline({
  snapshot,
  doc,
  date,
  blocks,
  timeline,
  slots,
  sessions,
  activeSession,
}: {
  snapshot: StudySnapshot;
  doc: StudyDoc;
  date: string;
  blocks: C.Block[];
  timeline: C.TimelineItem[];
  slots: LectureSlot[];
  sessions: Session[];
  activeSession: Session | null;
}) {
  const lists = useBlockLists();
  const [listId, setListId] = useState("");
  const [strict, setStrict] = useState<Strictness>("focus");
  const selected = lists.data?.find((l) => l.id === listId)?.id ?? lists.data?.[0]?.id ?? "";
  const today = localToday();
  const now = date === today ? localMinutes() : -1;
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const shown = new Set<string>();

  return (
    <section className="study-card">
      <div className="study-card-head">
        <h2>这一天</h2>
        <div className="garden-inline-actions">
          <label>
            屏蔽列表{" "}
            <select value={selected} onChange={(e) => setListId(e.target.value)}>
              {!lists.data?.length && <option value="">先在「屏蔽列表」建立一个</option>}
              {lists.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            强度{" "}
            <select value={strict} onChange={(e) => setStrict(e.target.value as Strictness)}>
              {(["gentle", "focus", "deep"] as Strictness[]).map((s) => (
                <option key={s} value={s}>
                  {strictLabels[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <ol className="study-timeline">
        {timeline.map((item) => {
          const block = item.taskId ? byId.get(item.taskId) : undefined;
          const isStudy = !!block && !block.fixed && STUDY_CATEGORIES.has(block.category);
          // One action row per task, on its first visible segment.
          const first = !!item.taskId && !shown.has(item.taskId);
          if (item.taskId) shown.add(item.taskId);
          const past = now >= 0 && item.end <= now;
          const current = now >= item.start && now < item.end;
          return (
            <li
              key={item.id}
              className={`study-row kind-${item.kind} ${past ? "past" : ""} ${current ? "current" : ""}`}
            >
              <span className="study-time">
                {C.timeText(item.start)}–{C.timeText(item.end)}
              </span>
              <span className="study-title">
                {isStudy && block ? titleFor(block, slots, doc.policy.phase) : item.title}
                <small>
                  {item.to
                    ? `${C.PLACE_NAMES[item.place]} → ${C.PLACE_NAMES[item.to]}`
                    : C.PLACE_NAMES[item.place]}
                  {isStudy &&
                  block?.category === "english" &&
                  englishFocus(doc, snapshot.events, block.id)
                    ? ` · 今天题型：${englishFocus(doc, snapshot.events, block.id)}`
                    : ""}
                </small>
              </span>
              {isStudy && block && first && (
                <TaskActions
                  snapshot={snapshot}
                  doc={doc}
                  date={date}
                  block={block}
                  slots={slots}
                  sessions={sessions}
                  activeSession={activeSession}
                  listId={selected}
                  strict={strict}
                />
              )}
            </li>
          );
        })}
      </ol>
      <GardenError error={lists.error} />
    </section>
  );
}

function TaskActions({
  snapshot,
  doc,
  date,
  block,
  slots,
  sessions,
  activeSession,
  listId,
  strict,
}: {
  snapshot: StudySnapshot;
  doc: StudyDoc;
  date: string;
  block: C.Block;
  slots: LectureSlot[];
  sessions: Session[];
  activeSession: Session | null;
  listId: string;
  strict: Strictness;
}) {
  const start = useStartTask();
  const append = useAppendEvent();
  const query = useQueryClient();
  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState<unknown>(null);
  const key = taskKeyFor(date, block.id, slots, doc.policy.phase);
  const progress = taskProgress(key, snapshot.events);
  const occurrence = `${date}:${block.id}`;
  const links = snapshot.links.filter((l) => l.occurrence_id === occurrence);
  const linkedSessions = links
    .map((l) => sessions.find((s) => s.id === l.session_id))
    .filter((s): s is Session => !!s);
  const running = linkedSessions.find((s) => s.status === "work" || s.status === "break");
  const recordedSessions = new Set(progress.events.map((e) => e.session_id).filter(Boolean));
  const awaiting = linkedSessions.find(
    (s) => (s.status === "completed" || s.status === "interrupted") && !recordedSessions.has(s.id),
  );
  const planned = block.end - block.start;
  const remaining = Math.max(0, planned - progress.partialMinutes);
  const focus = block.category === "english" ? englishFocus(doc, snapshot.events, block.id) : null;
  const doneKind = eventKindFor(block.category);

  const record = (kind: "done" | "partial" | "none", minutes: number, session?: Session) => {
    if (kind === "none") {
      if (session)
        gardenCommand("set_outcome", { id: session.id, outcome: "unfinished" })
          .then(() => query.invalidateQueries({ queryKey: GARDEN_KEY }))
          .catch(() => {});
      // Nothing happened is not a learning fact; keep a marker only to stop asking.
      append.mutate(
        makeEvent({
          date,
          task_key: key,
          kind: "partial",
          minutes: 0,
          source: "未完成",
          session_id: session?.id ?? null,
        }),
      );
      return;
    }
    append.mutate(
      makeEvent({
        date,
        task_key: key,
        kind: kind === "done" ? doneKind : "partial",
        minutes,
        source: focus ? `${TYPE_PREFIX}${focus}` : "自报",
        session_id: session?.id ?? null,
      }),
      {
        onSuccess: () => {
          if (session)
            gardenCommand("set_outcome", {
              id: session.id,
              outcome: kind === "done" ? "completed" : "partial",
            })
              .then(() => query.invalidateQueries({ queryKey: GARDEN_KEY }))
              .catch(() => {});
        },
      },
    );
  };

  if (progress.done)
    return (
      <span className="study-badge done">
        已记录：
        {EVENT_KIND_LABELS[progress.events.find((e) => e.kind !== "partial")?.kind ?? doneKind]}
      </span>
    );

  return (
    <span className="study-actions">
      {progress.partialMinutes > 0 && (
        <span className="study-badge">已做 {progress.partialMinutes} 分</span>
      )}
      {running ? (
        <span className="study-badge live">专注中</span>
      ) : awaiting ? (
        <SessionOutcome
          session={awaiting}
          planned={remaining}
          onRecord={record}
          busy={append.isPending}
        />
      ) : (
        <>
          <button
            type="button"
            className="garden-button small"
            disabled={!listId || !!activeSession || start.isPending || remaining < 1}
            title={activeSession ? "已有专注进行中" : undefined}
            onClick={() => {
              setLocalError(null);
              try {
                start.mutate(buildTaskStart(block, date, key, listId, strict, remaining));
              } catch (error) {
                setLocalError(error);
              }
            }}
          >
            <Play size={13} /> {progress.partialMinutes > 0 ? `继续 ${remaining} 分` : "开始"}
          </button>
          <button
            type="button"
            className="garden-button secondary small"
            onClick={() => setOpen(!open)}
          >
            手动记录
          </button>
        </>
      )}
      {open && !running && !awaiting && (
        <ManualRecord
          planned={remaining}
          onRecord={(k, m) => {
            record(k, m);
            setOpen(false);
          }}
        />
      )}
      <GardenError error={localError ?? start.error ?? append.error} />
    </span>
  );
}

function SessionOutcome({
  session,
  planned,
  onRecord,
  busy,
}: {
  session: Session;
  planned: number;
  onRecord: (kind: "done" | "partial" | "none", minutes: number, session?: Session) => void;
  busy: boolean;
}) {
  const minutes = Math.floor(session.elapsed_secs / 60);
  return (
    <span className="study-outcome">
      <span className="garden-muted">
        专注{session.status === "interrupted" ? "提前结束" : "结束"}（{minutes} 分钟），结果？
      </span>
      <button
        type="button"
        className="garden-button small"
        disabled={busy}
        onClick={() => onRecord("done", Math.min(planned, Math.max(minutes, 0)), session)}
      >
        整项完成
      </button>
      <button
        type="button"
        className="garden-button secondary small"
        disabled={busy || minutes < 1 || minutes >= planned}
        onClick={() => onRecord("partial", minutes, session)}
      >
        完成一部分
      </button>
      <button
        type="button"
        className="garden-button secondary small"
        disabled={busy}
        onClick={() => onRecord("none", 0, session)}
      >
        没有完成
      </button>
    </span>
  );
}

function ManualRecord({
  planned,
  onRecord,
}: {
  planned: number;
  onRecord: (kind: "done" | "partial", minutes: number) => void;
}) {
  const [minutes, setMinutes] = useState(planned);
  return (
    <span className="study-outcome">
      <label>
        实际分钟{" "}
        <input
          type="number"
          min={0}
          max={600}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className="study-number"
        />
      </label>
      <button
        type="button"
        className="garden-button small"
        onClick={() => onRecord("done", minutes)}
      >
        整项完成
      </button>
      <button
        type="button"
        className="garden-button secondary small"
        disabled={minutes < 1 || minutes >= planned}
        onClick={() => onRecord("partial", minutes)}
      >
        只完成一部分
      </button>
    </span>
  );
}

function Replan({
  snapshot,
  doc,
  date,
  plan,
  current,
  currentTimeline,
  slots,
  busy,
}: {
  snapshot: StudySnapshot;
  doc: StudyDoc;
  date: string;
  plan: C.DayPlan;
  current: C.Block[];
  currentTimeline: C.TimelineItem[];
  slots: LectureSlot[];
  busy: boolean;
}) {
  const query = useQueryClient();
  const [open, setOpen] = useState(false);
  const [nowText, setNowText] = useState(() => C.timeText(Math.min(1439, localMinutes())));
  const [place, setPlace] = useState<C.Place>("home");
  const [reason, setReason] = useState("");
  const [dropped, setDropped] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  let now = -1;
  try {
    now = C.parseTime(nowText);
  } catch {
    now = -1;
  }
  const tasks = plan.tasks;
  const keyOf = (id: string) => taskKeyFor(date, id, slots, doc.policy.phase);
  const completed = tasks
    .filter((t) => taskProgress(keyOf(t.id), snapshot.events).done)
    .map((t) => t.id);
  const partial = Object.fromEntries(
    tasks
      .filter((t) => !completed.includes(t.id) && !t.segments)
      .map((t) => [
        t.id,
        Math.min(t.minutes - 1, taskProgress(keyOf(t.id), snapshot.events).partialMinutes),
      ])
      .filter(([, m]) => (m as number) > 0),
  ) as Record<string, number>;
  // Life/run items whose allowed window has fully passed are proposed (not forced) as skipped.
  const defaultDropped = tasks
    .filter(
      (t) =>
        !completed.includes(t.id) &&
        !STUDY_CATEGORIES.has(t.category) &&
        now >= 0 &&
        t.windows.every((w) => w.end <= now),
    )
    .map((t) => t.id);
  const drop = dropped ?? defaultDropped;
  const request: PlanRequest | null =
    open && now >= 0
      ? {
          kind: "replan",
          tasks,
          fixed: current.filter((b) => b.fixed),
          completed,
          partial,
          dropped: drop,
          now,
          place,
          sleep: C.parseTime(doc.policy.sleep),
          route: doc.policy.travelMinutes,
          previous: current,
          placeHours: doc.policy.placeHours,
        }
      : null;
  const response = usePlan(request);
  const result = response?.kind === "replan" ? response : null;
  const diff = result ? diffPlans(current, result.result.blocks, drop, completed) : null;
  const title = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    return t ? titleFor(t, slots, doc.policy.phase) : id;
  };

  if (!open)
    return (
      <div className="garden-inline-actions">
        <button
          type="button"
          className="garden-button secondary"
          disabled={busy}
          onClick={() => setOpen(true)}
        >
          <RotateCcw size={14} /> 情况变了：按现在重排剩下的
        </button>
        {busy && <span className="garden-muted">专注进行中，结束后再重排。</span>}
      </div>
    );

  return (
    <section className="study-card">
      <h2>按现在重排</h2>
      <p className="garden-muted">
        只动还没开始的部分。已记录完成的不再安排，没记录的不会被当成完成；进行中的课不会被截短。
      </p>
      <div className="garden-inline-actions">
        <label>
          现在 <input type="time" value={nowText} onChange={(e) => setNowText(e.target.value)} />
        </label>
        <label>
          我在{" "}
          <select value={place} onChange={(e) => setPlace(e.target.value as C.Place)}>
            {PLACE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          原因{" "}
          <input
            value={reason}
            maxLength={80}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：起晚 30 分钟"
          />
        </label>
      </div>
      <ul className="study-checklist">
        {tasks.map((t) => {
          const isDone = completed.includes(t.id);
          return (
            <li key={t.id}>
              {isDone ? (
                <span className="study-badge done">已完成</span>
              ) : (
                <label>
                  <input
                    type="checkbox"
                    checked={drop.includes(t.id)}
                    onChange={(e) =>
                      setDropped(
                        e.target.checked ? [...drop, t.id] : drop.filter((x) => x !== t.id),
                      )
                    }
                  />{" "}
                  今天不再安排
                </label>
              )}{" "}
              {title(t.id)}
              {partial[t.id] ? (
                <small className="garden-muted"> · 已做 {partial[t.id]} 分，只排剩余</small>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!result ? (
        <p className="garden-muted">
          {now < 0
            ? "请填写有效时间。"
            : response?.kind === "error"
              ? response.message
              : "正在计算…"}
        </p>
      ) : (
        <div className={`study-status ${result.result.status === "FEASIBLE" ? "ok" : "attention"}`}>
          <strong>{STATUS_TEXT[result.result.status]}</strong>
          {result.result.diagnostics.map((d) => (
            <p key={d} className="garden-muted">
              {d}
            </p>
          ))}
          {diff && result.result.status === "FEASIBLE" && (
            <ul className="study-diff">
              {diff.kept.length > 0 && <li>保留：{diff.kept.map(title).join("、")}</li>}
              {diff.moved.length > 0 && <li>移动：{diff.moved.map(title).join("、")}</li>}
              {diff.shortened.length > 0 && (
                <li>只排剩余：{diff.shortened.map(title).join("、")}</li>
              )}
              {diff.dropped.length > 0 && (
                <li>今天不再安排：{diff.dropped.map(title).join("、")}</li>
              )}
              {diff.done.length > 0 && <li>已完成：{diff.done.map(title).join("、")}</li>}
            </ul>
          )}
          {result.result.status === "FEASIBLE" && (
            <ol className="study-timeline compact">
              {result.timeline.map((item) => (
                <li key={item.id} className={`study-row kind-${item.kind}`}>
                  <span className="study-time">
                    {C.timeText(item.start)}–{C.timeText(item.end)}
                  </span>
                  <span className="study-title">{item.title}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <div className="garden-inline-actions">
        <button type="button" className="garden-button secondary" onClick={() => setOpen(false)}>
          先不改
        </button>
        <button
          type="button"
          className="garden-button"
          disabled={result?.result.status !== "FEASIBLE"}
          onClick={() => {
            if (!result) return;
            studyCommand("record_plan", {
              plan: {
                date,
                input_revision: snapshot.revision,
                status: result.result.status,
                reason: reason.trim(),
                data: {
                  // Keep what already happened; replace only the future.
                  blocks: [
                    ...current.filter(
                      (b) => b.end <= now && !result.result.blocks.some((x) => x.id === b.id),
                    ),
                    ...result.result.blocks,
                  ],
                  timeline: [
                    ...currentTimeline.filter(
                      (i) => i.end <= now && !result.result.blocks.some((b) => b.id === i.taskId),
                    ),
                    ...result.timeline,
                  ],
                  now,
                  place,
                  dropped: drop,
                  inputKey: planInputKey(doc, snapshot.events, date),
                },
              },
            })
              .then(() => {
                setOpen(false);
                return query.invalidateQueries({ queryKey: STUDY_KEY });
              })
              .catch(setError);
          }}
        >
          采用这个重排
        </button>
      </div>
      <GardenError error={error} />
    </section>
  );
}
