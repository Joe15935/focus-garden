import { FilePlus2, Upload } from "lucide-react";
import { useState } from "react";
import { GardenError, GardenLoading } from "@/garden/common";
import { useStudy, useStudyAction } from "@/study/api";
import { CalendarPanel } from "@/study/calendar-panel";
import { pickText } from "@/study/hooks";
import { useMirrorStatus } from "@/study/mirror-sync";
import {
  blankDoc,
  dueReviewCount,
  localToday,
  type ParsedImport,
  parseImport,
  remainingLectures,
  type StudyDoc,
  type StudySnapshot,
} from "@/study/model";
import { ReviewPanel } from "@/study/review-panel";
import { RulesPanel } from "@/study/rules-panel";
import { TodayPanel } from "@/study/today-panel";
import "@/study/study.css";

/** File name inside the delivery package; a path, not prose. */
const SETUP_FILE = "private/user-state.json";

type Tab = "today" | "calendar" | "reviews" | "rules";
const TABS: { value: Tab; label: string }[] = [
  { value: "today", label: "今天" },
  { value: "calendar", label: "课表" },
  { value: "reviews", label: "复习" },
  { value: "rules", label: "规则与数据" },
];

export function Study() {
  const study = useStudy();
  if (study.isPending) return <GardenLoading />;
  if (!study.data)
    return (
      <div className="garden-page">
        <GardenError error={study.error} />
        <button className="garden-button" type="button" onClick={() => study.refetch()}>
          重试
        </button>
      </div>
    );
  const snapshot = study.data;
  const doc = snapshot.doc;
  if (!doc) return <Setup snapshot={snapshot} />;
  return <Navigator snapshot={snapshot} doc={doc} />;
}

function Navigator({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const [tab, setTab] = useState<Tab>("today");
  const mirror = useMirrorStatus((s) => s.status);
  const due = dueReviewCount(snapshot, localToday());
  return (
    <div className="garden-page study-page">
      <header className="garden-page-header">
        <div>
          <p className="garden-date">
            北京时间 {localToday()} · 首轮剩余 {remainingLectures(doc, snapshot.events)} 节
            {doc.progress.baselineStatus === "needs-refresh" ? "（待核对）" : ""}
          </p>
          <h1>学习导航</h1>
        </div>
      </header>
      <div className="garden-segmented">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={tab === t.value ? "selected" : ""}
            onClick={() => setTab(t.value)}
          >
            {t.label}
            {t.value === "reviews" && due > 0 ? ` · ${due}` : ""}
          </button>
        ))}
      </div>
      {tab === "today" && <TodayPanel snapshot={snapshot} doc={doc} goTo={setTab} />}
      {tab === "calendar" && <CalendarPanel snapshot={snapshot} doc={doc} />}
      {tab === "reviews" && <ReviewPanel snapshot={snapshot} doc={doc} />}
      {tab === "rules" && <RulesPanel snapshot={snapshot} doc={doc} mirror={mirror} />}
    </div>
  );
}

function Setup({ snapshot }: { snapshot: StudySnapshot }) {
  const action = useStudyAction();
  const [pending, setPending] = useState<ParsedImport | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="garden-page study-page">
      <header className="garden-page-header">
        <div>
          <p className="garden-date">第一次使用</p>
          <h1>学习导航</h1>
        </div>
      </header>
      <section className="study-card">
        <h2>先放入你的规则和课表</h2>
        <p>
          如果你有交付包里的初始配置（<code>{SETUP_FILE}</code>
          ）或以前导出的备份，直接导入。它只保存在这台 Mac，不会上传。
        </p>
        <div className="garden-inline-actions">
          <button
            type="button"
            className="garden-button"
            onClick={async () => {
              setError(null);
              try {
                const text = await pickText("json");
                if (text) setPending(parseImport(text));
              } catch (e) {
                setError(e);
              }
            }}
          >
            <Upload size={16} /> 导入初始配置或备份
          </button>
          <button
            type="button"
            className="garden-button secondary"
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                cmd: "save_doc",
                args: { expected_revision: snapshot.revision, doc: blankDoc(localToday()) },
              })
            }
          >
            <FilePlus2 size={16} /> 从空白模板开始
          </button>
        </div>
        {pending && (
          <div className="study-note">
            <p>
              {pending.kind === "reference" ? "参考版导出" : "学习导航备份"}：
              {pending.backup.doc?.semesters.map((s) => s.name).join("、") || "无学期"}；
              {pending.backup.doc
                ? `登记剩余 ${pending.backup.doc.progress.lectureBaseline} 节（需核对）；`
                : ""}
              {pending.backup.events.length} 条学习记录。
            </p>
            <div className="garden-inline-actions">
              <button
                type="button"
                className="garden-button small"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(
                    {
                      cmd: "import_backup",
                      args: { backup: pending.backup, expected_revision: snapshot.revision },
                    },
                    { onSuccess: () => setPending(null) },
                  )
                }
              >
                确认导入
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
        <GardenError error={error ?? action.error} />
        <p className="garden-muted">
          数据位置：{snapshot.data_path}。不联网、无账号、无订阅；和花园记录分开保存。
        </p>
      </section>
    </div>
  );
}
