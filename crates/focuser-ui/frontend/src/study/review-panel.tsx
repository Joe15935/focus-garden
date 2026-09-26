import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { GardenError } from "@/garden/common";
import { STUDY_KEY, studyCommand } from "./api";
import * as C from "./core";
import { makeEvent } from "./hooks";
import { localToday, newId, type StudyDoc, type StudySnapshot } from "./model";

type Result = C.ReviewLog["result"];
const RESULTS: { value: Result; label: string }[] = [
  { value: "forgot", label: "忘了" },
  { value: "hard", label: "费力想起" },
  { value: "good", label: "正确" },
  { value: "easy", label: "很稳" },
];

function useReviewWrite() {
  const query = useQueryClient();
  return useMutation({
    mutationFn: async ({ card, log }: { card: C.ReviewCard; log?: C.ReviewLog }) => {
      await studyCommand("upsert_review", { card });
      // Only a closed-book, source-checked answer without prior feedback is delayed evidence.
      if (log?.closedBook && !log.afterFeedback && log.sourceChecked)
        await studyCommand("append_event", {
          event: makeEvent({
            id: log.eventId,
            date: log.date,
            task_key: `review:${card.id}`,
            kind: "retest",
            minutes: 0,
            source: `复测：${log.result}`,
          }),
        });
    },
    onSettled: () => query.invalidateQueries({ queryKey: STUDY_KEY }),
  });
}

export function ReviewPanel({ snapshot, doc }: { snapshot: StudySnapshot; doc: StudyDoc }) {
  const today = localToday();
  const rest = doc.policy.restWeekdays;
  const cards = snapshot.reviews;
  const queue = C.reviewQueue(cards, today, 20);
  const overdue = cards.filter((c) => c.dueDate <= today).length;
  const upcoming = cards
    .filter((c) => c.dueDate > today && c.dueDate <= C.addDays(today, 7))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const restToday = rest.includes(C.weekday(today));

  return (
    <div className="study-reviews">
      <section className="study-card">
        <h2>今天到期</h2>
        <p className="garden-muted">
          先闭卷回答，再翻到核对位置确认。看过答案后重新说顺，只记作反馈，不会延长间隔。
          {overdue > queue.length
            ? ` 另有 ${overdue - queue.length} 张积压，按到期先后逐天处理，不一次塞进同一天。`
            : ""}
          {restToday ? " 今天是休息日：到期卡可以留到下一个学习日，原到期日不改。" : ""}
        </p>
        {queue.length === 0 && <p className="garden-muted">今天没有到期的卡。</p>}
        {queue.map((card) => (
          <ReviewCardRow key={card.id} card={card} today={today} rest={rest} />
        ))}
      </section>

      <section className="study-card">
        <h2>加一张复习卡</h2>
        <NewCard today={today} rest={rest} />
      </section>

      <section className="study-card">
        <h2>未来 7 天</h2>
        <ul className="study-list">
          {upcoming.map((c) => (
            <li key={c.id}>
              {c.dueDate}
              {C.nextReviewStudyDate(c.dueDate, rest) !== c.dueDate
                ? `（休息日，顺延到 ${C.nextReviewStudyDate(c.dueDate, rest)} 做）`
                : ""}{" "}
              · {c.prompt}
            </li>
          ))}
          {!upcoming.length && <li className="garden-muted">暂无</li>}
        </ul>
        <p className="garden-muted">
          共 {cards.length} 张卡。间隔阶梯 1/3/7/14/30/60/90 天，是简单规则，不是记忆概率预测。
        </p>
      </section>
    </div>
  );
}

function ReviewCardRow({
  card,
  today,
  rest,
}: {
  card: C.ReviewCard;
  today: string;
  rest: number[];
}) {
  const write = useReviewWrite();
  const [reveal, setReveal] = useState(false);
  const [closedBook, setClosedBook] = useState(true);
  const [afterFeedback, setAfterFeedback] = useState(false);
  const [sourceChecked, setSourceChecked] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="study-review">
      <strong>{card.prompt}</strong>
      <small className="garden-muted">
        到期 {card.dueDate} · 阶段 {card.stage} · 已复测 {card.history.length} 次
      </small>
      {reveal ? (
        <p className="garden-muted">核对位置：{card.source}</p>
      ) : (
        <button type="button" className="garden-link" onClick={() => setReveal(true)}>
          我已闭卷回答，显示核对位置
        </button>
      )}
      <div className="garden-inline-actions">
        <label>
          <input
            type="checkbox"
            checked={closedBook}
            onChange={(e) => setClosedBook(e.target.checked)}
          />{" "}
          闭卷作答
        </label>
        <label>
          <input
            type="checkbox"
            checked={afterFeedback}
            onChange={(e) => setAfterFeedback(e.target.checked)}
          />{" "}
          回答前看过答案
        </label>
        <label>
          <input
            type="checkbox"
            checked={sourceChecked}
            onChange={(e) => setSourceChecked(e.target.checked)}
          />{" "}
          已对照来源核对
        </label>
      </div>
      <div className="garden-inline-actions">
        {RESULTS.map((r) => (
          <button
            key={r.value}
            type="button"
            className="garden-button secondary small"
            disabled={write.isPending}
            onClick={() => {
              setError(null);
              try {
                const log: C.ReviewLog = {
                  eventId: newId(),
                  date: today,
                  result: r.value,
                  closedBook,
                  afterFeedback,
                  sourceChecked,
                };
                write.mutate({ card: C.recordReview(card, log, rest), log });
              } catch (e) {
                setError(e);
              }
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      {!sourceChecked && (
        <small className="garden-muted">没核对来源时只记录作答，不延长间隔。</small>
      )}
      <GardenError error={error ?? write.error} />
    </div>
  );
}

function NewCard({ today, rest }: { today: string; rest: number[] }) {
  const write = useReviewWrite();
  const [prompt, setPrompt] = useState("");
  const [source, setSource] = useState("");
  const [due, setDue] = useState(() => C.nextReviewStudyDate(C.addDays(today, 1), rest));
  return (
    <form
      className="study-form"
      onSubmit={(e) => {
        e.preventDefault();
        const card: C.ReviewCard = {
          id: newId(),
          prompt: prompt.trim(),
          source: source.trim(),
          stage: 0,
          dueDate: due,
          history: [],
        };
        write.mutate(
          { card },
          {
            onSuccess: () => {
              setPrompt("");
              setSource("");
            },
          },
        );
      }}
    >
      <label>
        问题（只写问题，不抄答案）
        <input
          value={prompt}
          maxLength={500}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：这个制度的成立条件、法律效果和例外是什么？"
        />
      </label>
      <label>
        核对位置
        <input
          value={source}
          maxLength={300}
          onChange={(e) => setSource(e.target.value)}
          placeholder="例如：民法主书第 120 页；小本第 2 本第 15 页"
        />
      </label>
      <label>
        第一次复测 <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <button
        type="submit"
        className="garden-button small"
        disabled={!prompt.trim() || !source.trim() || write.isPending}
      >
        <Plus size={14} /> 加入
      </button>
      <GardenError error={write.error} />
    </form>
  );
}
