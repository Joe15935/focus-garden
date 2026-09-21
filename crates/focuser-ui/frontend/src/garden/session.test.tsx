import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./api";
import { ActiveSession } from "@/routes/dashboard";

const { mutate, mutateAsync } = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(null),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  useGardenAction: () => ({ mutate, mutateAsync, isPending: false, error: null }),
}));
const session: Session = {
  id: "session-1",
  list_id: "list-1",
  task: "阅读一章",
  category: "阅读",
  started_at: "2026-09-21T09:00:00Z",
  local_date: "2026-09-21",
  planned_secs: 3600,
  elapsed_secs: 30,
  break_secs: 300,
  break_remaining_secs: 300,
  strict: "deep",
  status: "work",
  outcome: "pending",
  exit_remaining_secs: 299,
  xp: 0,
};

describe("safe exit interface", () => {
  beforeEach(() => {
    mutate.mockClear();
    mutateAsync.mockClear();
  });
  it("requires the backend cooldown, a reason, and the exact confirmation", async () => {
    const { rerender } = render(<ActiveSession session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "提前结束" }));
    expect(mutateAsync).toHaveBeenCalledWith({ cmd: "request_exit" });
    fireEvent.change(screen.getByLabelText("结束原因"), { target: { value: "紧急事项" } });
    fireEvent.change(screen.getByLabelText("输入「我确认提前结束本次专注」"), {
      target: { value: "我确认提前结束本次专注" },
    });
    expect(screen.getByRole("button", { name: "确认提前结束" })).toBeDisabled();
    rerender(<ActiveSession session={{ ...session, exit_remaining_secs: 0 }} />);
    expect(screen.getByRole("button", { name: "确认提前结束" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "确认提前结束" }));
    expect(mutate).toHaveBeenCalledWith({
      cmd: "confirm_exit",
      args: { reason: "紧急事项", confirmation: "我确认提前结束本次专注" },
    });
  });
  it("can dismiss the exit panel while an already requested cooldown continues", () => {
    render(<ActiveSession session={{ ...session, exit_requested_at: "2026-09-21T09:00:20Z" }} />);
    fireEvent.click(screen.getByRole("button", { name: "提前结束" }));
    expect(screen.getByLabelText("安全提前结束")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续当前安排" }));
    expect(screen.queryByLabelText("安全提前结束")).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
  it("displays backend break time and never requires a deep-work phrase during rest", () => {
    render(
      <ActiveSession
        session={{
          ...session,
          status: "break",
          break_remaining_secs: 81,
          elapsed_secs: 3600,
          exit_remaining_secs: 0,
        }}
      />,
    );
    expect(screen.getByRole("timer")).toHaveTextContent("01:21");
    fireEvent.click(screen.getByRole("button", { name: "结束休息" }));
    expect(screen.queryByLabelText("输入「我确认提前结束本次专注」")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到花园" })).toBeEnabled();
  });
});
