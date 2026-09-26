import { useEffect, useMemo, useRef, useState } from "react";
import { studyCommand, usePlan } from "./api";
import * as C from "./core";
import { mirrorHtml, mirrorIcs } from "./mirror";
import {
  acceptedPlan,
  localToday,
  planInputKey,
  planningPolicy,
  remainingLectures,
  type StudyDoc,
  type StudySnapshot,
} from "./model";
import type { PlanRequest } from "./planner";

/**
 * Keeps the phone copy current while 学习导航 is open. Writes only when the
 * content actually changed, and only into the folder the user chose.
 */
export function useMirrorSync(snapshot: StudySnapshot, doc: StudyDoc) {
  const [status, setStatus] = useState<{ at: string; error: string | null } | null>(null);
  const last = useRef("");
  const today = localToday();
  const request = useMemo<PlanRequest | null>(
    () =>
      snapshot.mirror_dir
        ? {
            kind: "week",
            semesters: doc.semesters,
            days: Array.from({ length: 7 }, (_, i) => {
              const date = C.addDays(today, i);
              return { date, policy: planningPolicy(doc, snapshot.events, date) };
            }),
          }
        : null,
    [snapshot.mirror_dir, doc, snapshot.events, today],
  );
  const response = usePlan(request);
  useEffect(() => {
    if (!snapshot.mirror_dir || response?.kind !== "week") return;
    const accepted = acceptedPlan(
      snapshot.plans,
      today,
      snapshot.revision,
      planInputKey(doc, snapshot.events, today),
    );
    const days = response.plans.map((p) => ({
      date: p.date,
      status: p.status,
      timeline:
        p.date === today && accepted && !("reset" in accepted.data)
          ? accepted.data.timeline
          : p.timeline,
      notes: p.status === "FEASIBLE" ? p.warnings : [...p.warnings, ...p.diagnostics],
    }));
    const due = snapshot.reviews
      .filter((c) => c.dueDate <= C.addDays(today, 6))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((c) => ({ prompt: c.prompt, dueDate: c.dueDate }));
    const body = { days, due, remainingLectures: remainingLectures(doc, snapshot.events) };
    const key = JSON.stringify(body);
    if (key === last.current) return;
    last.current = key;
    const generatedAt = new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour12: false,
    });
    studyCommand("mirror_write", {
      files: [
        { name: "学习导航-本周.html", content: mirrorHtml({ ...body, generatedAt }) },
        { name: "学习导航-本周.ics", content: mirrorIcs(days) },
      ],
    })
      .then(() => setStatus({ at: generatedAt, error: null }))
      .catch((e) => {
        last.current = "";
        setStatus({ at: generatedAt, error: e instanceof Error ? e.message : String(e) });
      });
  }, [response, snapshot, doc, today]);
  return status;
}
