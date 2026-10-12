import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAt, timeLeft, weekOf, sessionDate, rxLine, bumpTarget, ymd } from "../src/schedule.js";

test("feedback is due 24 hours after upload", () => {
  const up = new Date(2026, 9, 11, 9, 0);
  assert.equal(dueAt(up).getTime(), new Date(2026, 9, 12, 9, 0).getTime());
  assert.deepEqual(timeLeft(dueAt(up), new Date(2026, 9, 11, 13, 30)), { overdue: false, label: "19h left" });
  assert.deepEqual(timeLeft(dueAt(up), new Date(2026, 9, 12, 8, 20)), { overdue: false, label: "40m left" });
  assert.deepEqual(timeLeft(dueAt(up), new Date(2026, 9, 12, 12, 0)), { overdue: true, label: "3h overdue" });
  assert.deepEqual(timeLeft(dueAt(up), new Date(2026, 9, 15, 9, 0)), { overdue: true, label: "3d overdue" });
});

test("week index and session dates", () => {
  assert.equal(weekOf("2026-09-28", new Date(2026, 9, 11)), 1);
  assert.equal(weekOf("2026-10-12", new Date(2026, 9, 11)), -1);
  assert.equal(ymd(sessionDate("2026-09-28", 1, 5)), "2026-10-09"); // W2 Friday
});

test("prescription line and % creep", () => {
  assert.equal(rxLine({ sets: 4, reps: "8.8", target: "7 RPE", cue: "single arm" }), "4 x 8.8 @ 7 RPE (single arm)");
  assert.equal(bumpTarget("70-75% of 1RM"), "72.5-77.5% of 1RM");
  assert.equal(bumpTarget("7 RPE"), "7 RPE");
});
