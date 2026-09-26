import { useQueryClient } from "@tanstack/react-query";
import { Archive, Download, Upload } from "lucide-react";
import { useState } from "react";
import { GardenError } from "@/garden/common";
import { STUDY_KEY, studyCommand } from "./api";
import { DeleteButton } from "./calendar-panel";
import * as C from "./core";
import { pickText, saveText, useSaveDoc, weekdayName } from "./hooks";
import {
  type CatalogItem,
  type Goal,
  lectureMinutes,
  lecturePace,
  lecturesWatchedSince,
  localToday,
  newId,
  type ParsedImport,
  parseImport,
  remainingLectures,
  type StudyDoc,
  type StudySnapshot,
  summarize,
} from "./model";

export function RulesPanel({
  snapshot,
  doc,
  mirror = null,
}: {
  snapshot: StudySnapshot;
  doc: StudyDoc;
  mirror?: { at: string; error: string | null } | null;
}) {
  return (
    <div className="study-rules">
      <GoalSection snapshot={snapshot} doc={doc} />
      <ProgressSection snapshot={snapshot} doc={doc} />
      <PaceSection snapshot={snapshot} doc={doc} />
      <CatalogSection snapshot={snapshot} doc={doc} />
      <PolicySection snapshot={snapshot} doc={doc} />
      <PlaceHoursSection snapshot={snapshot} doc={doc} />
      <DayExceptions snapshot={snapshot} doc={doc} />
      <RotationSection snapshot={snapshot} doc={doc} />
      <PhoneSection snapshot={snapshot} mirror={mirror} />
      <DataSection snapshot={snapshot} doc={doc} />
    </div>
  );
}

const EMPTY_GOAL: Goal = {
  school: "",
  program: "",
  admissionCycle: null,
  initialExamYear: null,
  examDate: null,
  status: "needs-confirmation",
  source: "",
  checkedAt: null,
};

function numberOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() && Number.isInteger(n) ? n : null;
}

