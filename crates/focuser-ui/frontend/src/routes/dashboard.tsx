import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Flame, Play, Shield, Sprout, Trophy } from "lucide-react";
import { useBlockLists, useCreateBlockList } from "@/lib/commands";
import { GardenScene } from "@/garden/art";
import { GardenError, GardenLoading, Onboarding } from "@/garden/common";
import { TimerRing } from "@/garden/timer-ring";
import { DurationPicker } from "@/garden/duration-picker";
import { StrictnessSelector } from "@/garden/strictness-selector";
import {
  countdown,
  duration,
  localDate,
  outcomeLabels,
  strictLabels,
  useGarden,
  useGardenAction,
  type Session,
  type Strictness,
  type Outcome,
} from "@/garden/api";

export function Dashboard() {
  const garden = useGarden();
  if (garden.isPending) return <GardenLoading />;
  if (!garden.data)
    return (
      <div className="garden-page">
        <GardenError error={garden.error} />
        <button className="garden-button" type="button" onClick={() => garden.refetch()}>
          重新加载
        </button>
      </div>
    );
  const data = garden.data;
  const today = data.days.find((day) => day.date === localDate());
  const seconds = today?.seconds ?? 0;
  const progress = Math.min(100, (seconds / (data.config.daily_goal_minutes * 60)) * 100);
  const creditedPlants = data.sessions.filter(
    (s) => s.status === "completed" && s.elapsed_secs >= 1500,
  ).length;
  const pending = data.sessions
    .filter(
      (s) => (s.status === "completed" || s.status === "interrupted") && s.outcome === "pending",
    )
    .slice(0, 3);

  return (
    <div className="garden-page">
      <header className="garden-page-header">
        <div>
          <p className="garden-date">
            {new Date().toLocaleDateString("zh-CN", {
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </p>
          <h1>今天，慢慢生长。</h1>
        </div>
        <Link to="/garden" className="garden-link">
          走进花园 <ArrowRight size={16} />
        </Link>
      </header>

      <Onboarding />

      <div className="garden-home-hero">
        <section className="garden-today" aria-label="今日状态">
          <span className="garden-overline">今天已专注</span>
          <div className="garden-today-time">{duration(seconds)}</div>
          <p className="garden-muted">为真正想做的事，多留一点时间。</p>
          <div className="garden-streak-line">
            <span>
              <Flame size={18} /> 连续 {data.current_streak} 天
            </span>
            <span>
              <Trophy size={17} /> 最长 {data.longest_streak} 天
            </span>
          </div>
          <div className="garden-goal">
            <div>
              <span>今日目标</span>
              <span>
                {Math.floor(seconds / 60)} / {data.config.daily_goal_minutes} 分钟
              </span>
            </div>
            <progress value={progress} max={100} aria-label="今日目标进度" />
          </div>
          <div className="garden-level">
            <strong>等级 {data.level}</strong>
            <span>
              {data.level_xp} / {data.level_next_xp} 经验
            </span>
            <progress
              value={Math.min(data.level_xp, data.level_next_xp)}
              max={data.level_next_xp || 1}
              aria-label="等级进度"
            />
          </div>
        </section>
        <GardenScene seconds={seconds} config={data.config} plants={creditedPlants} />
      </div>

      <section className="garden-focus-section">
        <div className="garden-section-heading">
          <h2>
            {data.active
              ? data.active.status === "break"
                ? "给自己一点休息"
                : "守住这一段时间"
              : "种下下一段专注"}
          </h2>
          <span>
            <Shield size={15} /> 安全出口始终保留
          </span>
        </div>
        {data.active ? (
          <ActiveSession key={data.active.id} session={data.active} />
        ) : (
          <StartSession />
        )}
      </section>

      {pending.length > 0 && (
        <section className="garden-reflections">
          <h2>这一段，完成得怎么样？</h2>
          {pending.map((session) => (
            <SessionReflection key={session.id} session={session} />
          ))}
        </section>
      )}

      <footer className="garden-home-note">
        <Sprout size={16} /> 每 1 分钟真实专注获得 1 点经验，完整完成另加
        10%。休息和离线时间不计入。<Link to="/statistics">看看最近的积累</Link>
      </footer>
    </div>
  );
}

function StartSession() {
  const lists = useBlockLists();
  const create = useCreateBlockList();
  const action = useGardenAction();
  const [listId, setListId] = useState("");
  const [task, setTask] = useState("");
  const [category, setCategory] = useState("阅读");
  const [minutes, setMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [strict, setStrict] = useState<Strictness>("focus");
  const selected = lists.data?.find((l) => l.id === listId)?.id ?? lists.data?.[0]?.id ?? "";
  const list = lists.data?.find((l) => l.id === selected);

  return (
    <form
      className="garden-start"
      onSubmit={(e) => {
        e.preventDefault();
        action.mutate({
          cmd: "start",
          args: {
            list_id: selected,
            task: task.trim() || category,
            category,
            work_secs: minutes * 60,
            break_secs: breakMinutes * 60,
            strict,
          },
        });
      }}
    >
      <label className="garden-task-label">
        这一段时间，想完成什么？
        <input
          autoComplete="off"
          maxLength={240}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="例如，读完这一章并整理笔记"
        />
      </label>

      {/* Category Pills & Block List Selector */}
      <div className="garden-category-row">
        <div className="garden-cat-pills" role="group" aria-label="任务类别">
          {["阅读", "听课", "写作", "编程", "复习", "其他"].map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setCategory(c)}
              className={`garden-cat-pill ${category === c ? "active" : ""}`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="garden-list-select-wrap">
          <label htmlFor="garden-block-list-select" className="garden-micro-label">
            关联屏蔽列表
          </label>
          <select
            id="garden-block-list-select"
            value={selected}
            onChange={(e) => setListId(e.target.value)}
            disabled={!lists.data?.length}
            className="garden-select"
          >
            <option value="" disabled>
              先建立一个屏蔽列表
            </option>
            {lists.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!lists.isPending && !lists.data?.length && (
        <div className="garden-inline-actions">
          <p className="garden-muted">屏蔽列表把娱乐、社交等分心来源放在一起。</p>
          <button
            type="button"
            className="garden-button secondary"
            disabled={create.isPending}
            onClick={() => create.mutate("我的专注", { onSuccess: (l) => setListId(l.id) })}
          >
            建立第一个列表
          </button>
        </div>
      )}

      {list && (
        <p className="garden-muted garden-list-hint">
          本次使用「{list.name}」中的 {list.applications.length} 个应用规则和 {list.websites.length}{" "}
          个网站规则。
          <Link className="garden-link" to="/apps">
            选择应用
          </Link>{" "}
          ·{" "}
          <Link className="garden-link" to="/websites">
            添加网站
          </Link>
          {list.applications.length + list.websites.length === 0 && " 当前列表为空，只会计时。"}
        </p>
      )}

      {/* 21st.dev Style Duration Picker */}
      <DurationPicker
        workMinutes={minutes}
        onWorkChange={setMinutes}
        breakMinutes={breakMinutes}
        onBreakChange={setBreakMinutes}
        disabled={action.isPending}
      />

      {/* 21st.dev Style Tactile Strictness Selector */}
      <div className="garden-strict-section">
        <span className="garden-section-subhead">专注强度</span>
        <StrictnessSelector
          value={strict}
          onChange={setStrict}
          disabled={action.isPending}
        />
      </div>

      <div className="garden-start-bottom">
        <p className="garden-muted">结束后保留成果。只给真正投入的时间奖励。</p>
        <button
          className="garden-button primary-action"
          type="submit"
          disabled={!selected || action.isPending || minutes < 1 || minutes > 240}
        >
          <Play size={17} /> {action.isPending ? "正在开始…" : "开始专注"}
        </button>
      </div>
      <GardenError error={action.error ?? create.error ?? lists.error} />
    </form>
  );
}

export function ActiveSession({ session }: { session: Session }) {
  const action = useGardenAction();
  const [showExit, setShowExit] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const isBreak = session.status === "break";
  const extended = session as Session & { remaining_secs?: number; break_remaining_secs?: number };
  const remaining = isBreak
    ? (extended.break_remaining_secs ?? extended.remaining_secs ?? session.break_secs)
    : session.planned_secs - session.elapsed_secs;
  const waiting = session.exit_remaining_secs > 0;
  const needsConfirm = session.strict === "deep" && !isBreak;
  const request = async () => {
    setShowExit(true);
    await action.mutateAsync({ cmd: "request_exit" }).catch(() => {});
  };

  return (
    <div className={`garden-active ${isBreak ? "is-break" : ""}`}>
      <div className="garden-active-main">
        {/* Modern 21st.dev Radial Dial */}
        <TimerRing
          totalSecs={isBreak ? session.break_secs : session.planned_secs}
          elapsedSecs={session.elapsed_secs}
          remainingSecs={remaining}
          isBreak={isBreak}
          task={session.task}
          category={session.category}
        />

        <div className="garden-active-details">
          <p className="garden-overline">
            {isBreak
              ? "本次专注已完成 · 休息时间"
              : `${strictLabels[session.strict]} · ${session.category}`}
          </p>
          <h3>{session.task}</h3>
          <p className="garden-muted">
            {isBreak
              ? "这一段成果已保存，休息结束后再开启下一段。"
              : "专注会在设定时间结束，不会自动无限循环。"}
          </p>

          <div className="garden-inline-actions">
            <span className="garden-muted">已投入 {duration(session.elapsed_secs)}</span>
            <button
              className="garden-button secondary small"
              type="button"
              disabled={action.isPending}
              onClick={request}
            >
              {isBreak ? "结束休息" : "提前结束"}
            </button>
          </div>
        </div>
      </div>

      {showExit && (
        <section className="garden-exit" aria-label="安全提前结束">
          <h4>{isBreak ? "休息结束后回到花园" : "留一点时间，再决定"}</h4>
          {waiting ? (
            <p>
              冷静期还剩 <strong>{countdown(session.exit_remaining_secs)}</strong>
              。计时与屏蔽仍在继续。
            </p>
          ) : (
            <p>{isBreak ? "已完成的专注成果会保留。" : "以前的成果会保留，本次记录为提前结束。"}</p>
          )}
          {!isBreak && (
            <label>
              结束原因
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="例如，需要处理一件紧急事情"
              />
            </label>
          )}
          {needsConfirm && (
            <label>
              输入「我确认提前结束本次专注」
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <div className="garden-inline-actions">
            <button
              className="garden-button secondary"
              type="button"
              onClick={() => setShowExit(false)}
            >
              继续当前安排
            </button>
            <button
              className="garden-button"
              type="button"
              disabled={
                action.isPending ||
                waiting ||
                (!isBreak && session.strict !== "gentle" && !reason.trim()) ||
                (needsConfirm && confirmation !== "我确认提前结束本次专注")
              }
              onClick={() =>
                action.mutate({
                  cmd: "confirm_exit",
                  args: {
                    reason: reason.trim() || (isBreak ? "结束休息" : "主动提前结束"),
                    confirmation,
                  },
                })
              }
            >
              {isBreak ? "回到花园" : "确认提前结束"}
            </button>
          </div>
        </section>
      )}
      <GardenError error={action.error} />
    </div>
  );
}

export function SessionReflection({ session }: { session: Session }) {
  const action = useGardenAction();
  return (
    <div className="garden-reflection">
      <div>
        <strong>{session.task}</strong>
        <p>
          {duration(session.elapsed_secs)} ·{" "}
          {session.status === "interrupted" ? "提前结束" : "已完成专注"} · {session.xp} 点经验
        </p>
      </div>
      <div className="garden-outcomes">
        {(["completed", "partial", "unfinished"] as Outcome[]).map((outcome) => (
          <button
            className={session.outcome === outcome ? "selected" : ""}
            type="button"
            key={outcome}
            disabled={action.isPending}
            onClick={() => action.mutate({ cmd: "set_outcome", args: { id: session.id, outcome } })}
          >
            {outcomeLabels[outcome]}
          </button>
        ))}
      </div>
      <GardenError error={action.error} />
    </div>
  );
}
