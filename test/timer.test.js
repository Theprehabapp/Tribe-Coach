import { test } from "node:test";
import assert from "node:assert/strict";
import { secs, restSecs, presetFor, phases, at } from "../src/timer.js";

test("durations and prescribed rests read as seconds", () => {
  assert.equal(secs("1:30"), 90);
  assert.equal(secs("90"), 90);
  assert.equal(secs("2 min"), 120);
  assert.equal(secs("nope"), null);
  assert.equal(restSecs("Rest 2:00 between sets"), 120);
  assert.equal(restSecs("90s"), 90);
  assert.equal(restSecs("3 mins"), 180);
  assert.equal(restSecs("as needed"), null);
  assert.equal(restSecs("Rest 3-4 minutes between sets"), 180);
});

test("blocks suggest the right timer", () => {
  assert.deepEqual(presetFor("EMOM x 12"), { mode: "emom", every: 60, rounds: 12 });
  assert.deepEqual(presetFor("E2MOM 8 rounds"), { mode: "emom", every: 120, rounds: 8 });
  assert.deepEqual(presetFor("Every 90s x 6"), { mode: "emom", every: 90, rounds: 6 });
  assert.deepEqual(presetFor("Every 2:30 for 5 sets"), { mode: "emom", every: 150, rounds: 5 });
  assert.deepEqual(presetFor("AMRAP 12"), { mode: "rest", total: 720, label: "AMRAP 12" });
  assert.deepEqual(presetFor("(FOR TIME)"), { mode: "clock" });
  assert.equal(presetFor("5 x 5 @ 80%"), null);
});

test("intervals run work and rest, with no rest after the last round", () => {
  const list = phases({ mode: "intervals", work: 40, rest: 20, rounds: 3 });
  assert.deepEqual(list.map((p) => p.secs), [40, 20, 40, 20, 40]);
  assert.deepEqual(at(list, 45), { i: 1, left: 15, done: false });
  assert.equal(at(list, 160).done, true);
});
