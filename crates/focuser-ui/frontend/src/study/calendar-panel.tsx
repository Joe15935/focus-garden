import { CalendarPlus, Image as ImageIcon, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { GardenError } from "@/garden/common";
import * as C from "./core";
import { mondayOf, pickText, useSaveDoc, weekdayName } from "./hooks";
import { expandIcs, parseIcs, type RuleDraft, rulesFromOccurrences } from "./ics";
import { ImportPreview } from "./import-preview";
import { defaultSemesterId, localToday, newId, type StudyDoc, type StudySnapshot } from "./model";
import { importScreenshots } from "./screenshots";

const PLACES = C.PLACES.map((p) => ({ value: p, label: C.PLACE_NAMES[p] }));
const KINDS: { value: C.CalendarRule["kind"]; label: string }[] = [
  { value: "class", label: "上课" },
  { value: "lab", label: "实验" },
  { value: "other", label: "其他固定事项" },
];

function parseWeeks(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,，\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)[-–](\d+)$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      for (let w = Math.min(a, b); w <= Math.max(a, b); w++) out.add(w);
    } else if (/^\d+$/.test(part)) out.add(Number(part));
    else throw new Error(`周次格式无法识别：${part}`);
  }
  return [...out].sort((a, b) => a - b);
}

export function CalendarPanel({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const save = useSaveDoc(snapshot);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<{
    title: string;
    drafts: RuleDraft[];
    notes: string[];
    weeks: number[];
    confirm: boolean;
  } | null>(null);
  const [selected, setSelected] = useState(() => defaultSemesterId(doc.semesters, localToday()));
  const ordered = [...doc.semesters].sort((a, b) => a.start.localeCompare(b.start));
  const semester = doc.semesters.find((s) => s.id === selected) ?? null;
  const update = (next: C.Semester) =>
    save.mutate({ ...doc, semesters: doc.semesters.map((s) => (s.id === next.id ? next : s)) });
  const remove = (id: string) => {
    const rest = doc.semesters.filter((s) => s.id !== id);
    save.mutate(
      { ...doc, semesters: rest },
      { onSuccess: () => setSelected(defaultSemesterId(rest, localToday())) },
    );
  };

  return (
    <div className="study-calendar">
      <WeekCheck doc={doc} />
      <section className="study-card">
        <div className="study-card-head">
          <h2>学期</h2>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label="选择学期"
          >
            {ordered.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{s.vacation ? "寒暑假 · " : ""}
                {s.start} 至 {s.end}）
              </option>
            ))}
            {!doc.semesters.length && <option value="">还没有学期</option>}
          </select>
        </div>
        <p className="garden-muted">
          换学期时新建一个学期再导入课表；旧学期、课程进度、复习卡和记录都保留。没有确认的周不会被当作空闲。放寒暑假时新建一个学期并勾选「寒暑假」，那段时间就按没有课来安排。
        </p>
        <NewSemester
          onCreate={(s) => {
            save.mutate(
              { ...doc, semesters: [...doc.semesters, s] },
              { onSuccess: () => setSelected(s.id) },
            );
          }}
        />
      </section>

      {semester?.vacation && (
        <section className="study-card">
          <h2>{semester.name}</h2>
          <p className="garden-muted">
            寒暑假：{semester.start} 至 {semester.end}{" "}
            每天都按没有课来安排学习（休息日照旧）。和正式学期重叠的日子，以正式学期的课表为准。
          </p>
          <SemesterEdit
            key={`${semester.id}-${semester.start}-${semester.end}`}
            semester={semester}
            onSave={update}
            onDelete={() => remove(semester.id)}
          />
        </section>
      )}

      {semester && !semester.vacation && (
        <>
          <section className="study-card">
            <h2>{semester.name}</h2>
            <SemesterEdit
              key={`${semester.id}-${semester.start}-${semester.end}`}
              semester={semester}
              onSave={update}
              onDelete={() => remove(semester.id)}
            />
            <p className="garden-muted">
              第 1 周周一：{semester.firstMonday} · 已确认周次：
              {semester.confirmedWeeks.join("、") || "无"}
              {semester.confirmedDates.length
                ? ` · 另确认日期 ${semester.confirmedDates.join("、")}`
                : ""}
            </p>
            <ConfirmWeeks
              key={`${semester.id}-${semester.confirmedWeeks.join(",")}`}
              semester={semester}
              onSave={(weeks) => update({ ...semester, confirmedWeeks: weeks })}
              onError={setError}
            />
            {(semester.notes ?? []).map((n) => (
              <p key={n} className="garden-muted">
                · {n}
              </p>
            ))}
          </section>

          <section className="study-card">
            <div className="study-card-head">
              <h2>课程与固定事项</h2>
              <div className="garden-inline-actions">
                <button
                  type="button"
                  className="garden-button secondary small"
                  disabled={!!busy}
                  onClick={async () => {
                    setError(null);
                    setBusy("screens");
                    try {
                      const result = await importScreenshots(semester);
                      if (!result) return;
                      setPreview({
                        title: `从 ${result.shots.length} 张截图识别到 ${result.drafts.length} 条课程（请逐条核对）`,
                        drafts: result.drafts,
                        notes: result.notes,
                        weeks: result.weeks,
                        confirm: true,
                      });
                    } catch (e) {
                      setError(e);
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  <ImageIcon size={14} /> {busy === "screens" ? "正在识别…" : "从课表截图识别"}
                </button>
                <button
                  type="button"
                  className="garden-button secondary small"
                  disabled={!!busy}
                  onClick={async () => {
                    setError(null);
                    try {
                      const text = await pickText("ics");
                      if (!text) return;
                      const parsed = parseIcs(text);
                      const expanded = expandIcs(parsed.events, semester.start, semester.end);
                      const drafts = rulesFromOccurrences(
                        expanded.occurrences,
                        semester,
                        "日历文件导入，需核对",
                      );
                      setPreview({
                        title: `日历文件里有 ${expanded.occurrences.length} 次课，整理成 ${drafts.length} 条规则`,
                        drafts,
                        notes: [...parsed.warnings, ...expanded.warnings, ...expanded.skipped],
                        weeks: [...new Set(drafts.flatMap((d) => d.weeks))].sort((a, b) => a - b),
                        confirm: false,
                      });
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  <CalendarPlus size={14} /> 从日历文件导入
                </button>
                <button
                  type="button"
                  className="garden-button secondary small"
                  onClick={async () => {
                    setError(null);
                    try {
                      const text = await pickText("csv");
                      if (!text) return;
                      const rules = C.calendarRulesFromCsv(
                        text,
                        `${semester.id}-csv-${Date.now()}`,
                      );
                      update({ ...semester, rules: [...semester.rules, ...rules] });
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  <Upload size={14} /> 从 CSV 导入
                </button>
              </div>
            </div>
            <p className="garden-muted">
              CSV 表头：title,weekday,start,end,from,until,location,kind。地点只用 home / classroom
              / library / track / gym；导入的课标记为「待核对」。
            </p>
            {preview && (
              <ImportPreview
                title={preview.title}
                drafts={preview.drafts}
                semester={semester}
                notes={preview.notes}
                confirmWeeksDefault={preview.confirm}
                confirmableWeeks={preview.weeks}
                onCancel={() => setPreview(null)}
                onAdd={(rules, weeks) => {
                  update({
                    ...semester,
                    rules: [...semester.rules, ...rules],
                    confirmedWeeks: [...new Set([...semester.confirmedWeeks, ...weeks])].sort(
                      (a, b) => a - b,
                    ),
                  });
                  setPreview(null);
                }}
              />
            )}
            <table className="study-table">
              <thead>
                <tr>
                  <th>课程</th>
                  <th>时间</th>
                  <th>日期范围</th>
                  <th>地点</th>
                  <th>依据</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {semester.rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.title}
                      <small>{KINDS.find((k) => k.value === r.kind)?.label}</small>
                    </td>
                    <td>
                      {weekdayName(r.weekday)} {r.start}–{r.end}
                      {r.weeks?.length ? <small>第 {r.weeks.join("、")} 周</small> : null}
                    </td>
                    <td>{r.from === r.until ? r.from : `${r.from} 至 ${r.until}`}</td>
                    <td>
                      <select
                        value={r.location}
                        aria-label={`${r.title}的地点`}
                        onChange={(e) =>
                          update({
                            ...semester,
                            rules: semester.rules.map((x) =>
                              x.id === r.id ? { ...x, location: e.target.value as C.Place } : x,
                            ),
                          })
                        }
                      >
                        {PLACES.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="garden-link"
                        title={r.source}
                        onClick={() =>
                          update({
                            ...semester,
                            rules: semester.rules.map((x) =>
                              x.id === r.id
                                ? {
                                    ...x,
                                    evidence:
                                      x.evidence === "confirmed" ? "provisional" : "confirmed",
                                  }
                                : x,
                            ),
                          })
                        }
                      >
                        {r.evidence === "confirmed" ? "已确认" : "待核对"}
                      </button>
                    </td>
                    <td>
                      <DeleteButton
                        label={`删除${r.title}`}
                        onConfirm={() =>
                          update({
                            ...semester,
                            rules: semester.rules.filter((x) => x.id !== r.id),
                            exceptions: semester.exceptions.filter((e) => e.ruleId !== r.id),
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <NewRule
              semester={semester}
              onAdd={(r) => update({ ...semester, rules: [...semester.rules, r] })}
            />
          </section>

          <HolidaySection semester={semester} onSave={update} />
          <section className="study-card">
            <h2>单次停课、调课</h2>
            <p className="garden-muted">只影响那一天那一次课，不会推断以后每周都一样。</p>
            <ul className="study-list">
              {semester.exceptions.map((e, i) => (
                <li key={`${e.date}-${e.ruleId}-${e.action}-${e.start ?? ""}`}>
                  {e.date} · {semester.rules.find((r) => r.id === e.ruleId)?.title ?? e.ruleId} ·{" "}
                  {e.action === "cancel"
                    ? "停课"
                    : `改为 ${e.start}–${e.end}${e.location ? ` @${C.PLACE_NAMES[e.location]}` : ""}`}
                  {e.reason ? ` · ${e.reason}` : ""}{" "}
                  <DeleteButton
                    label="撤销这条例外"
                    onConfirm={() =>
                      update({
                        ...semester,
                        exceptions: semester.exceptions.filter((_, j) => j !== i),
                      })
                    }
                  />
                </li>
              ))}
              {!semester.exceptions.length && <li className="garden-muted">暂无</li>}
            </ul>
            <NewException
              semester={semester}
              onAdd={(e) => update({ ...semester, exceptions: [...semester.exceptions, e] })}
            />
          </section>
        </>
      )}
      <GardenError error={error ?? save.error} />
    </div>
  );
}

function WeekCheck({ doc }: { doc: StudyDoc }) {
  const [anchor, setAnchor] = useState(() => mondayOf(localToday()));
  const days = Array.from({ length: 7 }, (_, i) => C.addDays(anchor, i));
  return (
    <section className="study-card">
      <div className="study-card-head">
        <h2>这一周的课表状态</h2>
        <div className="garden-inline-actions">
          <button
            type="button"
            className="garden-button secondary small"
            onClick={() => setAnchor(C.addDays(anchor, -7))}
          >
            上一周
          </button>
          <button
            type="button"
            className="garden-button secondary small"
            onClick={() => setAnchor(C.addDays(anchor, 7))}
          >
            下一周
          </button>
        </div>
      </div>
      <div className="study-week">
        {days.map((d) => {
          const c = C.calendarForDate(doc.semesters, d);
          return (
            <div key={d} className={`study-day ${c.known ? "known" : "unknown"}`}>
              <strong>
                {weekdayName(C.weekday(d))} {d.slice(5)}
              </strong>
              <span>
                {c.known
                  ? `第 ${c.week} 周 · 已确认`
                  : c.week
                    ? `第 ${c.week} 周 · 待确认`
                    : "未知"}
              </span>
              {c.blocks.map((b) => (
                <small key={b.id}>
                  {C.timeText(b.start + 5)}–{C.timeText(b.end)} {b.title}
                </small>
              ))}
              {!c.blocks.length && c.known && <small>无课</small>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ConfirmWeeks({
  semester,
  onSave,
  onError,
}: {
  semester: C.Semester;
  onSave: (weeks: number[]) => void;
  onError: (e: unknown) => void;
}) {
  const [text, setText] = useState(semester.confirmedWeeks.join(","));
  return (
    <div className="garden-inline-actions">
      <label>
        已核对的周次{" "}
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="例如 4-5,9,10" />
      </label>
      <button
        type="button"
        className="garden-button secondary small"
        onClick={() => {
          try {
            onSave(parseWeeks(text));
          } catch (e) {
            onError(e);
          }
        }}
      >
        保存周次
      </button>
      <span className="garden-muted">只填你对照过课表截图/教务的周。</span>
    </div>
  );
}

/** The Monday on or before `date`, or "" when the date is not filled in yet. */
function mondayOrBlank(date: string): string {
  try {
    return mondayOf(date);
  } catch {
    return "";
  }
}

function NewSemester({ onCreate }: { onCreate: (s: C.Semester) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [firstMonday, setFirstMonday] = useState("");
  const [vacation, setVacation] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!open)
    return (
      <button type="button" className="garden-button secondary small" onClick={() => setOpen(true)}>
        <Plus size={14} /> 新建学期
      </button>
    );
  return (
    <div className="study-form">
      <label className="study-check">
        <input type="checkbox" checked={vacation} onChange={(e) => setVacation(e.target.checked)} />{" "}
        这是寒暑假（整段没有课，照常安排学习）
      </label>
      <label>
        名称{" "}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={vacation ? "例如 2027 寒假" : "例如 2027 春"}
        />
      </label>
      <label>
        开始 <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        结束 <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      {!vacation && (
        <label>
          第 1 周周一{" "}
          <input type="date" value={firstMonday} onChange={(e) => setFirstMonday(e.target.value)} />
        </label>
      )}
      {vacation && (
        <p className="garden-muted">
          结束日期不确定可以先填晚一点：之后新建的正式学期会自动接管重叠的日子。
        </p>
      )}
      <div className="garden-inline-actions">
        <button
          type="button"
          className="garden-button small"
          onClick={() => {
            const s: C.Semester = {
              id: `term-${newId().slice(0, 8)}`,
              name: name.trim() || (vacation ? "假期" : "新学期"),
              start,
              end,
              firstMonday: vacation ? mondayOrBlank(start) : firstMonday,
              confirmedWeeks: [],
              confirmedDates: [],
              rules: [],
              exceptions: [],
              notes: [],
              ...(vacation ? { vacation: true } : {}),
            };
            const errors = C.validateSemester(s);
            if (errors.length) return setError(new Error(errors.join("；")));
            onCreate(s);
            // The next "新建学期" starts from a blank form, not this term's values.
            setName("");
            setStart("");
            setEnd("");
            setFirstMonday("");
            setVacation(false);
            setError(null);
            setOpen(false);
          }}
        >
          创建
        </button>
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>
      <GardenError error={error} />
    </div>
  );
}

/** Fix a term's first or last day later, or remove a term created by mistake. */
function SemesterEdit({
  semester,
  onSave,
  onDelete,
}: {
  semester: C.Semester;
  onSave: (s: C.Semester) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(semester.start);
  const [end, setEnd] = useState(semester.end);
  const [error, setError] = useState<unknown>(null);
  if (!open)
    return (
      <div className="garden-inline-actions">
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() => {
            setStart(semester.start);
            setEnd(semester.end);
            setError(null);
            setOpen(true);
          }}
        >
          修改起止日期
        </button>
        <DeleteButton label={`删除「${semester.name}」`} onConfirm={onDelete} />
      </div>
    );
  return (
    <div className="study-form">
      <label>
        开始 <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        结束 <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <div className="garden-inline-actions">
        <button
          type="button"
          className="garden-button small"
          onClick={() => {
            const next: C.Semester = {
              ...semester,
              start,
              end,
              firstMonday: semester.vacation ? mondayOrBlank(start) : semester.firstMonday,
            };
            const errors = C.validateSemester(next);
            if (errors.length) return setError(new Error(errors.join("；")));
            onSave(next);
            setOpen(false);
          }}
        >
          保存
        </button>
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>
      <GardenError error={error} />
    </div>
  );
}

function NewRule({
  semester,
  onAdd,
}: {
  semester: C.Semester;
  onAdd: (r: C.CalendarRule) => void;
}) {
  const [open, setOpen] = useState<"" | "weekly" | "once">("");
  const [title, setTitle] = useState("");
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("09:40");
  const [from, setFrom] = useState(semester.start);
  const [until, setUntil] = useState(semester.end);
  const [location, setLocation] = useState<C.Place>("classroom");
  const [kind, setKind] = useState<C.CalendarRule["kind"]>("class");
  const [error, setError] = useState<unknown>(null);
  if (!open)
    return (
      <div className="garden-inline-actions">
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() => setOpen("weekly")}
        >
          <Plus size={14} /> 添加每周课程
        </button>
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() => {
            setKind("other");
            setOpen("once");
          }}
        >
          <Plus size={14} /> 添加单次事项（考试、报告等）
        </button>
      </div>
    );
  return (
    <div className="study-form">
      <label>
        名称 <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {open === "weekly" ? (
        <>
          <label>
            星期{" "}
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  {weekdayName(d)}
                </option>
              ))}
            </select>
          </label>
          <label>
            从 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            到 <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </>
      ) : (
        <label>
          日期 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
      )}
      <label>
        开始 <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        结束 <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <label>
        地点{" "}
        <select value={location} onChange={(e) => setLocation(e.target.value as C.Place)}>
          {PLACES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        类型{" "}
        <select value={kind} onChange={(e) => setKind(e.target.value as C.CalendarRule["kind"])}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <div className="garden-inline-actions">
        <button
          type="button"
          className="garden-button small"
          onClick={() => {
            try {
              const once = open === "once";
              const rule: C.CalendarRule = {
                id: `${semester.id}-${newId().slice(0, 8)}`,
                title: title.trim(),
                weekday: once ? C.weekday(from) : weekday,
                start,
                end,
                from,
                until: once ? from : until,
                location,
                kind,
                evidence: "confirmed",
                source: once ? "用户手动添加的单次事项" : "用户手动添加",
              };
              if (!rule.title) throw new Error("请填写名称");
              const errors = C.validateSemester({ ...semester, rules: [...semester.rules, rule] });
              if (errors.length) throw new Error(errors.join("；"));
              onAdd(rule);
              setOpen("");
              setTitle("");
            } catch (e) {
              setError(e);
            }
          }}
        >
          添加
        </button>
        <button type="button" className="garden-button secondary small" onClick={() => setOpen("")}>
          取消
        </button>
      </div>
      <GardenError error={error} />
    </div>
  );
}

function NewException({
  semester,
  onAdd,
}: {
  semester: C.Semester;
  onAdd: (e: C.CalendarException) => void;
}) {
  const [ruleId, setRuleId] = useState(semester.rules[0]?.id ?? "");
  const [date, setDate] = useState(localToday());
  const [action, setAction] = useState<"cancel" | "replace">("cancel");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState<C.Place | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  if (!semester.rules.length) return null;
  return (
    <div className="study-form">
      <label>
        课程{" "}
        <select value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
          {semester.rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}（{weekdayName(r.weekday)} {r.start}）
            </option>
          ))}
        </select>
      </label>
      <label>
        日期 <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        变化{" "}
        <select value={action} onChange={(e) => setAction(e.target.value as "cancel" | "replace")}>
          <option value="cancel">这次停课</option>
          <option value="replace">这次改时间/地点</option>
        </select>
      </label>
      {action === "replace" && (
        <>
          <label>
            开始 <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            结束 <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label>
            地点{" "}
            <select value={location} onChange={(e) => setLocation(e.target.value as C.Place | "")}>
              <option value="">不变</option>
              {PLACES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label>
        说明 <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={80} />
      </label>
      <button
        type="button"
        className="garden-button small"
        onClick={() => {
          const exception: C.CalendarException = {
            date,
            ruleId,
            action,
            reason: reason.trim() || (action === "cancel" ? "停课" : "调课"),
            ...(action === "replace" ? { start, end, ...(location ? { location } : {}) } : {}),
          };
          const errors = C.validateSemester({
            ...semester,
            exceptions: [...semester.exceptions, exception],
          });
          if (errors.length) return setError(new Error(errors.join("；")));
          setError(null);
          onAdd(exception);
        }}
      >
        添加这次变化
      </button>
      <GardenError error={error} />
    </div>
  );
}

export function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="garden-inline-actions">
      <button type="button" className="garden-button small" onClick={onConfirm}>
        确认删除
      </button>
      <button
        type="button"
        className="garden-button secondary small"
        onClick={() => setArmed(false)}
      >
        取消
      </button>
    </span>
  ) : (
    <button
      type="button"
      className="garden-icon-button"
      aria-label={label}
      onClick={() => setArmed(true)}
    >
      <Trash2 size={14} />
    </button>
  );
}

function HolidaySection({
  semester,
  onSave,
}: {
  semester: C.Semester;
  onSave: (s: C.Semester) => void;
}) {
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");
  const [swapDate, setSwapDate] = useState("");
  const [follows, setFollows] = useState("");
  const [error, setError] = useState<unknown>(null);
  const holidays = semester.holidays ?? [];
  const swaps = semester.swaps ?? [];
  const tryAdd = (next: C.Semester) => {
    const errors = C.validateSemester(next);
    if (errors.length) return setError(new Error(errors.join("；")));
    setError(null);
    onSave(next);
  };
  return (
    <section className="study-card">
      <h2>放假与补课日</h2>
      <p className="garden-muted">
        放假期间所有课取消（学习日照常，只是没有课）。补课日按另一天的课表上课，例如「周六补周三的课」。以学校正式通知为准。
      </p>
      <ul className="study-list">
        {holidays.map((h) => (
          <li key={`${h.from}-${h.until}`}>
            {h.from} 至 {h.until} · {h.reason}
            {h.source ? <small className="garden-muted"> · 依据：{h.source}</small> : null}{" "}
            <DeleteButton
              label="删除这段假期"
              onConfirm={() => onSave({ ...semester, holidays: holidays.filter((x) => x !== h) })}
            />
          </li>
        ))}
        {swaps.map((x) => (
          <li key={x.date}>
            {x.date}（{weekdayName(C.weekday(x.date))}）按 {x.followsDate}（
            {weekdayName(C.weekday(x.followsDate))}）的课表 · {x.reason}{" "}
            <DeleteButton
              label="删除这个补课日"
              onConfirm={() => onSave({ ...semester, swaps: swaps.filter((y) => y !== x) })}
            />
          </li>
        ))}
        {!holidays.length && !swaps.length && <li className="garden-muted">暂无</li>}
      </ul>
      <div className="study-form">
        <label>
          放假从 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          到 <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <label>
          名称{" "}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如 国庆节"
          />
        </label>
        <label>
          依据{" "}
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="例如 学校教务通知"
          />
        </label>
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() =>
            tryAdd({
              ...semester,
              holidays: [
                ...holidays,
                { from, until: until || from, reason: reason.trim(), source: source.trim() },
              ],
            })
          }
        >
          添加假期
        </button>
      </div>
      <div className="study-form">
        <label>
          补课日{" "}
          <input type="date" value={swapDate} onChange={(e) => setSwapDate(e.target.value)} />
        </label>
        <label>
          按哪天的课表{" "}
          <input type="date" value={follows} onChange={(e) => setFollows(e.target.value)} />
        </label>
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() =>
            tryAdd({
              ...semester,
              swaps: [...swaps, { date: swapDate, followsDate: follows, reason: "补课" }],
            })
          }
        >
          添加补课日
        </button>
      </div>
      <GardenError error={error} />
    </section>
  );
}
