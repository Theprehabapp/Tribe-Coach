// Workout timer: rest countdown, EMOM, work/rest intervals and a running clock, in a sheet that stays on
// screen while the athlete logs. Times come from the clock, not from counting ticks, so a phone that
// sleeps or throttles the page still shows the right time when it wakes.

const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
// "1:30", "90", "90s", "2 min" -> seconds. Null when it isn't a duration.
export function secs(text) {
  const t = String(text ?? "").trim().toLowerCase();
  let m = t.match(/^(\d{1,3}):([0-5]\d)$/); if (m) return +m[1] * 60 + +m[2];
  m = t.match(/(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|m|min|mins|minutes)?\b/); if (!m) return null;
  return Math.round(+m[1] * (/^m/.test(m[2] || "") ? 60 : 1)) || null;
}
// A prescribed rest ("Rest 2:00", "90s between sets", "2 min") in seconds, or null.
export function restSecs(text) {
  const t = String(text ?? "");
  const clock = t.match(/(\d{1,2}):([0-5]\d)/); if (clock) return +clock[1] * 60 + +clock[2];
  // "3-4 minutes" starts the shorter rest
  const m = t.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?\s*(s|sec|secs|seconds|m|min|mins|minutes)\b/i);
  return m ? Math.round(+m[1] * (/^m/i.test(m[2]) ? 60 : 1)) : null;
}
// What a block's text asks for: EMOM / E2MOM / every 90s x N, AMRAP N, or for time. Null when nothing fits.
export function presetFor(text) {
  const t = String(text ?? "");
  let m = t.match(/\bE(\d*)MOM\b(?:\D{0,6}(\d+))?/i);
  if (m) return { mode: "emom", every: (+m[1] || 1) * 60, rounds: +m[2] || 10 };
  m = t.match(/\bevery\s+(\d+(?::\d\d)?)\s*(s|sec|secs|seconds|m|min|mins|minutes)?\b(?:\D{0,10}(\d+))?/i);
  if (m) { const n = m[1].includes(":") ? secs(m[1]) : Math.round(+m[1] * (/^m/i.test(m[2] || "") ? 60 : 1)); if (n) return { mode: "emom", every: n, rounds: +m[3] || 10 }; }
  m = t.match(/\bAMRAP\b\D{0,6}(\d+)/i) || t.match(/(\d+)\s*(?:min|minute)s?\s*AMRAP/i);
  if (m) return { mode: "rest", total: +m[1] * 60, label: `AMRAP ${m[1]}` };
  if (/for\s*time/i.test(t)) return { mode: "clock" };
  return null;
}
// The phases one run goes through: [{ label, secs }]. A clock runs up with no end.
export function phases(o) {
  if (o.mode === "rest") return [{ label: o.label || "Rest", secs: o.total }];
  if (o.mode === "emom") return Array.from({ length: o.rounds }, (_, i) => ({ label: `Round ${i + 1} of ${o.rounds}`, secs: o.every }));
  if (o.mode === "intervals") return Array.from({ length: o.rounds }, (_, i) => [{ label: `Work ${i + 1} of ${o.rounds}`, secs: o.work, work: true }, ...(o.rest && i < o.rounds - 1 ? [{ label: `Rest ${i + 1} of ${o.rounds}`, secs: o.rest }] : [])]).flat();
  return [];
}
// Where a run is after t seconds: { i, left, done }. Clocks never finish.
export function at(list, t) {
  let i = 0;
  for (; i < list.length; i++) { if (t < list[i].secs) return { i, left: list[i].secs - t, done: false }; t -= list[i].secs; }
  return { i: list.length - 1, left: 0, done: true };
}

/* ---------- the sheet ---------- */
const LEAD = 3; // "3, 2, 1" before EMOMs, intervals and the clock
const st = { opt: { mode: "rest", total: 90, every: 60, rounds: 10, work: 40, rest: 20 }, run: null, open: false, mini: false };
let el, raf, ac, lock;

