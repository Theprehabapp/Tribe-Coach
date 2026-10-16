import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAt, timeLeft, weekOf, sessionDate, rxLine, bumpTarget, ymd, blockLabels, pctLoad, hasPct, exKey } from "../src/schedule.js";

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

test("superset labels", () => {
  assert.deepEqual(blockLabels([{ block: "A" }, { block: "a" }, { block: "B" }, { block: "B" }, { block: "B" }, { block: "C" }, {}]), ["A1", "A2", "B1", "B2", "B3", "C", ""]);
});

test("percent targets as kg off a 1RM", () => {
  assert.equal(pctLoad("70-75% of 1RM", 120), "85-90 kg"); // 84 -> 85, 90 -> 90
  assert.equal(pctLoad("72.5-77.5%", 100), "72.5-77.5 kg");
  assert.equal(pctLoad("80%", 142.5), "115 kg"); // 114 -> 115
  assert.equal(pctLoad("7 RPE", 100), null);
  assert.equal(pctLoad("70%", 0), null);
  assert.equal(hasPct("4 x 5 @ 70-75%"), true);
  assert.equal(hasPct("7 RPE"), false);
  assert.equal(exKey("  Back  squat "), "back squat");
});
