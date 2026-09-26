import { useState } from "react";
import * as C from "./core";
import { weekdayName } from "./hooks";
import type { RuleDraft } from "./ics";

const PLACES = C.PLACES.map((p) => ({ value: p, label: C.PLACE_NAMES[p] }));

function weeksText(weeks: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < weeks.length) {
    let j = i;
    while (j + 1 < weeks.length && weeks[j + 1] === (weeks[j] ?? 0) + 1) j++;
    parts.push(i === j ? `${weeks[i]}` : `${weeks[i]}-${weeks[j]}`);
    i = j + 1;
  }
  return parts.join(",");
}

/**
 * Shared preview for imported rules (from .ics or screenshots). Nothing is
 * saved until the user presses the add button; every row can be dropped or
 * have its place corrected first.
 */
export function ImportPreview({
  title,
  drafts: initial,
  semester,
  notes,
  confirmWeeksDefault,
  confirmableWeeks,
  onCancel,
  onAdd,
}: {
  title: string;
  drafts: RuleDraft[];
  semester: C.Semester;
  notes: string[];
  confirmWeeksDefault: boolean;
  confirmableWeeks: number[];
  onCancel: () => void;
  onAdd: (rules: C.CalendarRule[], confirmWeeks: number[]) => void;
}) {
  const [drafts, setDrafts] = useState(initial);
  const [confirm, setConfirm] = useState(confirmWeeksDefault);
  const set = (key: string, patch: Partial<RuleDraft>) =>
    setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const duplicate = (r: C.CalendarRule) =>
    semester.rules.some(
      (x) =>
        x.title === r.title && x.weekday === r.weekday && x.start === r.start && x.end === r.end,
    );
  const chosen = drafts.filter((d) => d.include);
  return (
    <div className="study-note">
      <strong>{title}</strong>
      {notes.map((n) => (
        <p key={n} className="garden-muted">
          {n}
        </p>
      ))}
      <table className="study-table">
        <thead>
          <tr>
            <th>导入</th>
            <th>课程</th>
            <th>时间</th>
            <th>教学周</th>
            <th>地点</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((d) => (
            <tr key={d.key}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`导入${d.rule.title}`}
                  checked={d.include}
                  onChange={(e) => set(d.key, { include: e.target.checked })}
                />
              </td>
              <td>
                <input
                  value={d.rule.title}
                  aria-label="课程名称"
                  onChange={(e) => set(d.key, { rule: { ...d.rule, title: e.target.value } })}
                />
                {duplicate(d.rule) && <small>学期里已有同名同时段的课，可能重复</small>}
                {d.rule.source.includes("需核对") && <small>{d.rule.source}</small>}
              </td>
              <td>
                {weekdayName(d.rule.weekday)} {d.rule.start}–{d.rule.end}
              </td>
              <td>{d.weeks.length ? weeksText(d.weeks) : `${d.rule.from} 至 ${d.rule.until}`}</td>
              <td>
                <select
                  value={d.rule.location}
                  aria-label={`${d.rule.title}的地点`}
                  onChange={(e) =>
                    set(d.key, { rule: { ...d.rule, location: e.target.value as C.Place } })
                  }
                >
                  {PLACES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {d.locationText && <small>{d.locationText}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {confirmableWeeks.length > 0 && (
        <label>
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />{" "}
          同时把第 {weeksText(confirmableWeeks)}{" "}
          周标记为「已核对」（只在你确认这些周的课都在上面时勾选）
        </label>
      )}
      <div className="garden-inline-actions">
        <button type="button" className="garden-button secondary small" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="garden-button small"
          disabled={!chosen.length || chosen.some((d) => !d.rule.title.trim())}
          onClick={() =>
            onAdd(
              chosen.map((d) => d.rule),
              confirm ? confirmableWeeks : [],
            )
          }
        >
          添加 {chosen.length} 条到「{semester.name}」
        </button>
      </div>
    </div>
  );
}