function beep(long) {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime, d = long ? 0.6 : 0.15;
    o.frequency.value = long ? 880 : 660; o.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.start(t); o.stop(t + d);
  } catch { /* no audio */ }
  navigator.vibrate?.(long ? 400 : 80);
}
async function wake(on) {
  try { if (on && !lock) lock = await navigator.wakeLock?.request("screen"); if (!on && lock) { await lock.release(); lock = null; } } catch { lock = null; }
}

const timerRunning = () => !!(st.run && !st.run.pausedAt);
const elapsed = () => !st.run ? 0 : (st.run.pausedAt ?? Date.now()) - st.run.start - st.run.paused;
const leadOf = (o) => (o.mode === "rest" ? 0 : LEAD);
function view() {
  const o = st.opt, r = st.run, list = phases(o), t = elapsed() / 1000, lead = leadOf(o);
  if (!r) return o.mode === "clock" ? { big: "0:00", sub: "Running clock", cls: "" } : { big: fmt(list[0]?.secs || 0), sub: list[0]?.label || "", cls: "" };
  if (t < lead) return { big: String(Math.ceil(lead - t)), sub: "Get ready", cls: "lead" };
  if (o.mode === "clock") return { big: fmt(Math.floor(t - lead)), sub: "Running clock", cls: "" };
  const p = at(list, t - lead);
  if (p.done) return { big: "0:00", sub: "Done", cls: "done" };
  return { big: fmt(p.left), sub: list[p.i].label, cls: [o.mode === "intervals" && !list[p.i].work ? "rest" : "", p.left <= 3 ? "last" : ""].join(" ").trim() };
}
function paint() {
  if (!el) return;
  const v = view(), r = st.run;
  el.querySelector("[data-tm-big]").textContent = v.big;
  // Running full screen, the whole screen carries the phase so it reads from across the gym.
  el.classList.toggle("run", !!r && !st.mini);
  el.dataset.phase = r ? v.cls : "";
  el.querySelector("[data-tm-sub]").textContent = v.sub;
  el.querySelector(".tm-face").className = `tm-face ${v.cls}`;
  el.querySelector('[data-tm="go"]').textContent = !r || r.done ? "Start" : r.pausedAt ? "Resume" : "Pause";
  el.querySelector("[data-tm-setup]").hidden = !!r && !r.done;
}
// Short beeps for 3, 2, 1; a long one when a round, interval or the whole run starts or ends.
function tick() {
  const o = st.opt, r = st.run;
  if (!r || r.pausedAt) return;
  const t = elapsed() / 1000, lead = leadOf(o);
  let key = "", long = false;
  if (t < lead) key = "lead" + Math.ceil(lead - t);
  else if (o.mode === "clock") { if (r.phase !== "go") { r.phase = "go"; beep(true); } }
  else {
    const list = phases(o), p = at(list, t - lead);
    if (p.done) { beep(true); r.done = true; r.pausedAt = Date.now(); wake(false); paint(); if (o.mode === "rest") setTimeout(() => { if (st.run === r) closeTimer(); }, 4000); return; }  // a finished rest clears itself
    if (r.phase !== p.i) { if (r.phase !== undefined || lead) long = true; r.phase = p.i; }
    if (p.left <= 3) key = `${p.i}-${Math.ceil(p.left)}`;
  }
  if (long) beep(true);
  else if (key && key !== r.key) beep(false);
  r.key = key;
  paint();
  raf = setTimeout(tick, 200);
}
function stop() { clearTimeout(raf); wake(false); st.run = null; }

