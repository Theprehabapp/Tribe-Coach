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

// "4 x 8.8 @ 7 RPE (single arm)"
export const rxLine = (e) => `${e.sets} x ${e.reps}${e.target ? " @ " + e.target : ""}${e.cue ? " (" + e.cue + ")" : ""}`;

// Copying a week forward: % bands creep 2.5%, Week 1 calibration lines become a load increase.
export const W1_LINE = "- Establishing working loads this week to build on in the coming weeks.";
export function bumpTarget(target) {
  return target.replace(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%/, (_, lo, hi) => `${+lo + 2.5}-${+hi + 2.5}%`);
}

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
