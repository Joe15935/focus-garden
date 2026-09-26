import { describe, expect, it } from "vitest";
import { mirrorHtml, mirrorIcs } from "./mirror";

const day = (date: string, title: string) => ({
  date,
  status: "FEASIBLE" as const,
  notes: [],
  timeline: [
    { id: "a", start: 480, end: 530, title, kind: "study", place: "home" as const },
    {
      id: "b",
      start: 470,
      end: 475,
      title: "到课准备",
      kind: "buffer",
      place: "classroom" as const,
    },
  ],
});

describe("phone mirror", () => {
  it("renders a static page with every title escaped and no script", () => {
    const html = mirrorHtml({
      generatedAt: "2026/9/28 08:00",
      days: [day("2026-09-28", "<script>alert(1)</script>民法")],
      due: [{ prompt: "成立条件 & 效果", dueDate: "2026-09-28" }],
      remainingLectures: 120,
    });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("成立条件 &amp; 效果");
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).not.toContain("到课准备");
    expect(html).toContain("09-28 周一");
  });

  it("puts several days into one calendar with stable, per-day UIDs", () => {
    const ics = mirrorIcs([day("2026-09-28", "甲"), day("2026-09-29", "乙")]);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("UID:2026-09-28-a@focus-garden.local");
    expect(ics).toContain("UID:2026-09-29-a@focus-garden.local");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});
