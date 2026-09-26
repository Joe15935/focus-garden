import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyBackground } from "./mirror-sync";
import { blankDoc, type StudySnapshot } from "./model";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function snapshot(): StudySnapshot {
  const doc = blankDoc("2026-09-26");
  doc.progress.lectureBaseline = 10;
  doc.semesters = [
    {
      id: "t",
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
  return {
    schema_version: 1,
    revision: 1,
    doc,
    updated_at: "2026-09-26T10:00:00+08:00",
    events: [],
    reviews: [],
    links: [],
    plans: [],
    data_path: "/tmp/study.sqlite3",
    backup_dir: "/tmp/study-backups",
    backups: [],
    mirror_dir: "/tmp/phone",
  };
}

function calls(cmd: string) {
  return invoke.mock.calls.filter(([, payload]) => payload.command.cmd === cmd);
}

// StudyBackground renders nothing, so wait with vi.waitFor: it drives the fake
// interval clock, unlike DOM-mutation based helpers.
describe("phone copy while the window stays hidden", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-09-28T15:59:50Z")); // Monday 23:59:50 in Shanghai
    invoke.mockReset();
    invoke.mockImplementation(async (_name: string, payload: { command: { cmd: string } }) =>
      payload.command.cmd === "snapshot" ? snapshot() : null,
    );
  });
  afterEach(() => vi.useRealTimers());

  it("reloads after midnight (daily backup) and rewrites the week from the new day", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <StudyBackground />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(calls("mirror_write")).toHaveLength(1));
    const first = calls("mirror_write")[0]?.[1].command.args.files[0].content as string;
    expect(first).toMatch(/<section><h2>09-28 周一/);
    expect(calls("snapshot")).toHaveLength(1);

    vi.setSystemTime(new Date("2026-09-28T16:00:20Z")); // Tuesday 00:00:20
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    await vi.waitFor(() => expect(calls("mirror_write")).toHaveLength(2));
    expect(calls("snapshot")).toHaveLength(2);
    const html = calls("mirror_write")[1]?.[1].command.args.files[0].content as string;
    expect(html).toMatch(/<section><h2>09-29 周二/);
    expect(html).not.toContain("09-28 周一");
    expect(html).toContain("10-05 周一");
  });
});
