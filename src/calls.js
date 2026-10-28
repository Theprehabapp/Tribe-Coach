// Monthly check-in calls: 30-minute slots in the last days of each month, in the coach's time zone.
// Pure functions, no DOM, so they can be tested. The database checks the same rules on booking (0016).

export const CALL_MINUTES = 30;
export const DEFAULT_CALLS = { on: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", tz: "Australia/Sydney", window: 7 };

const pad = (n) => String(n).padStart(2, "0");
const mins = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };
const hhmm = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

// The wall-clock date and time of an instant in a time zone.
export function partsIn(date, tz) {
  const f = new Intl.DateTimeFormat("en-AU", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { ymd: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, dow };
}
// The instant when a time zone's clock reads this date and time.
export function zoned(ymd, time, tz) {
  const [y, m, d] = ymd.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = (t) => { const p = partsIn(new Date(t), tz), [py, pm, pd] = p.ymd.split("-").map(Number), [ph, pmi] = p.time.split(":").map(Number); return Date.UTC(py, pm - 1, pd, ph, pmi) - t; };
  let t = guess - off(guess);
  t = guess - off(t); // second pass settles a daylight-saving change between guess and answer
  return new Date(t);
}

const lastDay = (month) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const nextMonth = (month) => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; };
// The dates the call week covers: the last `window` days of the month.
export function windowDays(month, cfg) {
  const n = lastDay(month), w = Math.max(1, Math.min(+cfg.window || 7, n));
  return Array.from({ length: w }, (_, i) => `${month}-${pad(n - w + 1 + i)}`);
}
// Every slot of a month's call week, booked or not: { at: ISO instant, ymd, time } in the coach's zone.
export function slotsFor(month, cfg) {
  const out = [], from = mins(cfg.start), to = mins(cfg.end);
  for (const ymd of windowDays(month, cfg)) {
    const [y, m, d] = ymd.split("-").map(Number);
    if (!cfg.days.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) continue;
    for (let t = from; t + CALL_MINUTES <= to; t += CALL_MINUTES) out.push({ at: zoned(ymd, hhmm(t), cfg.tz).toISOString(), ymd, time: hhmm(t) });
  }
  return out;
}
// The month athletes book for: this month until its last slot has passed, then next month.
export function callMonth(cfg, now = new Date()) {
  const month = partsIn(now, cfg.tz).ymd.slice(0, 7), last = slotsFor(month, cfg).pop();
  return last && new Date(last.at) > now ? month : nextMonth(month);
}
export const monthOf = (at, cfg) => partsIn(new Date(at), cfg.tz).ymd.slice(0, 7);

// Calendar links for a booked call. Google takes UTC times as yyyymmddThhmmssZ.
const gcalTime = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export function googleLink(at, title, details) {
  const s = new Date(at), e = new Date(s.getTime() + CALL_MINUTES * 6e4);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${gcalTime(s)}/${gcalTime(e)}&details=${encodeURIComponent(details)}`;
}
export function icsFile(at, title, details, uid) {
  const s = new Date(at), e = new Date(s.getTime() + CALL_MINUTES * 6e4);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tribe Coach//Calls//EN", "BEGIN:VEVENT", `UID:${uid}@tribe-coach`, `DTSTAMP:${gcalTime(new Date())}`,
    `DTSTART:${gcalTime(s)}`, `DTEND:${gcalTime(e)}`, `SUMMARY:${title}`, `DESCRIPTION:${details.replace(/\n/g, "\\n")}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
