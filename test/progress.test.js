import { test } from "node:test";
import assert from "node:assert/strict";
import { e1rm, liftSets, series, records, newPRs } from "../src/progress.js";

const log = (id, date, sets, name = "Back Squat") => ({ id, date, entries: [{ exId: "x", name, sets }] });
const S = (reps, kg) => ({ reps: String(reps), kg: String(kg), rpe: "", done: true });

test("estimated 1RM", () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(e1rm(100, 5), 116.7);
  assert.equal(e1rm(100, 15), 0);
  assert.equal(e1rm(0, 5), 0);
});

test("series keeps the best set per session, oldest first", () => {
  const logs = [log("b", "2026-10-08", [S(5, 105), S(3, 115)]), log("a", "2026-10-01", [S(5, 100), S("", 100), S(5, "")])];
  const s = series(liftSets(logs, () => null)).get("back squat");
  assert.deepEqual(s.points.map((p) => [p.date, p.e1rm]), [["2026-10-01", 116.7], ["2026-10-08", 126.5]]);
});

test("records and names from the program for older entries", () => {
  const logs = [{ id: "a", date: "2026-10-01", entries: [{ exId: "x", sets: [S(1, 140), S(5, 120), S(3, 130)] }] }];
  const r = records(liftSets(logs, (l, id) => (id === "x" ? "Deadlift" : null))).get("deadlift");
  assert.equal(r.heaviest.kg, 140); assert.equal(r.at[3].kg, 130); assert.equal(r.at[5].kg, 120); assert.equal(r.best.e1rm, 143);
});

test("new PRs only against history", () => {
  const old = log("a", "2026-10-01", [S(5, 100)]);
  const first = log("z", "2026-10-01", [S(5, 50)], "Bench");
  const today = { id: "b", date: "2026-10-08", entries: [{ exId: "x", name: "back squat ", sets: [S(5, 102.5), S(3, 105)] }, { exId: "y", name: "Bench", sets: [S(5, 52.5)] }, { exId: "w", name: "Row", sets: [S(8, 60)] }] };
  assert.deepEqual(newPRs(today, [old, first, today], () => null).map((p) => [p.name, p.kg, p.kind]), [["back squat", 105, "heaviest"], ["Bench", 52.5, "heaviest"]]);
  const lighter = { id: "c", date: "2026-10-09", entries: [{ exId: "x", name: "Back Squat", sets: [S(8, 100)] }] };
  assert.deepEqual(newPRs(lighter, [old, lighter], () => null).map((p) => [p.kind, p.e1rm]), [["e1rm", 126.7]]);
});
