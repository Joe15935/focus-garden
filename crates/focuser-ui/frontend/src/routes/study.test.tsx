import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/garden/api";
import { blankDoc, type StudyDoc, type StudySnapshot } from "@/study/model";
import { Study } from "./study";

const LIST = "12345678-1234-4123-8123-123456789abc";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/lib/commands", () => ({
  useBlockLists: () => ({
    data: [{ id: LIST, name: "学习", applications: [], websites: [] }],
    error: null,
    isPending: false,
  }),
}));
vi.mock("@/routes/dashboard", () => ({
  ActiveSession: ({ session }: { session: Session }) => <div>进行中：{session.task}</div>,
}));

function doc(): StudyDoc {
  const d = blankDoc("2026-09-26");
  d.progress.lectureBaseline = 10;
  d.semesters = [
    {
      id: "synthetic",
      name: "合成学期",
      start: "2026-09-21",
      end: "2027-01-03",
      firstMonday: "2026-08-31",
      confirmedWeeks: [4, 5, 6],
      confirmedDates: [],
      rules: [],
      exceptions: [],
    },
  ];
  d.catalog = [
    { id: "c1", subject: "民法", title: "第一讲", minutes: 40, location: "" },
    { id: "c2", subject: "民法", title: "第二讲", minutes: 65, location: "" },
    { id: "c3", subject: "民法", title: "第三讲", minutes: 55, location: "" },
  ];
  return d;
}

function snapshot(patch: Partial<StudySnapshot> = {}): StudySnapshot {
  return {
    schema_version: 1,
    revision: 3,
    doc: doc(),
    updated_at: "2026-09-26T10:00:00+08:00",
    events: [],
    reviews: [],
    links: [],
    plans: [],
    data_path: "/tmp/study.sqlite3",
    backup_dir: "/tmp/study-backups",
    backups: [],
    ...patch,
  };
}

function session(patch: Partial<Session>): Session {
  return {
    id: "s1",
    list_id: LIST,
    task: "民法·第一讲",
    category: "听课",
    started_at: "2026-09-28T08:20:00+08:00",
    local_date: "2026-09-28",
    planned_secs: 2700,
    elapsed_secs: 2700,
    break_secs: 0,
    break_remaining_secs: 0,
    strict: "focus",
    status: "completed",
    outcome: "pending",
    exit_remaining_secs: 0,
    xp: 45,
    ...patch,
  };
}

let study: StudySnapshot;
let gardenActive: Session | null;
let gardenSessions: Session[];

