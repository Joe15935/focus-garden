import { localDate } from "./api";

export type Period = "today" | "week" | "month" | "year" | "all";

export function periodStart(period: Period, now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "all") return "1970-01-01";
  if (period === "week") date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  if (period === "month") date.setDate(1);
  if (period === "year") date.setMonth(0, 1);
  return localDate(date);
}

/** GetBlockedEvents expects chrono::NaiveDate, never RFC3339 timestamps. */
export function blockedEventRange(period: Period, now = new Date()) {
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from: periodStart(period, now), to: localDate(nextDay) };
}
