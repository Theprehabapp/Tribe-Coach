// Feedback timing and program dates. Pure functions, no DOM, so they can be tested.

export const FEEDBACK_HOURS = 24; // the promise to clients: feedback within a day
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n) => (n < 10 ? "0" + n : "" + n);
export const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const daysBetween = (a, b) => Math.round((parseYmd(ymd(b)) - parseYmd(ymd(a))) / 864e5);

const asDate = (d) => (typeof d === "string" ? parseYmd(d) : d);
export const fmtDay = (d) => { d = asDate(d); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
export const fmtLong = (d) => { d = asDate(d); return `${DOW_LONG[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
export const fmtTime = (ts) => {
  const d = new Date(ts), h = d.getHours();
  return `${fmtDay(d)}, ${h % 12 || 12}:${pad(d.getMinutes())}${h < 12 ? "am" : "pm"}`;
};

// When feedback on a video is due, and how long is left ("5h left", "40m left", "3h overdue").
export const dueAt = (uploadedAt) => new Date(new Date(uploadedAt).getTime() + FEEDBACK_HOURS * 36e5);
export function timeLeft(due, now = new Date()) {
  const ms = due - now, m = Math.round(Math.abs(ms) / 6e4), h = Math.floor(m / 60);
  const span = h >= 48 ? `${Math.floor(h / 24)}d` : h ? `${h}h` : `${Math.max(m, 1)}m`;
  return { overdue: ms < 0, label: ms < 0 ? `${span} overdue` : `${span} left` };
}

// Week index of a client in their program (0-based), -1 before the start date.
export function weekOf(startYmd, today) {
  if (!startYmd) return -1;
  const diff = daysBetween(parseYmd(startYmd), today);
  return diff < 0 ? -1 : Math.floor(diff / 7);
}

export function sessionDate(startYmd, week, dow) {
  const s = parseYmd(startYmd);
  return addDays(s, week * 7 + ((dow - s.getDay() + 7) % 7));
}

// Per-set prescriptions. An exercise can carry rows [{reps, val}] plus a metric for the val column;
// older exercises only have sets + reps + a free-text target, which still works everywhere.
export const METRICS = ["", "kg", "% 1RM", "RPE", "Watts", "Seconds", "Metres", "Calories"];
const UNIT = { kg: " kg", RPE: " RPE", Watts: " W", Seconds: " sec", Metres: " m", Calories: " cal" };
export function valText(val, metric) {
  const v = String(val ?? "").trim();
  if (!v || !metric) return v;
  return metric === "% 1RM" ? `${v.replace(/%$/, "")}% of 1RM` : v + (UNIT[metric] || "");
}
export function rowsOf(e) {
  if (e.rows?.length) return e.rows;
  return Array.from({ length: Math.max(1, +e.sets || 1) }, () => ({ reps: String(e.reps ?? ""), val: "" }));
}
const same = (a) => new Set(a.map((x) => String(x ?? "").trim())).size <= 1;
const varied = (e) => !!e.rows?.length && !(same(e.rows.map((r) => r.reps)) && (!e.metric || same(e.rows.map((r) => r.val))));
// Write rows back onto sets, reps and target so the summary line, athlete log and copies agree.
export function applyRows(e, rows) {
  e.rows = rows; e.sets = rows.length;
  e.reps = same(rows.map((r) => r.reps)) ? String(rows[0]?.reps ?? "").trim() : rows.map((r) => String(r.reps).trim()).join(",");
  if (e.metric) e.target = same(rows.map((r) => r.val)) ? valText(rows[0]?.val, e.metric) : "";
  return e;
}
// The number in an old free-text target, for when a metric column is switched on ("7 RPE" -> "7").
export function parseVal(target, metric) {
  const t = String(target || "");
  const re = { "% 1RM": /(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?)\s*%/, RPE: /(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?)\s*RPE/i, kg: /(\d+(?:\.\d+)?)\s*kg/i, Watts: /(\d+)\s*w/i }[metric];
  return re?.exec(t)?.[1] || "";
}
// "4 x 8.8 @ 7 RPE (single arm)", or set by set when the sets differ: "3 sets: 5 @ 70% of 1RM, 5 @ 75% of 1RM, 3 @ 80% of 1RM".
export function rxLine(e) {
  const cue = e.cue ? " (" + e.cue + ")" : "";
  if (varied(e)) return `${e.rows.length} sets: ${e.rows.map((r) => `${String(r.reps).trim()}${String(r.val ?? "").trim() ? " @ " + valText(r.val, e.metric) : ""}`).join(", ")}${cue}`;
  return `${countRx(e)}${e.target ? " @ " + e.target : ""}${cue}`.trim();
}
// "3 x 13", "10 sets" when there's no rep count, nothing for a block that's all instructions (an EMOM, a flow).
const countRx = (e) => {
  const sets = String(e.sets ?? "").trim(), reps = String(e.reps ?? "").trim();
  return reps ? `${sets || 1} x ${reps}` : sets ? `${sets} ${sets === "1" ? "set" : "sets"}` : "";
};
// Short form for the program grid: "3 x 13".
export const shortRx = (e) => countRx(e);
// Day 1 is Monday, Day 7 Sunday, matching a Monday start date.
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const dayNum = (dow) => ((dow + 6) % 7) + 1;

// Copying a week forward: % bands creep 2.5%, Week 1 calibration lines become a load increase.
export const W1_LINE = "- Establishing working loads this week to build on in the coming weeks.";
export function bumpTarget(target) {
  return target.replace(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%/, (_, lo, hi) => `${+lo + 2.5}-${+hi + 2.5}%`);
}
// A per-set % value ("75" or "70-75") moved up 2.5%.
export const bumpPct = (val) => String(val ?? "").replace(/\d+(?:\.\d+)?/g, (n) => String(+n + 2.5));

// Supersets: exercises sharing a block letter, in order, become A1, A2; a block of one is just "A".
export function blockLabels(exercises) {
  const key = (e) => String(e.block || "").trim().toUpperCase();
  const count = {}, seen = {};
  exercises.forEach((e) => { const b = key(e); if (b) count[b] = (count[b] || 0) + 1; });
  return exercises.map((e) => { const b = key(e); if (!b) return ""; seen[b] = (seen[b] || 0) + 1; return count[b] > 1 ? b + seen[b] : b; });
}

// Same exercise whatever the spacing or capitals.
export const exKey = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// A percentage target ("70-75% of 1RM", "80%") as kilograms off a 1RM, rounded to the nearest 2.5 kg.
export const hasPct = (target) => /\d\s*%/.test(target || "");
export function pctLoad(target, max) {
  const m = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*%/.exec(target || "");
  if (!m || !(max > 0)) return null;
  const kg = (p) => Math.round((max * p) / 100 / 2.5) * 2.5;
  const lo = kg(+m[1]), hi = m[2] ? kg(+m[2]) : lo;
  return lo === hi ? `${lo} kg` : `${lo}-${hi} kg`;
}
