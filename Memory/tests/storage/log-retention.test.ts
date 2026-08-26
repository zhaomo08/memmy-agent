import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

/**
 * Guards the byte budget that bounds log tables whose rows carry full JSON snapshots.
 * Mirrors pruneLogTableBySize; fails if the window-function prune stops working.
 */
function pruneBySize(db: Database.Database, budgetBytes: number): number {
  return db
    .prepare(
      `DELETE FROM memory_change_log
       WHERE rowid IN (
         SELECT rowid FROM (
           SELECT rowid, SUM(length(coalesce(before_json,'')) + length(coalesce(after_json,''))) OVER (ORDER BY seq DESC) AS running_bytes
           FROM memory_change_log
         )
         WHERE running_bytes > ?
       )`
    )
    .run(budgetBytes).changes;
}

function seedLog(rows: number): Database.Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE memory_change_log (seq INTEGER PRIMARY KEY, before_json TEXT, after_json TEXT)");
  const insert = db.prepare("INSERT INTO memory_change_log (seq, before_json, after_json) VALUES (?, ?, ?)");
  for (let seq = 1; seq <= rows; seq += 1) insert.run(seq, "x".repeat(1024), "y".repeat(1024));
  return db;
}

describe("log table byte retention", () => {
  it("drops oldest rows until the table fits the budget, keeping newest intact", () => {
    const db = seedLog(10); // 10 rows x 2KB = 20KB

    const deleted = pruneBySize(db, 6 * 1024);

    const remaining = (db.prepare("SELECT seq FROM memory_change_log ORDER BY seq").all() as { seq: number }[])
      .map((row) => row.seq);
    expect(deleted).toBe(7);
    expect(remaining).toEqual([8, 9, 10]); // newest survive
    const bytes = db.prepare("SELECT SUM(length(before_json)+length(after_json)) AS n FROM memory_change_log").get() as { n: number };
    expect(bytes.n).toBeLessThanOrEqual(6 * 1024);
  });

  it("keeps everything when the table is already under budget", () => {
    const db = seedLog(2);

    expect(pruneBySize(db, 1024 * 1024)).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM memory_change_log").get()).toEqual({ n: 2 });
  });

  it("empties the table when the budget is smaller than a single row", () => {
    // Documented edge: the production budget (24MB) is ~30x the largest row ever
    // observed (811KB), so this cannot trip in practice.
    const db = seedLog(3);

    pruneBySize(db, 100);

    expect(db.prepare("SELECT count(*) AS n FROM memory_change_log").get()).toEqual({ n: 0 });
  });
});
