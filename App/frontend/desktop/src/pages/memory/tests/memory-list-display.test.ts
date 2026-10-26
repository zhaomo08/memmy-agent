import { afterEach, describe, expect, it } from "vitest";
import { configureUserTimeZone, formatUserListTime } from "../../../lib/user-time-zone.js";
import { plainMarkdownPreview } from "../memory-display.js";
import { foldMinorSources } from "../overview-sub-page.js";

const words = { today: "今天", yesterday: "昨天" };
const now = new Date("2026-10-26T06:00:00.000Z"); // 14:00 at +08:00

describe("memory list display", () => {
  afterEach(() => configureUserTimeZone(undefined));

  it("shortens list times relative to the user's day", () => {
    configureUserTimeZone("+08:00");
    expect(formatUserListTime("2026-10-26T02:05:00.000Z", "zh-CN", words, now)).toBe("今天 10:05");
    expect(formatUserListTime("2026-10-25T14:18:00.000Z", "zh-CN", words, now)).toBe("昨天 22:18");
    expect(formatUserListTime("2026-10-19T01:00:00.000Z", "zh-CN", words, now)).toBe("10月19日");
    expect(formatUserListTime("2025-03-02T01:00:00.000Z", "zh-CN", words, now)).toBe("2025年3月2日");
    expect(formatUserListTime("2026-10-19T01:00:00.000Z", "en-US", { today: "Today", yesterday: "Yesterday" }, now)).toBe("Oct 19");
    // 23:30 UTC on the 25th is already the 26th at +08:00.
    expect(formatUserListTime("2026-10-25T23:30:00.000Z", "zh-CN", words, now)).toBe("今天 07:30");
  });

  it("folds sub-1% sources only when there are at least two", () => {
    const rows = [
      { source: "claude_code", count: 3011, percentage: 74.8 },
      { source: "1fe31fcd6bd76b90", count: 2, percentage: 0.05 },
      { source: "41538340bc89d387", count: 2, percentage: 0.05 }
    ];
    expect(foldMinorSources(rows, "其他")).toEqual([rows[0], { source: "其他", count: 4, percentage: 0.1 }]);
    expect(foldMinorSources(rows.slice(0, 2), "其他")).toEqual(rows.slice(0, 2));
  });

  it("reads markdown previews as prose without eating snake_case", () => {
    expect(plainMarkdownPreview("**结论：** `upstream/main` 没变\n## 1. 变化 __init__")).toBe("结论： upstream/main 没变 1. 变化 __init__");
  });
});