function GoalSection({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const save = useSaveDoc(snapshot);
  const [goal, setGoal] = useState<Goal>(doc.goal ?? EMPTY_GOAL);
  const today = localToday();
  const countdown =
    doc.goal?.status === "confirmed" && doc.goal.examDate
      ? C.daysBetween(today, doc.goal.examDate)
      : null;
  return (
    <section className="study-card">
      <h2>目标</h2>
      <p className="garden-muted">
        只填你确认过的信息。考试日期只填官方公布的；没有就留空，不显示倒计时。
        {countdown !== null && countdown >= 0 ? ` 距初试 ${countdown} 天。` : ""}
      </p>
      {doc.goal?.status !== "confirmed" && (
        <p className="study-note warning">
          目标年份和招生周期还没有确认，软件不会据此自动调整阶段。
        </p>
      )}
      <div className="study-form">
        <label>
          学校{" "}
          <input
            value={goal.school}
            onChange={(e) => setGoal({ ...goal, school: e.target.value })}
          />
        </label>
        <label>
          专业{" "}
          <input
            value={goal.program}
            onChange={(e) => setGoal({ ...goal, program: e.target.value })}
          />
        </label>
        <label>
          初试年份{" "}
          <input
            inputMode="numeric"
            value={goal.initialExamYear ?? ""}
            onChange={(e) => setGoal({ ...goal, initialExamYear: numberOrNull(e.target.value) })}
          />
        </label>
        <label>
          入学年级{" "}
          <input
            inputMode="numeric"
            value={goal.admissionCycle ?? ""}
            onChange={(e) => setGoal({ ...goal, admissionCycle: numberOrNull(e.target.value) })}
          />
        </label>
        <label>
          官方初试日期{" "}
          <input
            type="date"
            value={goal.examDate ?? ""}
            onChange={(e) => setGoal({ ...goal, examDate: e.target.value || null })}
          />
        </label>
        <label>
          来源{" "}
          <input
            value={goal.source}
            onChange={(e) => setGoal({ ...goal, source: e.target.value })}
            placeholder="例如：研招网某年公告"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={goal.status === "confirmed"}
            onChange={(e) =>
              setGoal({
                ...goal,
                status: e.target.checked ? "confirmed" : "needs-confirmation",
                checkedAt: e.target.checked ? today : goal.checkedAt,
              })
            }
          />{" "}
          我已核对以上年份与信息
        </label>
        <button
          type="button"
          className="garden-button small"
          disabled={save.isPending}
          onClick={() => save.mutate({ ...doc, goal })}
        >
          保存目标
        </button>
      </div>
      <GardenError error={save.error} />
    </section>
  );
}

function ProgressSection({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const save = useSaveDoc(snapshot);
  const [count, setCount] = useState(String(remainingLectures(doc, snapshot.events)));
  const [confirmPhase, setConfirmPhase] = useState(false);
  const today = localToday();
  const remaining = remainingLectures(doc, snapshot.events);
  const watched = lecturesWatchedSince(snapshot.events, doc.progress.baselineDate);
  const phase = doc.policy.phase;
  return (
    <section className="study-card">
      <h2>首轮进度与阶段</h2>
      <p>
        剩余 <strong>{remaining}</strong> 节（{doc.progress.baselineDate} 登记{" "}
        {doc.progress.lectureBaseline} 节，之后听完 {watched} 节）
        {doc.progress.baselineStatus === "needs-refresh" && (
          <span className="study-badge">需要重新核对</span>
        )}
      </p>
      <div className="garden-inline-actions">
        <label>
          现在实际剩余{" "}
          <input
            className="study-number"
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />{" "}
          节
        </label>
        <button
          type="button"
          className="garden-button secondary small"
          disabled={save.isPending || !/^\d+$/.test(count)}
          onClick={() =>
            save.mutate({
              ...doc,
              progress: {
                lectureBaseline: Number(count),
                baselineDate: today,
                baselineStatus: "confirmed",
              },
            })
          }
        >
          以今天为准重新登记
        </button>
      </div>
      <p className="garden-muted">
        当前阶段：
        {phase === "first-pass"
          ? "首轮听课（每个学习日三节新课）"
          : "三个法律训练块（不是视频，不计课数）"}
      </p>
      {phase === "first-pass" ? (
        <div className="garden-inline-actions">
          <label>
            <input
              type="checkbox"
              checked={confirmPhase}
              onChange={(e) => setConfirmPhase(e.target.checked)}
            />{" "}
            我确认首轮已经完成，下一阶段每个学习日三个法律训练块（提取、做题、主观输出），不再重听视频
          </label>
          <button
            type="button"
            className="garden-button small"
            disabled={!confirmPhase || save.isPending}
            onClick={() =>
              save.mutate({
                ...doc,
                policy: { ...doc.policy, phase: "three-block-review" },
                phaseHistory: [
                  ...doc.phaseHistory,
                  {
                    phase: "three-block-review",
                    confirmedAt: new Date().toISOString(),
                    note: "用户在规则页确认",
                  },
                ],
              })
            }
          >
            进入下一阶段
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="garden-button secondary small"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              ...doc,
              policy: { ...doc.policy, phase: "first-pass" },
              phaseHistory: [
                ...doc.phaseHistory,
                {
                  phase: "first-pass",
                  confirmedAt: new Date().toISOString(),
                  note: "用户撤回阶段切换",
                },
              ],
            })
          }
        >
          撤回，回到首轮
        </button>
      )}
      {doc.phaseHistory.length > 0 && (
        <ul className="study-list">
          {doc.phaseHistory.map((h) => (
            <li key={h.confirmedAt} className="garden-muted">
              {h.confirmedAt.slice(0, 10)} · {h.phase === "first-pass" ? "首轮" : "三个训练块"} ·{" "}
              {h.note}
            </li>
          ))}
        </ul>
      )}
      <GardenError error={save.error} />
    </section>
  );
}