function setupHtml() {
  const o = st.opt, mm = (k, label) => `<label class="f">${label}<input class="t num" inputmode="numeric" data-tm-in="${k}" value="${fmt(o[k])}"></label>`;
  const n = (k, label) => `<label class="f">${label}<input class="t num" inputmode="numeric" data-tm-in="${k}" value="${o[k]}"></label>`;
  return o.mode === "rest" ? `<div class="row tm-quick">${[60, 90, 120, 180].map((s) => `<button class="btn small${o.total === s ? " primary" : ""}" data-tm="quick" data-v="${s}">${fmt(s)}</button>`).join("")}</div>${mm("total", "Countdown")}`
    : o.mode === "emom" ? `<div class="row">${mm("every", "Every")}${n("rounds", "Rounds")}</div>`
    : o.mode === "intervals" ? `<div class="row">${mm("work", "Work")}${mm("rest", "Rest")}${n("rounds", "Rounds")}</div>`
    : '<p class="small muted">Counts up from 0:00 after a 3 second lead-in.</p>';
}
function build() {
  el = document.createElement("div");
  el.id = "timer"; el.className = "timer"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Timer");
  el.innerHTML = `<div class="tm-head"><div class="seg" role="group" aria-label="Timer type">${[["rest", "Rest"], ["emom", "EMOM"], ["intervals", "Intervals"], ["clock", "Clock"]].map(([k, l]) =>
    `<button data-tm="mode" data-v="${k}">${l}</button>`).join("")}</div><span class="row"><button class="link small" data-tm="mini">Hide</button><button class="link small" data-tm="close">Close</button></span></div>
    <div class="tm-face" data-tm="expand"><div class="tm-big num" data-tm-big aria-live="off"></div><div class="small" data-tm-sub></div></div>
    <div data-tm-setup class="stack"></div>
    <div class="row tm-ctl"><button class="btn primary" data-tm="go">Start</button><button class="btn" data-tm="reset">Reset</button><button class="btn tm-x" data-tm="close" aria-label="Close timer">&times;</button></div>`;
  el.addEventListener("click", onClick);
  el.addEventListener("change", (e) => {
    const k = e.target.dataset.tmIn; if (!k) return;
    const v = k === "rounds" ? parseInt(e.target.value, 10) : secs(e.target.value);
    if (v > 0 && v <= (k === "rounds" ? 99 : 5999)) st.opt[k] = v;
    fill();
  });
  document.body.append(el);
}
function fill() {
  el.querySelectorAll('[data-tm="mode"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === st.opt.mode)));
  el.querySelector("[data-tm-setup]").innerHTML = setupHtml();
  paint();
}
function onClick(e) {
  const b = e.target.closest("[data-tm]"); if (!b) return;
  const a = b.dataset.tm;
  if (a === "mode" && !st.run) { st.opt.mode = b.dataset.v; fill(); }
  if (a === "quick") { st.opt.total = +b.dataset.v; fill(); }
  if (a === "close") closeTimer();
  if (a === "mini") setMini(true);
  if (a === "expand" && st.mini) setMini(false);
  if (a === "reset") { stop(); setMini(false); fill(); }
  if (a === "go") {
    beep(false); // unlocks audio on iPhone: sound has to start from a tap
    if (!st.run || st.run.done) { st.run = { start: Date.now(), paused: 0, pausedAt: null }; wake(true); tick(); fill(); }
    else if (st.run.pausedAt) { st.run.paused += Date.now() - st.run.pausedAt; st.run.pausedAt = null; wake(true); tick(); }
    else { st.run.pausedAt = Date.now(); clearTimeout(raf); wake(false); paint(); }
  }
}

// A running timer fills the screen; Hide shrinks it to a pill with the time and Pause, and tapping the time brings it back.
function setMini(on) {
  st.mini = on;
  el.classList.toggle("mini", on);
  document.body.classList.toggle("timer-mini", on);
  paint();
}
// Opens the sheet, optionally set up for a block ({ mode, total, every, rounds, ... }); start: run it now.
export function openTimer(preset, start = false) {
  if (!el) build();
  if (preset && !timerRunning()) { stop(); Object.assign(st.opt, preset); }
  el.hidden = false; st.open = true; document.body.classList.add("timer-open");
  setMini(false);
  fill();
  if (start && !timerRunning()) { st.run = null; onClick({ target: el.querySelector('[data-tm="go"]') }); }
}
export function closeTimer() {
  stop();
  if (el) { el.hidden = true; setMini(false); }
  st.open = false; document.body.classList.remove("timer-open");
}

globalThis.document?.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && timerRunning()) wake(true); });
