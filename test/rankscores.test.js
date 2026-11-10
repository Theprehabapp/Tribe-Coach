import { test } from "node:test";
import assert from "node:assert/strict";
import { rankScores } from "../src/scores.js";

const r = (athlete, workout, score, result, day = "2026-11-04") => ({ client_id: athlete, athlete, workout, score, result, day });
test("times rank fastest first, rounds and reps most first, ties share a place", () => {
  const g = rankScores([r("A", "Fran", "(FOR TIME)", "3:45"), r("B", "Fran", "(FOR TIME)", "2:59"), r("C", "Fran", "(FOR TIME)", "3:45"),
    r("A", "AMRAP 12", "(FOR ROUNDS + REPS)", "5+10"), r("B", "AMRAP 12", "(FOR ROUNDS + REPS)", "6+2")]);
  const fran = g.find((x) => x.workout === "Fran"), amrap = g.find((x) => x.workout === "AMRAP 12");
  assert.deepEqual(fran.rows.map((x) => [x.athlete, x.place]), [["B", 1], ["A", 2], ["C", 2]]);
  assert.deepEqual(amrap.rows.map((x) => x.athlete), ["B", "A"]);
});
test("grouped by workout and day, newest day first; unreadable scores go last without a place", () => {
  const g = rankScores([r("A", "Row", "(FOR CALORIES)", "40", "2026-11-01"), r("B", "row", "(FOR CALORIES)", "lots", "2026-11-01"), r("C", "Row", "(FOR CALORIES)", "38", "2026-11-03")]);
  assert.deepEqual(g.map((x) => [x.day, x.rows.length]), [["2026-11-03", 1], ["2026-11-01", 2]]);
  assert.deepEqual(g[1].rows.map((x) => [x.athlete, x.place]), [["A", 1], ["B", null]]);
});
test("a benchmark name with no tag still ranks by its kind", () => {
  const g = rankScores([r("A", "Fran", "", "4:10"), r("B", "Fran", "", "3:30")]);
  assert.equal(g[0].kind, "time");
  assert.equal(g[0].rows[0].athlete, "B");
});