function CatalogSection({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const save = useSaveDoc(snapshot);
  const [text, setText] = useState("");
  const watched = new Set(
    snapshot.events.filter((e) => e.kind === "watched").map((e) => e.task_key),
  );
  const pending = doc.catalog.filter((c) => !watched.has(`lecture:${c.id}`));
  const parse = (): CatalogItem[] =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [a, b, c, d] = line.split(/[|｜\t]/).map((x) => x.trim());
        const hasSubject = b !== undefined && b !== "";
        const minutes = Number(hasSubject ? c : b);
        return {
          id: newId(),
          subject: hasSubject ? (a ?? "") : "",
          title: (hasSubject ? b : a) ?? "",
          minutes: Number.isInteger(minutes) && minutes > 0 ? minutes : null,
          location: (hasSubject ? d : c) ?? "",
        };
      });
  let preview: CatalogItem[] = [];
  try {
    preview = parse();
  } catch {
    preview = [];
  }
  return (
    <section className="study-card">
      <h2>课程目录</h2>
      <p className="garden-muted">
        共 {doc.catalog.length} 节，未听 {pending.length}{" "}
        节。每天的三节按目录顺序绑定下一节未听的课。 没有目录时显示「待绑定」，不编造课名。
      </p>
      {pending.length > 0 && (
        <ol className="study-list">
          {pending.slice(0, 5).map((c) => (
            <li key={c.id}>
              {c.subject ? `${c.subject}·` : ""}
              {c.title}
              {c.minutes ? ` · ${c.minutes} 分钟` : ""}
              {c.location ? ` · ${c.location}` : ""}{" "}
              <DeleteButton
                label={`从目录删除${c.title}`}
                onConfirm={() =>
                  save.mutate({ ...doc, catalog: doc.catalog.filter((x) => x.id !== c.id) })
                }
              />
            </li>
          ))}
          {pending.length > 5 && <li className="garden-muted">……还有 {pending.length - 5} 节</li>}
        </ol>
      )}
      <label>
        粘贴课程列表（每行一节：科目|课名|分钟|位置，科目、分钟、位置可省略）
        <textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"民法|第一讲 民法总论|48|某平台课程第1集\n刑法|第一讲 犯罪构成|55"}
        />
      </label>
      <button
        type="button"
        className="garden-button small"
        disabled={!preview.length || preview.some((p) => !p.title) || save.isPending}
        onClick={() =>
          save.mutate(
            { ...doc, catalog: [...doc.catalog, ...preview] },
            { onSuccess: () => setText("") },
          )
        }
      >
        添加 {preview.length} 节到目录末尾
      </button>
      <GardenError error={save.error} />
    </section>
  );
}

type NumberKey =
  | "travelMinutes"
  | "lectureOverhead"
  | "breakfastMinutes"
  | "dinnerMinutes"
  | "reviewMinutes"
  | "practiceMinutes"
  | "oralMinutes"
  | "gymMinutes";
const NUMBER_FIELDS: { key: NumberKey; label: string }[] = [
  { key: "travelMinutes", label: "两地之间移动" },
  { key: "lectureOverhead", label: "每节暂停整理" },
  { key: "breakfastMinutes", label: "早餐洗漱" },
  { key: "dinnerMinutes", label: "晚饭" },
  { key: "reviewMinutes", label: "旧知识闭卷复习" },
  { key: "practiceMinutes", label: "对应题目订正" },
  { key: "oralMinutes", label: "闭卷口述" },
  { key: "gymMinutes", label: "健身" },
];

