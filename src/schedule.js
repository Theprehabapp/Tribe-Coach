// Review windows and program dates. Pure functions, no DOM, so they can be tested.

export const REVIEW_DAYS = [2, 4]; // Tuesday, Thursday
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

// The review a video belongs to: the upload day if it's a Tuesday or Thursday, otherwise the next one.
export function slotFor(date) {
  const d = new Date(date);
  for (let i = 0; i < 7; i++) {
    const n = addDays(d, i);
    if (REVIEW_DAYS.includes(n.getDay())) return ymd(n);
  }
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
