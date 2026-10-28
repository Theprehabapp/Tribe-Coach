import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CALLS as C, zoned, partsIn, windowDays, slotsFor, callMonth, nextMonth, googleLink } from "../src/calls.js";

test("Sydney wall clock to an instant and back, either side of daylight saving", () => {
  assert.equal(zoned("2026-10-28", "09:00", "Australia/Sydney").toISOString(), "2026-10-27T22:00:00.000Z"); // AEDT +11
  assert.equal(zoned("2026-06-24", "09:00", "Australia/Sydney").toISOString(), "2026-06-23T23:00:00.000Z"); // AEST +10
  assert.deepEqual(partsIn(new Date("2026-10-27T22:00:00Z"), "Australia/Sydney"), { ymd: "2026-10-28", time: "09:00", dow: 3 });
});

test("the call week is the last days of the month", () => {
  assert.deepEqual(windowDays("2026-10", C), ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  assert.equal(windowDays("2026-02", { ...C, window: 3 })[0], "2026-02-26");
  assert.equal(nextMonth("2026-12"), "2027-01");
});

test("slots: weekdays only, 30 minutes, the last one ends at closing time", () => {
  const s = slotsFor("2026-10", C);
  assert.deepEqual([...new Set(s.map((x) => x.ymd))], ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.equal(s.length, 5 * 16);
  assert.equal(s[0].time, "09:00"); assert.equal(s[15].time, "16:30");
  assert.equal(slotsFor("2026-10", { ...C, days: [6], start: "08:00", end: "09:00" }).length, 2);
});

test("athletes book this month until its last slot passes, then next month", () => {
  assert.equal(callMonth(C, new Date("2026-10-03T00:00:00Z")), "2026-10");
  assert.equal(callMonth(C, new Date("2026-10-30T05:00:00Z")), "2026-10"); // Fri 30 Oct, 4pm Sydney
  assert.equal(callMonth(C, new Date("2026-10-30T06:00:00Z")), "2026-11"); // 5pm, the last slot has started
});

test("Google Calendar link carries the 30 minutes in UTC", () => {
  assert.match(googleLink("2026-10-27T22:00:00.000Z", "Check-in", "x"), /dates=20261027T220000Z\/20261027T223000Z/);
});