function PolicySection({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const save = useSaveDoc(snapshot);
  const [p, setP] = useState<C.Policy>(doc.policy);
  const [lunchConfirmed, setLunchConfirmed] = useState(false);
  const [countConfirmed, setCountConfirmed] = useState(false);
  const lunchChanged = p.lunchMinutes !== doc.policy.lunchMinutes;
  const countChanged = p.lecturesPerStudyDay !== doc.policy.lecturesPerStudyDay;
  const toggle = (list: number[], d: number) =>
    list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort();
  return (
    <section className="study-card">
      <h2>作息与时长</h2>
      <p className="garden-muted">
        这些是可以校准的初值。改动保存为新版本，今天以后的安排按新规则计算，过去的记录不变。
      </p>
      <div className="study-form grid">
        <label>
          起床{" "}
          <input
            type="time"
            value={p.wake}
            onChange={(e) => setP({ ...p, wake: e.target.value })}
          />
        </label>
        <label>
          就寝{" "}
          <input
            type="time"
            value={p.sleep}
            onChange={(e) => setP({ ...p, sleep: e.target.value })}
          />
        </label>
        {NUMBER_FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}（分钟）{" "}
            <input
              className="study-number"
              type="number"
              value={p[f.key]}
              onChange={(e) => setP({ ...p, [f.key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <label>
          午饭午休（分钟）{" "}
          <input
            className="study-number"
            type="number"
            value={p.lunchMinutes}
            onChange={(e) => setP({ ...p, lunchMinutes: Number(e.target.value) })}
          />
        </label>
        <label>
          每个学习日新课数{" "}
          <input
            className="study-number"
            type="number"
            min={0}
            max={12}
            value={p.lecturesPerStudyDay}
            onChange={(e) => {
              const n = Math.max(0, Math.min(12, Number(e.target.value) || 0));
              const durations = Array.from({ length: n }, (_, i) => p.lectureDurations[i] ?? 50);
              setP({ ...p, lecturesPerStudyDay: n, lectureDurations: durations });
            }}
          />
        </label>
        <label>
          每节预计时长（没有目录时长时使用，用逗号分隔）{" "}
          <input
            value={p.lectureDurations.join(",")}
            onChange={(e) =>
              setP({
                ...p,
                lectureDurations: e.target.value
                  .split(/[,，\s]+/)
                  .filter(Boolean)
                  .map(Number),
              })
            }
          />
        </label>
      </div>
      <div className="garden-inline-actions">
        <span className="garden-muted">不备考的日子：</span>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <label key={d}>
            <input
              type="checkbox"
              checked={p.restWeekdays.includes(d)}
              onChange={() => setP({ ...p, restWeekdays: toggle(p.restWeekdays, d) })}
            />{" "}
            {weekdayName(d)}
          </label>
        ))}
      </div>
      <div className="garden-inline-actions">
        <span className="garden-muted">尝试安排健身：</span>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <label key={d}>
            <input
              type="checkbox"
              checked={p.gymWeekdays.includes(d)}
              onChange={() => setP({ ...p, gymWeekdays: toggle(p.gymWeekdays, d) })}
            />{" "}
            {weekdayName(d)}
          </label>
        ))}
      </div>
      <div className="garden-inline-actions">
        <span className="garden-muted">可以学习的地点：</span>
        {(["library", "home"] as C.Place[]).map((place) => (
          <label key={place}>
            <input
              type="checkbox"
              checked={p.studyPlaces.includes(place)}
              onChange={() =>
                setP({
                  ...p,
                  studyPlaces: p.studyPlaces.includes(place)
                    ? p.studyPlaces.filter((x) => x !== place)
                    : [...p.studyPlaces, place],
                })
              }
            />{" "}
            {C.PLACE_NAMES[place]}
          </label>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={!!p.dropLecturesWhenFull}
          onChange={(e) => setP({ ...p, dropLecturesWhenFull: e.target.checked })}
        />{" "}
        某天放不下完整安排时，那天直接不排新课（其余照排，不补到别的日子）
      </label>
      {lunchChanged && (
        <label className="study-note warning">
          <input
            type="checkbox"
            checked={lunchConfirmed}
            onChange={(e) => setLunchConfirmed(e.target.checked)}
          />{" "}
          我确认长期把午休从 {doc.policy.lunchMinutes} 改为 {p.lunchMinutes}{" "}
          分钟（只想改某一天，请用下面的「单日例外」）
        </label>
      )}
      {countChanged && (
        <label className="study-note warning">
          <input
            type="checkbox"
            checked={countConfirmed}
            onChange={(e) => setCountConfirmed(e.target.checked)}
          />{" "}
          我确认把每日新课从 {doc.policy.lecturesPerStudyDay} 节改为 {p.lecturesPerStudyDay} 节
        </label>
      )}
      <div className="garden-inline-actions">
        <button
          type="button"
          className="garden-button small"
          disabled={
            save.isPending || (lunchChanged && !lunchConfirmed) || (countChanged && !countConfirmed)
          }
          onClick={() => save.mutate({ ...doc, policy: p })}
        >
          保存规则
        </button>
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() => setP(doc.policy)}
        >
          放弃修改
        </button>
      </div>
      <GardenError error={save.error} />
    </section>
  );
}

function DayExceptions({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const save = useSaveDoc(snapshot);
  const [date, setDate] = useState(localToday());
  const [lunch, setLunch] = useState(90);
  const entries = Object.entries(doc.policy.confirmedExceptions).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <section className="study-card">
      <h2>单日例外</h2>
      <p className="garden-muted">只改那一天，到期后不影响其他日子；随时可以撤销。</p>
      <ul className="study-list">
        {entries.map(([d, o]) => (
          <li key={d}>
            {d} · {o.lunchMinutes ? `午休 ${o.lunchMinutes} 分钟` : JSON.stringify(o)}{" "}
            <DeleteButton
              label="撤销这天的例外"
              onConfirm={() => {
                const next = { ...doc.policy.confirmedExceptions };
                delete next[d];
                save.mutate({ ...doc, policy: { ...doc.policy, confirmedExceptions: next } });
              }}
            />
          </li>
        ))}
        {!entries.length && <li className="garden-muted">暂无</li>}
      </ul>
      <div className="garden-inline-actions">
        <label>
          日期 <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          这天午休{" "}
          <select value={lunch} onChange={(e) => setLunch(Number(e.target.value))}>
            {[60, 75, 90, 105].map((m) => (
              <option key={m} value={m}>
                {m} 分钟
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="garden-button secondary small"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              ...doc,
              policy: {
                ...doc.policy,
                confirmedExceptions: {
                  ...doc.policy.confirmedExceptions,
                  [date]: { lunchMinutes: lunch },
                },
              },
            })
          }
        >
          我确认这一天这样安排
        </button>
      </div>
      <GardenError error={save.error} />
    </section>
  );
}

function RotationSection({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const save = useSaveDoc(snapshot);
  const [r, setR] = useState(doc.englishRotation);
  const field = (key: keyof typeof r, label: string) => (
    <label>
      {label}{" "}
      <input
        value={r[key].join("、")}
        onChange={(e) =>
          setR({
            ...r,
            [key]: e.target.value
              .split(/[、,，]/)
              .map((x) => x.trim())
              .filter(Boolean),
          })
        }
      />
    </label>
  );
  return (
    <section className="study-card">
      <h2>英语题型轮换</h2>
      <p className="garden-muted">
        按实际完成往下轮：哪天没做，下次还是同一种题型，不会被日历跳过。
      </p>
      <div className="study-form">
        {field("listening", "听力")}
        {field("reading", "阅读")}
        {field("output", "输出")}
        <button
          type="button"
          className="garden-button small"
          disabled={save.isPending}
          onClick={() => save.mutate({ ...doc, englishRotation: r })}
        >
          保存轮换
        </button>
      </div>
      <GardenError error={save.error} />
    </section>
  );
}

function DataSection({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const query = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<ParsedImport | null>(null);
  const [restoring, setRestoring] = useState("");
  const refresh = () => query.invalidateQueries({ queryKey: STUDY_KEY });
  const all = summarize(snapshot.events, "0000-01-01", "9999-12-31");
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    setMessage("");
    try {
      await fn();
      setMessage(done);
      await refresh();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section className="study-card">
      <h2>数据与备份</h2>
      <p className="garden-muted">
        全部保存在这台 Mac：{snapshot.data_path}。每天第一次打开自动备份一次、每周一次，保留最近 7
        份日备份和 4 份周备份；导入和恢复前都会先额外备份。不联网、不需要账号。
      </p>
      <p className="garden-muted">
        累计：{snapshot.events.length} 条学习记录 · {snapshot.reviews.length} 张复习卡 ·{" "}
        {snapshot.links.length} 次专注关联 · 记录分钟 {all.minutes} · 数据版本 {snapshot.revision}
      </p>
      <div className="garden-inline-actions">
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() => run(() => studyCommand("backup_now"), "已备份。")}
        >
          <Archive size={14} /> 立即备份
        </button>
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() =>
            run(async () => {
              const backup = await studyCommand("export_backup");
              const path = await saveText(
                JSON.stringify(backup, null, 2),
                `学习导航备份-${localToday()}.json`,
                "json",
              );
              if (!path) throw new Error("已取消导出。");
            }, "已导出。这个 JSON 没有加密，拿到文件的人可以读到内容。")
          }
        >
          <Download size={14} /> 导出 JSON
        </button>
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() =>
            run(async () => {
              const text = await pickText("json");
              if (!text) return;
              setPending(parseImport(text));
            }, "")
          }
        >
          <Upload size={14} /> 导入 JSON…
        </button>
      </div>
      {pending && (
        <div className="study-note warning">
          <p>
            {pending.kind === "reference" ? "参考版导出" : "学习导航备份"}：
            {pending.backup.doc?.semesters.length ?? 0} 个学期、{pending.backup.events.length}{" "}
            条记录、{pending.backup.reviews.length} 张复习卡
            {pending.backup.doc
              ? `，登记剩余 ${pending.backup.doc.progress.lectureBaseline} 节`
              : ""}
            。 导入会<strong>替换</strong>当前学习导航数据（当前 {snapshot.events.length}{" "}
            条记录），替换前自动备份。花园记录不受影响。
          </p>
          <div className="garden-inline-actions">
            <button
              type="button"
              className="garden-button small"
              onClick={() =>
                run(async () => {
                  await studyCommand("import_backup", {
                    backup: pending.backup,
                    expected_revision: snapshot.revision,
                  });
                  setPending(null);
                }, "已导入。")
              }
            >
              确认替换
            </button>
            <button
              type="button"
              className="garden-button secondary small"
              onClick={() => setPending(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
      <h3>本机备份</h3>
      <ul className="study-list">
        {snapshot.backups.map((b) => (
          <li key={b.file_name}>
            {b.modified.slice(0, 16).replace("T", " ")} · {BACKUP_KIND[b.kind] ?? b.kind} ·{" "}
            {Math.ceil(b.bytes / 1024)} KB{" "}
            {restoring === b.file_name ? (
              <span className="garden-inline-actions">
                <button
                  type="button"
                  className="garden-button small"
                  onClick={() =>
                    run(async () => {
                      await studyCommand("restore_backup", {
                        file_name: b.file_name,
                        expected_revision: snapshot.revision,
                      });
                      setRestoring("");
                    }, "已恢复。恢复前的数据另存为一份备份。")
                  }
                >
                  确认用这份替换当前数据
                </button>
                <button
                  type="button"
                  className="garden-button secondary small"
                  onClick={() => setRestoring("")}
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="garden-link"
                onClick={() => setRestoring(b.file_name)}
              >
                恢复
              </button>
            )}
          </li>
        ))}
        {!snapshot.backups.length && <li className="garden-muted">还没有备份</li>}
      </ul>
      <p className="garden-muted">备份文件夹：{snapshot.backup_dir}</p>
      {message && <p className="study-note">{message}</p>}
      <GardenError error={error} />
      <p className="garden-muted">
        当前规则版本保存于 {snapshot.updated_at?.slice(0, 16).replace("T", " ") ?? "—"}；共{" "}
        {doc.semesters.length} 个学期。
      </p>
    </section>
  );
}

const BACKUP_KIND: Record<string, string> = {
  daily: "每日",
  weekly: "每周",
  manual: "手动",
  "pre-import": "导入前",
  "pre-restore": "恢复前",
};

function PlaceHoursSection({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const save = useSaveDoc(snapshot);
  const initial = () =>
    Object.fromEntries(
      C.PLACES.map((place) => {
        const w = doc.policy.placeHours?.[place]?.[0];
        return [place, w ? { open: C.timeText(w.start), close: C.timeText(w.end) } : null];
      }),
    ) as Record<C.Place, { open: string; close: string } | null>;
  const [hours, setHours] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  return (
    <section className="study-card">
      <h2>地点开放时间</h2>
      <p className="garden-muted">
        安排只会把任务放进地点开放的时间里；图书馆关门后的任务会改到住所，或者如实提示排不下。上课和实验不受这里限制。
      </p>
      <div className="study-form grid">
        {C.PLACES.map((place) => {
          const h = hours[place];
          return (
            <div key={place} className="study-hours">
              <strong>{C.PLACE_NAMES[place]}</strong>
              <label>
                <input
                  type="checkbox"
                  checked={!h}
                  onChange={(e) =>
                    setHours({
                      ...hours,
                      [place]: e.target.checked ? null : { open: "08:00", close: "22:00" },
                    })
                  }
                />{" "}
                全天可用
              </label>
              {h && (
                <span className="garden-inline-actions">
                  <input
                    type="time"
                    aria-label={`${C.PLACE_NAMES[place]}开门`}
                    value={h.open}
                    onChange={(e) =>
                      setHours({ ...hours, [place]: { ...h, open: e.target.value } })
                    }
                  />
                  –
                  <input
                    type="time"
                    aria-label={`${C.PLACE_NAMES[place]}关门`}
                    value={h.close}
                    onChange={(e) =>
                      setHours({ ...hours, [place]: { ...h, close: e.target.value } })
                    }
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="garden-button small"
        disabled={save.isPending}
        onClick={() => {
          setError(null);
          try {
            const placeHours: NonNullable<C.Policy["placeHours"]> = {};
            for (const place of C.PLACES) {
              const h = hours[place];
              if (h)
                placeHours[place] = [{ start: C.parseTime(h.open), end: C.parseTime(h.close) }];
            }
            save.mutate({ ...doc, policy: { ...doc.policy, placeHours } });
          } catch (e) {
            setError(e);
          }
        }}
      >
        保存开放时间
      </button>
      <GardenError error={error ?? save.error} />
    </section>
  );
}

function PhoneSection({
  snapshot,
  mirror,
}: {
  snapshot: StudySnapshot;
  mirror: { at: string; error: string | null } | null;
}) {
  const query = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const refresh = () => query.invalidateQueries({ queryKey: STUDY_KEY });
  return (
    <section className="study-card">
      <h2>在手机上查看</h2>
      <p className="garden-muted">
        选一个 iPhone 也能打开的文件夹（例如 iCloud 云盘里的一个文件夹）。打开学习导航时，会把未来 7
        天的安排和到期复习写成「学习导航-本周.html」，在 iPhone 的「文件」App 里点开即可查看。
        这是只读副本：记录仍在 Mac 上做，不需要账号、服务器或订阅。
      </p>
      <p className="garden-muted">
        同一文件夹里还有「学习导航-本周.ics」，可以手动添加到日历；但每次添加都会新增一份，重复导入会出现重复日程，所以日常建议只看
        HTML。
      </p>
      {snapshot.mirror_dir ? (
        <p>
          正在写入：{snapshot.mirror_dir}
          {mirror && !mirror.error ? (
            <small className="garden-muted"> · 最近更新 {mirror.at}</small>
          ) : null}
        </p>
      ) : (
        <p className="garden-muted">还没有选择文件夹。</p>
      )}
      {mirror?.error && <p className="garden-error">{mirror.error}</p>}
      <div className="garden-inline-actions">
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() => studyCommand("mirror_choose").then(refresh).catch(setError)}
        >
          {snapshot.mirror_dir ? "换一个文件夹" : "选择文件夹"}
        </button>
        {snapshot.mirror_dir && (
          <button
            type="button"
            className="garden-button secondary small"
            onClick={() => studyCommand("mirror_clear").then(refresh).catch(setError)}
          >
            停止写入
          </button>
        )}
      </div>
      <GardenError error={error} />
    </section>
  );
}

function PaceSection({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const save = useSaveDoc(snapshot);
  const today = localToday();
  const pace = lecturePace(doc, snapshot.events, today);
  const samples = lectureMinutes(snapshot.events);
  const planned = (doc.policy.lectureDurations[0] ?? 50) + doc.policy.lectureOverhead;
  const estimate = C.estimateMinutes(samples, planned);
  const suggestion =
    estimate.sampleCount >= 3 ? estimate.minutes - doc.policy.lectureOverhead : null;
  return (
    <section className="study-card">
      <h2>节奏与用时（估算）</h2>
      <p>
        按计划节奏（每周 {pace.plannedPerWeek} 节），首轮大约在{" "}
        <strong>{pace.finishAtPlannedPace ?? "—"}</strong> 听完。
        {pace.recentPerStudyDay === null
          ? ` 最近学习日还不够 5 天，暂不按实际节奏估算。`
          : ` 按最近 ${pace.recentDays} 个学习日的实际节奏（每天约 ${pace.recentPerStudyDay.toFixed(1)} 节），大约在 ${
              pace.finishAtRecentPace ?? "很久以后"
            }。`}
      </p>
      <p className="garden-muted">
        这是按剩余课数的直线推算，不是保证；遇到长课、考试周或补课都会变化。阶段切换仍然需要你确认。
      </p>
      <p>
        每节听课实际用时：{samples.length ? `已有 ${samples.length} 节记录` : "还没有记录"}。
        {estimate.basis}。 当前按每节 {planned} 分钟（{doc.policy.lectureDurations[0] ?? 50} + 整理{" "}
        {doc.policy.lectureOverhead}）安排。
      </p>
      {suggestion !== null &&
        suggestion !== doc.policy.lectureDurations[0] &&
        suggestion >= 1 &&
        suggestion <= 300 && (
          <button
            type="button"
            className="garden-button secondary small"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                ...doc,
                policy: {
                  ...doc.policy,
                  lectureDurations: doc.policy.lectureDurations.map(() => suggestion),
                },
              })
            }
          >
            按实际用时改为每节 {suggestion} 分钟（没有目录时长的课）
          </button>
        )}
      <GardenError error={save.error} />
    </section>
  );
}
