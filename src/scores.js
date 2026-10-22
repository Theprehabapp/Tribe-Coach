// Scores: what a block is scored in, how to read a score, and which of two is better. Pure, no DOM, so it can be tested.
import { exKey } from "./schedule.js";

// The PR board's presets. Barbell lifts are 1RMs in kg (the maxes table); the rest are prs rows.
export const PR_LIFTS = {
  Strength: ["Back Squat", "Front Squat", "Overhead Squat", "Deadlift", "Bench Press", "Strict Press", "Push Press", "Thruster"],
  Olympic: ["Snatch", "Power Snatch", "Clean", "Power Clean", "Clean & Jerk", "Split Jerk"],
};
export const PR_SETS = {
  gymnastics: [["Strict Pull Ups", "reps"], ["Pull Ups", "reps"], ["Chest to Bar Pull Ups", "reps"], ["Bar Muscle Ups", "reps"], ["Ring Muscle Ups", "reps"],
    ["Toes to Bar", "reps"], ["Strict HSPU", "reps"], ["Kipping HSPU", "reps"], ["Legless Rope Climbs", "reps"], ["Handstand Walk", "m"], ["Double Unders", "reps"]],
  benchmark: [["Fran", "time"], ["Grace", "time"], ["Isabel", "time"], ["Diane", "time"], ["Helen", "time"], ["Karen", "time"], ["Elizabeth", "time"],
    ["Jackie", "time"], ["Annie", "time"], ["Murph", "time"], ["Cindy", "rounds"], ["Fight Gone Bad", "reps"], ["2k Row", "time"], ["5k Run", "time"]],
};

// kind: [placeholder, inputmode, format, what to type]
export const KINDS = {
  reps: ["reps", "numeric", /^\d{1,4}$/, "a number of reps, e.g. 15"],
  m: ["m", "decimal", /^\d{1,5}(\.\d{1,2})?$/, "metres, e.g. 25"],
  time: ["m:ss", "text", /^\d{1,3}:[0-5]\d$/, "a time as m:ss, e.g. 2:45"],
  rounds: ["rds+reps", "text", /^\d{1,3}(\+\d{1,3})?$/, "rounds+reps, e.g. 21+5"],
  watts: ["watts", "numeric", /^\d{1,4}$/, "watts, e.g. 310"],
  cal: ["cal", "numeric", /^\d{1,4}$/, "calories, e.g. 42"],
  kg: ["kg", "decimal", /^\d{1,3}(\.\d{1,2})?$/, "kilograms, e.g. 102.5"],
  score: ["score", "text", /^.{1,20}$/, "a score of up to 20 characters"],
};
export const validScore = (kind, v) => (KINDS[kind] || KINDS.score)[2].test(String(v).trim());

// The board item a name matches: { cat, kind, name } or null. Custom PRs on the athlete's board count too.
export function boardItem(name, custom = []) {
  const k = exKey(name);
  for (const cat of Object.keys(PR_SETS)) { const hit = PR_SETS[cat].find(([n]) => exKey(n) === k); if (hit) return { cat, kind: hit[1], name: hit[0] }; }
  const c = custom.find((r) => exKey(r.name) === k);
  return c ? { cat: c.category, kind: "score", name: c.name } : null;
}

// What a programmed block is scored in, from its scoring tag ("(FOR TIME)"), its per-set column, or a board name.
export function scoreKind(e, custom = []) {
  const tag = String(e.score || "");
  if (/time/i.test(tag)) return "time";
  if (/watt/i.test(tag)) return "watts";
  if (/round|amrap/i.test(tag)) return "rounds";
  if (/cal/i.test(tag)) return "cal";
  if (/met(er|re)|distance/i.test(tag)) return "m";
  if (/load|weight|kg/i.test(tag)) return "kg";
  if (/rep/i.test(tag)) return "reps";
  if (tag.trim()) return "score";
  return boardItem(e.name, custom)?.kind || null;
}

// Whether a logged result should go to the PR board: benchmarks by name; gymnastics only when the block is a max-effort set.
export function prTarget(e, custom = []) {
  const it = boardItem(e.name, custom);
  if (!it) return null;
  if (it.cat === "gymnastics" && !/unbroken|max/i.test([e.name, e.score, e.reps, e.note].join(" "))) return null;
  return it;
}

// A score as one comparable number, or null when it can't be compared ("score" kind, or badly typed).
export function scoreValue(kind, v) {
  const s = String(v ?? "").trim();
  if (!validScore(kind, s) || kind === "score") return null;
  if (kind === "time") { const [m, sec] = s.split(":"); return +m * 60 + +sec; }
  if (kind === "rounds") { const [r, x = 0] = s.split("+"); return +r * 1000 + +x; }
  return parseFloat(s);
}

// True when a beats b. Times are better lower, everything else higher. A score with nothing to beat is a PR.
export function beats(kind, a, b) {
  const x = scoreValue(kind, a);
  if (x == null) return false;
  if (b == null || String(b).trim() === "") return true;
  const y = scoreValue(kind, b);
  if (y == null) return true;
  return kind === "time" ? x < y : x > y;
}
