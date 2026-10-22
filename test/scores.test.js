import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreKind, scoreValue, beats, prTarget, boardItem, validScore } from "../src/scores.js";

test("a block's score kind comes from its tag, then the PR board", () => {
  assert.equal(scoreKind({ name: "Row", score: "(TEST) (FOR WATTS)" }), "watts");
  assert.equal(scoreKind({ name: "Ski", score: "(FOR METERS)" }), "m");
  assert.equal(scoreKind({ name: "Burpees", score: "(FOR REPS)" }), "reps");
  assert.equal(scoreKind({ name: "Chipper", score: "(FOR TIME)" }), "time");
  assert.equal(scoreKind({ name: "Cindy", score: "" }), "rounds");
  assert.equal(scoreKind({ name: " fran " }), "time");
  assert.equal(scoreKind({ name: "Back Squat" }), null);
  assert.equal(scoreKind({ name: "Amanda" }, [{ name: "Amanda", category: "benchmark" }]), "score");
});

test("scores compare the right way round", () => {
  assert.equal(scoreValue("time", "2:41"), 161);
  assert.equal(scoreValue("rounds", "21+5"), 21005);
  assert.equal(scoreValue("time", "2:4"), null);
  assert.ok(beats("time", "2:35", "2:41"));
  assert.ok(!beats("time", "2:50", "2:41"));
  assert.ok(beats("rounds", "22", "21+9"));
  assert.ok(beats("reps", "15", "12"));
  assert.ok(beats("reps", "15", ""));
  assert.ok(!beats("score", "380", "350"));
  assert.ok(!beats("time", "nope", "2:41"));
  assert.ok(validScore("watts", "310") && !validScore("watts", "3a"));
});

test("only benchmarks and max-effort gymnastics go to the PR board", () => {
  assert.deepEqual(prTarget({ name: "Fran" }), { cat: "benchmark", kind: "time", name: "Fran" });
  assert.equal(prTarget({ name: "Toes to Bar", reps: "10" }), null);
  assert.equal(prTarget({ name: "Toes to Bar", reps: "Max unbroken" })?.cat, "gymnastics");
  assert.equal(prTarget({ name: "Bench Press" }), null);
  assert.equal(boardItem("handstand walk").kind, "m");
});
