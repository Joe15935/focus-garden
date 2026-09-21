import { describe, expect, it, vi } from "vitest";
import { errorText } from "./api";

describe("user-facing command errors", () => {
  it("keeps a backend Chinese recovery explanation", () => {
    expect(errorText(new Error("请等待冷静期结束。"))).toBe("请等待冷静期结束。");
  });

  it("replaces technical English errors with Chinese and logs the details", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("invalid args command for command run_command: trailing input");
    expect(errorText(error)).toBe("暂时无法完成操作，请稍后重试。");
    expect(log).toHaveBeenCalledWith("Focus Garden command failed:", error);
    log.mockRestore();
  });
});