function backend() {
  invoke.mockImplementation(
    async (name: string, payload: { command: { cmd: string; args?: unknown } }) => {
      const { cmd } = payload.command;
      if (name === "study_command") {
        if (cmd === "snapshot") return study;
        if (cmd === "start_task") return { session_id: "new-session" };
        return null;
      }
      if (name === "garden_command") {
        if (cmd === "snapshot")
          return { active: gardenActive, sessions: gardenSessions, config: { theme: "system" } };
        return null;
      }
      throw new Error(`unexpected ${name}`);
    },
  );
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function studyCalls(cmd: string) {
  return invoke.mock.calls.filter(
    ([name, payload]) => name === "study_command" && payload.command.cmd === cmd,
  );
}

describe("学习导航 page", () => {
  beforeEach(() => {
    // Monday 2026-09-28 08:30 in Shanghai, whatever the test machine's zone.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T00:30:00Z"));
    invoke.mockReset();
    study = snapshot();
    gardenActive = null;
    gardenSessions = [];
    backend();
  });
  afterEach(() => vi.useRealTimers());

  it("first run offers import or a blank template, never a personal default", async () => {
    study = snapshot({ doc: null, revision: 0 });
    render(wrap(<Study />));
    const blank = await screen.findByRole("button", { name: /从空白模板开始/ });
    fireEvent.click(blank);
    await waitFor(() => expect(studyCalls("save_doc")).toHaveLength(1));
    const args = studyCalls("save_doc")[0]?.[1].command.args;
    expect(args.expected_revision).toBe(0);
    expect(args.doc.goal).toBeNull();
    expect(args.doc.semesters).toEqual([]);
  });

  it("shows an honest, validated plan with lectures bound to the catalogue", async () => {
    render(wrap(<Study />));
    expect(await screen.findByText(/逐项校验通过/)).toBeInTheDocument();
    expect(screen.getByText("民法·第一讲")).toBeInTheDocument();
    expect(screen.getByText("民法·第三讲")).toBeInTheDocument();
    expect(screen.getByText(/首轮剩余 10 节/)).toBeInTheDocument();
  });

  it("starting a task goes through the native start_task exactly once", async () => {
    render(wrap(<Study />));
    await screen.findByText("民法·第一讲");
    const row = screen.getByText("民法·第一讲").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /开始/ }));
    await waitFor(() => expect(studyCalls("start_task")).toHaveLength(1));
    expect(studyCalls("start_task")[0]?.[1].command.args).toMatchObject({
      occurrence_id: "2026-09-28:law-1",
      date: "2026-09-28",
      task_key: "lecture:c1",
      category: "law-video",
      minutes: 45,
      list_id: LIST,
      strict: "focus",
    });
    // The page never calls garden `start` directly.
    expect(
      invoke.mock.calls.filter(([n, p]) => n === "garden_command" && p.command.cmd === "start"),
    ).toHaveLength(0);
  });

  it("an active garden session disables starting and is shown instead", async () => {
    gardenActive = session({ status: "work", elapsed_secs: 60, task: "别的事" });
    render(wrap(<Study />));
    expect(await screen.findByText("进行中：别的事")).toBeInTheDocument();
    const row = (await screen.findByText("民法·第一讲")).closest("li") as HTMLElement;
    expect(within(row).getByRole("button", { name: /开始/ })).toBeDisabled();
  });

  it("a finished linked session asks for the result and records it with the session id", async () => {
    gardenSessions = [session({})];
    study = snapshot({
      links: [
        {
          session_id: "s1",
          occurrence_id: "2026-09-28:law-1",
          date: "2026-09-28",
          task_key: "lecture:c1",
          title: "民法·第一讲",
          minutes: 45,
          created_at: "2026-09-28T08:20:00+08:00",
        },
      ],
    });
    render(wrap(<Study />));
    const done = await screen.findByRole("button", { name: "整项完成" });
    fireEvent.click(done);
    await waitFor(() => expect(studyCalls("append_event")).toHaveLength(1));
    const event = studyCalls("append_event")[0]?.[1].command.args.event;
    expect(event).toMatchObject({
      task_key: "lecture:c1",
      kind: "watched",
      session_id: "s1",
      date: "2026-09-28",
      self_reported: true,
    });
    await waitFor(() =>
      expect(
        invoke.mock.calls.some(
          ([n, p]) => n === "garden_command" && p.command.cmd === "set_outcome",
        ),
      ).toBe(true),
    );
  });

  it("a recorded lecture shows as done and cannot be started again", async () => {
    study = snapshot({
      events: [
        {
          id: "e1",
          date: "2026-09-28",
          task_key: "lecture:c1",
          kind: "watched",
          minutes: 45,
          source: "自报",
          self_reported: true,
        },
      ],
    });
    render(wrap(<Study />));
    const row = (await screen.findByText("民法·第一讲")).closest("li") as HTMLElement;
    expect(within(row).getByText(/已记录：听完/)).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /开始/ })).toBeNull();
    expect(screen.getByText(/首轮剩余 9 节/)).toBeInTheDocument();
  });

  it("an unconfirmed week is not treated as free time", async () => {
    vi.setSystemTime(new Date("2026-10-26T00:30:00Z")); // week 9, not confirmed in the fixture
    render(wrap(<Study />));
    expect(await screen.findByText(/课表未知或未确认/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^开始/ })).toBeNull();
  });

  it("Saturday is a rest day and asks before assuming a running slot", async () => {
    vi.setSystemTime(new Date("2026-10-03T00:30:00Z"));
    render(wrap(<Study />));
    expect(await screen.findByText(/休息日：不安排备考/)).toBeInTheDocument();
  });

  it("the reviews tab only extends intervals for closed-book, source-checked answers", async () => {
    study = snapshot({
      reviews: [
        {
          id: "c",
          prompt: "成立条件？",
          source: "主书第10页",
          stage: 0,
          dueDate: "2026-09-28",
          history: [],
        },
      ],
    });
    render(wrap(<Study />));
    fireEvent.click(await screen.findByRole("button", { name: /复习/ }));
    fireEvent.click(await screen.findByRole("button", { name: "正确" }));
    await waitFor(() => expect(studyCalls("upsert_review")).toHaveLength(1));
    const card = studyCalls("upsert_review")[0]?.[1].command.args.card;
    expect(card.stage).toBe(0); // source not checked → feedback only
    expect(card.history).toHaveLength(1);
    expect(studyCalls("append_event")).toHaveLength(0);
  });
});
