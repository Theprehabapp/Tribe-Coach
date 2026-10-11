import { test } from "node:test";
import assert from "node:assert/strict";
import { slotFor, weekOf, sessionDate, rxLine, bumpTarget, ymd } from "../src/schedule.js";

test("uploads land in the next Tuesday or Thursday", () => {
  assert.equal(slotFor(new Date(2026, 9, 11, 20)), "2026-10-13"); // Sun -> Tue
  assert.equal(slotFor(new Date(2026, 9, 13, 23, 59)), "2026-10-13"); // Tue night -> same Tue
  assert.equal(slotFor(new Date(2026, 9, 14, 0, 1)), "2026-10-15"); // Wed -> Thu
  assert.equal(slotFor(new Date(2026, 9, 16, 9)), "2026-10-20"); // Fri -> next Tue
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
