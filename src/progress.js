// Progress from logged sets: an estimated 1RM per session, and personal records. Pure, no DOM, so it can be tested.
import { exKey } from "./schedule.js";

const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

// Epley estimate. A single is the lift itself; past 12 reps the estimate means little, so it's left out.
export const e1rm = (kg, reps) => (kg <= 0 || reps < 1 || reps > 12 ? 0 : reps === 1 ? kg : Math.round(kg * (1 + reps / 30) * 10) / 10);

// Every set with both reps and kg, flattened: { key, name, date, logId, kg, reps }.
// nameOf(log, exId) finds the exercise name for older entries that didn't store it.
export function liftSets(logs, nameOf) {
  const out = [];
  for (const l of logs) for (const en of l.entries || []) {
    const name = String(en.name || nameOf(l, en.exId) || "").trim();
    if (!name) continue;
    for (const s of en.sets || []) {
      const kg = num(s.kg), reps = Math.round(num(s.reps));
      if (kg > 0 && reps > 0) out.push({ key: exKey(name), name, date: l.date, logId: l.id, kg, reps });
    }
  }
  return out;
}

// Per exercise, the best set of each session by estimated 1RM, oldest first.
export function series(sets) {
  const by = new Map();
  for (const s of sets) {
    const x = e1rm(s.kg, s.reps); if (!x) continue;
    const ex = by.get(s.key) || by.set(s.key, { name: s.name, days: new Map() }).get(s.key);
    const cur = ex.days.get(s.date);
    if (!cur || x > cur.e1rm) ex.days.set(s.date, { date: s.date, e1rm: x, kg: s.kg, reps: s.reps });
  }
  return new Map([...by].map(([k, v]) => [k, { name: v.name, points: [...v.days.values()].sort((a, b) => a.date.localeCompare(b.date)) }]));
}

// Per exercise: heaviest set, best estimated 1RM, and the heaviest weight at 1, 3 and 5 reps or more.
export function records(sets) {
  const by = new Map();
  for (const s of sets) {
    const r = by.get(s.key) || by.set(s.key, { name: s.name, heaviest: null, best: null, at: {} }).get(s.key);
    if (!r.heaviest || s.kg > r.heaviest.kg || (s.kg === r.heaviest.kg && s.reps > r.heaviest.reps)) r.heaviest = s;
    const x = e1rm(s.kg, s.reps);
    if (x && (!r.best || x > r.best.e1rm)) r.best = { ...s, e1rm: x };
    for (const n of [1, 3, 5]) if (s.reps >= n && (!r.at[n] || s.kg > r.at[n].kg)) r.at[n] = s;
  }
  return by;
}

// What a just-finished session beat: one line per exercise, only where there was history to beat.
export function newPRs(log, logs, nameOf) {
  const mine = liftSets([log], nameOf), before = records(liftSets(logs.filter((l) => l.id !== log.id), nameOf));
  const out = new Map();
  for (const s of mine) {
    const r = before.get(s.key); if (!r) continue;
    const x = e1rm(s.kg, s.reps), prev = out.get(s.key);
    if (s.kg > r.heaviest.kg && (!prev || prev.kind !== "heaviest" || s.kg > prev.kg)) out.set(s.key, { name: s.name, kg: s.kg, reps: s.reps, kind: "heaviest" });
    else if (x && r.best && x > r.best.e1rm && !prev) out.set(s.key, { name: s.name, kg: s.kg, reps: s.reps, kind: "e1rm", e1rm: x });
  }
  return [...out.values()];
}
