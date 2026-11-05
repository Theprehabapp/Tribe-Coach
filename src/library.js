// The Library, filed the way TrainHeroic files it: flat lists per type, sorted A to Z, narrowed by a
// title search and by tags (exercises, circuits) or categories (prescriptions). Pure helpers, no DOM.
import { rxSummary } from "./schedule.js";

// TrainHeroic's exercise parameters, in its order. Parameter 1 and 2 are an exercise's default set-table columns.
export const PARAMS = ["", "Reps", "Rep Range (min-max)", "Weight (lb)", "Weight (kg)", "Weight (%)", "Weight (LWP+)", "Time (min::sec)",
  "Seconds (s)", "Distance (miles)", "Distance (yd)", "Distance (ft)", "Distance (inches)", "Distance (meters)", "Height (inches)",
  "Calories (cal)", "RPE", "Watts", "Velocity (m/s)", "Other Number"];
// The builder's second set column for a parameter. Pounds are entered as kg here (the app works in kg).
const METRIC_OF = { "Weight (kg)": "kg", "Weight (lb)": "kg", "Weight (%)": "% 1RM", "Weight (LWP+)": "kg", RPE: "RPE", Watts: "Watts",
  "Seconds (s)": "Seconds", "Distance (meters)": "Metres", "Calories (cal)": "Calories", "Time (min::sec)": "Time", "Velocity (m/s)": "Velocity" };
export const metricOf = (param) => (!param || param === "Reps" || param === "Rep Range (min-max)" ? "" : METRIC_OF[param] || "Other");
const PARAM_OF = { kg: "Weight (kg)", "% 1RM": "Weight (%)", RPE: "RPE", Watts: "Watts", Seconds: "Seconds (s)", Metres: "Distance (meters)",
  Calories: "Calories (cal)", Time: "Time (min::sec)", Velocity: "Velocity (m/s)", Other: "Other Number" };
export const paramOf = (metric) => PARAM_OF[metric] || "";

// TrainHeroic's stock tag list; coaches can also type their own.
export const STOCK_TAGS = ["Olympic Lifts", "Primary Lifts", "Accessory Lifts", "Gymnastics", "Plyometrics", "Conditioning", "Corrective", "Skill",
  "Midline", "Mobility", "Assistance", "Barbell", "Dumbbell", "Cable", "Stability Ball", "Box", "Band", "Medicine Ball", "Kettlebell", "Bodyweight",
  "Posterior Chain", "Horizontal Pushing", "Vertical Pushing", "Horizontal Pulling", "Vertical Pulling", "Level Change", "Triple Flex/Ext",
  "Hip Dominant Flex/Ext", "Ambulation", "No Rotation", "Whole Body", "Squat", "Step Up", "Lunge", "Sagittal Dominant", "Frontal Dominant",
  "Transverse Dominant", "Lower", "Upper"];
export const RX_CATEGORIES = ["Strength", "Hypertrophy", "Power", "Conditioning", "Uncategorized"];
// A circuit's Results ("Select leaderboard"), stored as the builder's scoring tag so scores and leaderboards read it.
export const CIRCUIT_RESULTS = ["For Completion", "Calories", "Feet", "Inches", "Meters", "Miles", "Reps", "Rounds", "Seconds", "Time",
  "Velocity (m/s)", "RPE", "Watts", "Weight", "Yards", "Data", "Percent", "Other Number"];
export const resultTag = (label) => (!label || label === "For Completion" ? "" : `(FOR ${label.toUpperCase()})`);
export const resultLabel = (tag) => {
  const t = String(tag || "").replace(/[()]/g, "").replace(/^FOR\s+/i, "").trim().toLowerCase();
  if (!t) return "For Completion";
  if (t === "load") return "Weight";
  if (t === "metres") return "Meters";
  return CIRCUIT_RESULTS.find((r) => r.toLowerCase() === t) || t.replace(/\b\w/g, (c) => c.toUpperCase());
};

// Title-only search, case-insensitive, then an optional tag; sorted by one column, A to Z by default.
export function filterRows(rows, { q = "", tag = "", title = (r) => r.title, tags = (r) => r.tags || [] } = {}) {
  const s = q.trim().toLowerCase();
  return rows.filter((r) => (!s || String(title(r) || "").toLowerCase().includes(s)) && (!tag || tags(r).some((t) => t.toLowerCase() === tag.toLowerCase())));
}
export function sortRows(rows, get, dir = "asc") {
  const k = (r) => { const v = get(r); return v == null ? "" : v; };
  const out = [...rows].sort((a, b) => {
    const x = k(a), y = k(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
    return c;
  });
  return dir === "desc" ? out.reverse() : out;
}
export const PAGE = 100;
export function pageOf(rows, page) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), p = Math.min(Math.max(0, page || 0), pages - 1);
  return { rows: rows.slice(p * PAGE, p * PAGE + PAGE), page: p, pages, from: rows.length ? p * PAGE + 1 : 0, to: Math.min(rows.length, p * PAGE + PAGE), total: rows.length };
}
// Every tag in use on these rows, with counts, most used first: [[tag, n], ...].
export function tagCounts(rows, tags = (r) => r.tags || []) {
  const m = new Map();
  for (const r of rows) for (const t of tags(r)) { const k = t.trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
// A prescription has no title of its own: it is named from its table, like TrainHeroic ("5 x 3 @ 80%").
export function rxTitle(rx) {
  const rows = (rx.rows || []).length ? rx.rows : [{ reps: "", val: "" }];
  return rxSummary({ rows, metric: metricOf(rx.param2), sets: rows.length });
}
// Applies a saved prescription to an exercise in the builder: its sets, reps and second column.
export function applyRx(e, rx) {
  const rows = (rx.rows || []).map((r) => ({ reps: String(r.reps ?? ""), val: String(r.val ?? "") }));
  return { rows, metric: metricOf(rx.param2) };
}
// Up to three suggested swaps, no blanks or repeats.
export const cleanSwaps = (list) => [...new Set(list.map((s) => String(s || "").trim()).filter(Boolean))].slice(0, 3);
export const cleanTags = (list) => { const seen = new Set(); return list.map((t) => String(t || "").trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())); };
