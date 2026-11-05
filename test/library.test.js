import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRows, sortRows, pageOf, tagCounts, rxTitle, applyRx, metricOf, paramOf, resultTag, resultLabel, cleanSwaps, cleanTags } from "../src/library.js";

test("search matches the title only, then the tag", () => {
  const rows = [{ title: "Back Squat", tags: ["Squat"], note: "bench" }, { title: "Bench Press", tags: ["Upper"] }, { title: "Front Squat", tags: ["squat", "Barbell"] }];
  assert.deepEqual(filterRows(rows, { q: "squat" }).map((r) => r.title), ["Back Squat", "Front Squat"]);
  assert.deepEqual(filterRows(rows, { q: "bench" }).map((r) => r.title), ["Bench Press"]);
  assert.deepEqual(filterRows(rows, { tag: "SQUAT" }).map((r) => r.title), ["Back Squat", "Front Squat"]);
});
test("sorts A to Z with numbers in order, and Z to A", () => {
  const rows = [{ t: "W10" }, { t: "w2" }, { t: "A" }, { t: null }];
  assert.deepEqual(sortRows(rows, (r) => r.t).map((r) => r.t), [null, "A", "w2", "W10"]);
  assert.deepEqual(sortRows(rows, (r) => r.t, "desc").map((r) => r.t), ["W10", "w2", "A", null]);
});
test("100 a page, like TrainHeroic's 1-100 of 867", () => {
  const rows = Array.from({ length: 867 }, (_, i) => i);
  assert.deepEqual({ ...pageOf(rows, 0), rows: undefined }, { rows: undefined, page: 0, pages: 9, from: 1, to: 100, total: 867 });
  assert.equal(pageOf(rows, 8).to, 867);
  assert.equal(pageOf(rows, 99).page, 8);
  assert.equal(pageOf([], 0).from, 0);
});
test("tag counts, most used first", () => {
  assert.deepEqual(tagCounts([{ tags: ["Squat", "Barbell"] }, { tags: ["Squat"] }, { tags: [" "] }]), [["Squat", 2], ["Barbell", 1]]);
});
test("a prescription is named from its table", () => {
  assert.equal(rxTitle({ param2: "Weight (%)", rows: Array.from({ length: 5 }, () => ({ reps: "3", val: "80" })) }), "5 x 3 @ 80%");
  assert.equal(rxTitle({ param2: "", rows: [{ reps: "1.1.3", val: "" }] }), "1 x 1.1.3");
  assert.deepEqual(applyRx({}, { param2: "RPE", rows: [{ reps: 5, val: 7 }] }), { rows: [{ reps: "5", val: "7" }], metric: "RPE" });
});
test("parameters map to the builder's second column and back", () => {
  assert.equal(metricOf("Weight (kg)"), "kg");
  assert.equal(metricOf("Weight (lb)"), "kg");
  assert.equal(metricOf("Reps"), "");
  assert.equal(metricOf(""), "");
  assert.equal(metricOf("Distance (yd)"), "Other");
  assert.equal(paramOf("% 1RM"), "Weight (%)");
  assert.equal(paramOf(""), "");
});
test("circuit results are stored as the scoring tag", () => {
  assert.equal(resultTag("For Completion"), "");
  assert.equal(resultTag("Time"), "(FOR TIME)");
  assert.equal(resultLabel("(FOR TIME)"), "Time");
  assert.equal(resultLabel(""), "For Completion");
  assert.equal(resultLabel("(FOR LOAD)"), "Weight");
  assert.equal(resultLabel("(FOR ROUNDS + REPS)"), "Rounds + Reps");
});
test("swaps max 3, tags without repeats", () => {
  assert.deepEqual(cleanSwaps(["a", "", "b", "a", "c", "d"]), ["a", "b", "c"]);
  assert.deepEqual(cleanTags(["Squat", "squat ", "", "Lower"]), ["Squat", "Lower"]);
});
