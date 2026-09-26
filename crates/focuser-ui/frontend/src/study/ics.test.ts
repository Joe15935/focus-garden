import { describe, expect, it } from "vitest";
import { expandIcs, guessPlace, parseIcs, rulesFromOccurrences, zonedToUtc } from "./ics";

const wrap = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\n${body}END:VCALENDAR\r\n`;
const TERM = { id: "t", firstMonday: "2026-08-31" };

function run(body: string, from = "2026-08-31", until = "2027-01-10") {
  const { events, warnings } = parseIcs(wrap(body));
  const r = expandIcs(events, from, until);
  return { ...r, warnings: [...warnings, ...r.warnings] };
}

describe("ics import", () => {
  it("rejects non-calendar text", () => {
    expect(() => parseIcs("hello")).toThrow();
  });

  it("converts TZID, UTC and floating times to Beijing wall time", () => {
    expect(new Date(zonedToUtc([2026, 9, 22, 14, 0, 0], "Asia/Shanghai")).toISOString()).toBe(
      "2026-09-22T06:00:00.000Z",
    );
    const r = run(
      "BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:甲\r\nDTSTART;TZID=Asia/Shanghai:20260922T140000\r\nDTEND;TZID=Asia/Shanghai:20260922T163500\r\nEND:VEVENT\r\n" +
        "BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:乙\r\nDTSTART:20260924T060000Z\r\nDTEND:20260924T074000Z\r\nEND:VEVENT\r\n" +
        "BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:丙\r\nDTSTART:20260925T080000\r\nDURATION:PT45M\r\nEND:VEVENT\r\n" +
        "BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:丁\r\nDTSTART;TZID=America/New_York:20260925T020000\r\nDTEND;TZID=America/New_York:20260925T030000\r\nEND:VEVENT\r\n",
    );
    expect(r.occurrences.map((o) => [o.title, o.date, o.start, o.end])).toEqual([
      ["甲", "2026-09-22", 840, 995],
      ["乙", "2026-09-24", 840, 940],
      ["丙", "2026-09-25", 480, 525],
      ["丁", "2026-09-25", 840, 900],
    ]);
  });

  it("expands weekly rules with UNTIL, EXDATE and a moved occurrence", () => {
    const r = run(
      "BEGIN:VEVENT\r\nUID:w\r\nSUMMARY:遗传学\r\nLOCATION:5教101\r\nDTSTART;TZID=Asia/Shanghai:20260924T140000\r\nDTEND;TZID=Asia/Shanghai:20260924T154000\r\nRRULE:FREQ=WEEKLY;UNTIL=20261217T155959Z\r\nEXDATE;TZID=Asia/Shanghai:20261001T140000\r\nEND:VEVENT\r\n" +
        "BEGIN:VEVENT\r\nUID:w\r\nRECURRENCE-ID;TZID=Asia/Shanghai:20261015T140000\r\nSUMMARY:遗传学\r\nLOCATION:5教101\r\nDTSTART;TZID=Asia/Shanghai:20261016T080000\r\nDTEND;TZID=Asia/Shanghai:20261016T094000\r\nEND:VEVENT\r\n",
    );
    const dates = r.occurrences.map((o) => o.date);
    expect(dates).not.toContain("2026-10-01");
    expect(dates).not.toContain("2026-10-15");
    expect(dates).toContain("2026-10-16");
    expect(dates[0]).toBe("2026-09-24");
    expect(dates[dates.length - 1]).toBe("2026-12-17");
    // 13 Thursdays minus the excluded 10-01 and the moved 10-15.
    expect(r.occurrences.filter((o) => o.start === 840)).toHaveLength(11);
  });

  it("handles COUNT, INTERVAL=2 (odd weeks) and multiple BYDAY", () => {
    const r = run(
      "BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:单周课\r\nDTSTART;TZID=Asia/Shanghai:20260921T080000\r\nDTEND;TZID=Asia/Shanghai:20260921T094000\r\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4\r\nEND:VEVENT\r\n",
    );
    expect(r.occurrences.map((o) => o.date)).toEqual([
      "2026-09-21",
      "2026-09-23",
      "2026-10-05",
      "2026-10-07",
    ]);
    const drafts = rulesFromOccurrences(r.occurrences, TERM, "测试");
    expect(drafts.map((d) => [d.rule.weekday, d.weeks])).toEqual([
      [1, [4, 6]],
      [3, [4, 6]],
    ]);
  });

  it("skips unsupported rules and all-day events instead of guessing", () => {
    const r = run(
      "BEGIN:VEVENT\r\nUID:m\r\nSUMMARY:月会\r\nDTSTART:20260921T080000\r\nDTEND:20260921T090000\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=21\r\nEND:VEVENT\r\n" +
        "BEGIN:VEVENT\r\nUID:h\r\nSUMMARY:国庆节\r\nDTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261008\r\nEND:VEVENT\r\n",
    );
    expect(r.occurrences).toEqual([]);
    expect(r.skipped).toHaveLength(2);
  });

  it("ignores cancelled events and nested alarms; unfolds long lines", () => {
    const r = run(
      "BEGIN:VEVENT\r\nUID:k\r\nSUMMARY:很长的课程名\r\n 续写\r\nSTATUS:CANCELLED\r\nDTSTART:20260922T080000\r\nDTEND:20260922T090000\r\nEND:VEVENT\r\n" +
        "BEGIN:VEVENT\r\nUID:l\r\nSUMMARY:课\\, 带逗号\r\nDTSTART:20260922T100000\r\nDTEND:20260922T110000\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nSUMMARY:提醒\r\nEND:VALARM\r\nEND:VEVENT\r\n",
    );
    expect(r.occurrences.map((o) => o.title)).toEqual(["课, 带逗号"]);
  });

  it("groups occurrences into rules with exact weeks and guessed places", () => {
    const occ = [
      {
        date: "2026-11-03",
        start: 1160,
        end: 1260,
        title: "数据科学",
        location: "5教309",
        uid: "1",
      },
      {
        date: "2026-11-17",
        start: 1160,
        end: 1260,
        title: "数据科学",
        location: "Online Learning",
        uid: "1",
      },
      {
        date: "2026-11-24",
        start: 1160,
        end: 1260,
        title: "数据科学",
        location: "Online Learning",
        uid: "1",
      },
    ];
    const drafts = rulesFromOccurrences(occ, TERM, "测试");
    expect(drafts).toHaveLength(2);
    const online = drafts.find((d) => d.locationText === "Online Learning");
    expect(online?.rule.location).toBe("home");
    expect(online?.weeks).toEqual([12, 13]);
    expect(online?.rule.evidence).toBe("provisional");
    expect(guessPlace("5教101")).toBe("classroom");
    expect(guessPlace("图书馆三楼")).toBe("library");
  });
});
