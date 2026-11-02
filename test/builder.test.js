import { test } from "node:test";
import assert from "node:assert/strict";
import { groupsOf, relabel, linked, toggleLink, rxSummary, autofill, blockLabels } from "../src/schedule.js";

const ex = (...bs) => bs.map((b, i) => ({ id: String(i), block: b }));
const letters = (a) => a.map((e) => e.block).join("");

test("blocks are runs of neighbours with the same letter", () => {
  assert.deepEqual(groupsOf(ex("A", "A", "B", "", "C", "C", "C")), [[0, 1], [2, 2], [3, 3], [4, 6]]);
  assert.equal(letters(relabel(ex("A", "A", "", "D", "D"))), "AABCC");
  assert.equal(letters(relabel(ex("A", "B", "A"))), "ABC"); // a letter reused later is its own block
});

test("the chain links and unlinks neighbours and relabels", () => {
  const a = ex("A", "B", "C");
  toggleLink(a, 1); assert.equal(letters(a), "AAB"); assert.deepEqual(blockLabels(a), ["A1", "A2", "B"]);
  toggleLink(a, 2); assert.equal(letters(a), "AAA"); assert.ok(linked(a, 2));
  toggleLink(a, 1); assert.equal(letters(a), "ABB"); // splitting at 1 keeps 1 and 2 together
  toggleLink(a, 2); assert.equal(letters(a), "ABC");
  const b = ex("", "", "");
  toggleLink(b, 2); assert.equal(letters(b), "ABB");
  toggleLink(b, 0); assert.equal(letters(b), "ABB"); // no chain before the first
});

test("summary line matches TrainHeroic", () => {
  assert.equal(rxSummary({ metric: "% 1RM", rows: [{ reps: "5", val: "70" }, { reps: "5", val: "72.5" }, { reps: "5", val: "72.5" }, { reps: "5", val: "72.5" }] }), "4 x 5 @ 70, 72.5, 72.5, 72.5%");
  assert.equal(rxSummary({ metric: "RPE", rows: Array(4).fill({ reps: "10", val: "7" }) }), "4 x 10 @ 7RPE");
  assert.equal(rxSummary({ sets: 3, reps: "10.10" }), "3 x 10.10");
  assert.equal(rxSummary({ metric: "kg", rows: [{ reps: "", val: "" }, { reps: "", val: "" }, { reps: "", val: "" }] }), "3 Sets");
  assert.equal(rxSummary({ sets: 4, reps: "8", target: "7 RPE" }), "4 x 8 @ 7 RPE");
  assert.equal(rxSummary({ kind: "circuit", note: "12 min AMRAP" }), "");
});

test("typing in a set fills the rows below", () => {
  const rows = [{ reps: "5", val: "70" }, { reps: "5", val: "70" }, { reps: "5", val: "70" }];
  assert.deepEqual(autofill(rows, 1, "val", "72.5").map((r) => r.val), ["70", "72.5", "72.5"]);
  assert.deepEqual(autofill(rows, 0, "reps", "6").map((r) => r.reps), ["6", "6", "6"]);
});
