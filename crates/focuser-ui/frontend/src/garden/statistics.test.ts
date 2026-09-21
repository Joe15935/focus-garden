import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { getBlockedEvents } from "@/lib/commands";
import fixture from "@/test/fixtures/blocked-events-request.json";
import { blockedEventRange, periodStart, type Period } from "./statistics";

afterEach(() => clearMocks());

describe("blocked-event command contract", () => {
  it("sends date-only arguments through the actual Tauri transport", async () => {
    let request: unknown;
    mockIPC((command, payload) => {
      expect(command).toBe("run_command");
      request = payload && "command" in payload ? payload.command : undefined;
      return { kind: "blocked_events", data: [] };
    });
    const range = blockedEventRange("today", new Date(2026, 8, 21, 23, 59));
    await getBlockedEvents(range.from, range.to);
    // This same fixture is deserialized by the real Rust Command enum in
    // garden_bridge's tests, so NaiveDate/RFC3339 contract drift fails both sides.
    expect(JSON.parse(JSON.stringify(request))).toEqual(fixture);
  });

  it.each<[Period, string]>([
    ["today", "2026-09-23"],
    ["week", "2026-09-21"],
    ["month", "2026-09-01"],
    ["year", "2026-01-01"],
    ["all", "1970-01-01"],
  ])("uses local calendar boundaries for %s", (period, expected) => {
    expect(periodStart(period, new Date(2026, 8, 23, 23, 30))).toBe(expected);
  });

  it.each([
    [new Date(2026, 11, 31, 23, 59), "2026-12-31", "2027-01-01"],
    [new Date(2028, 1, 29, 0, 1), "2028-02-29", "2028-03-01"],
    [new Date(2026, 2, 8, 0, 1), "2026-03-08", "2026-03-09"],
  ])("includes the full local day across calendar boundaries", (now, from, to) => {
    expect(blockedEventRange("today", now)).toEqual({ from, to });
  });
});
