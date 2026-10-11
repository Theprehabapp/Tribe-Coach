import "./styles.css";
import * as api from "./api.js";
import { exampleProgram } from "./example.js";
import { mountBreakdown } from "./breakdown.js";
import {
  REVIEW_DAYS, DOW, DOW_LONG, W1_LINE, ymd, addDays, fmtDay, fmtLong, fmtTime,
  slotFor, weekOf, sessionDate, rxLine, bumpTarget,
} from "./schedule.js";

const STREAMS = ["Tribe Build", "Hypertrophy X", "TribeFit", "Aerobic Conditioning", "HYROX"];
const app = document.getElementById("app");
const tabsEl = document.getElementById("tabs");

// All data the signed-in person may see, loaded once and kept in sync as they act.
let D = { profiles: [], programs: [], logs: [], videos: [] };
let me = null; // signed-in profile
let ui = { tab: null, view: null, programId: null, week: 0, clientId: null, logKey: null, drafts: {}, file: null, busy: false };

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isCoach = () => me?.role === "coach";
const profile = (id) => D.profiles.find((p) => p.id === id);
const program = (id) => D.programs.find((p) => p.id === id);
const clients = () => D.profiles.filter((p) => p.role === "client");
const today = () => ymd(new Date());
const findLog = (cid, pid, w, dayId) => D.logs.find((l) => l.client_id === cid && l.program_id === pid && l.week === w && l.day_id === dayId);
const waiting = () => D.videos.filter((v) => v.status === "waiting");
const newId = () => crypto.randomUUID().slice(0, 8);

let bd = null; // the open breakdown tool, if any

let toastT;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3000);
}
function fail(e, what) { console.error(e); toast(`${what} didn't save: ${e.message || e}. Check your connection and try again.`); }

const timers = {};
function debounce(key, fn, ms = 700) { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); }

/* ---------- boot ---------- */
async function boot() {
  if (!api.configured) return renderShell(vNotConfigured());
  api.onAuth((session, event) => {
    // Arrived from a "reset password" email: ask for the new password before anything else.
    if (event === "PASSWORD_RECOVERY") { ui.recovery = true; return renderShell(vSetPassword(true)); }
    start(session);
  });
  start(await api.getSession());
}

let started = null;
async function start(session) {
  const uid = session?.user?.id || null;
  if (ui.recovery || (started === uid && me)) return;
  started = uid;
  if (!uid) { me = null; return renderShell(vSignIn()); }
  ui.authMode = "in";
  renderShell('<div class="empty">Loading</div>');
  try {
    me = await api.myProfile(uid);
    if (!me) return renderShell(vPending(true));
    if (!me.approved) return renderShell(vPending(false));
    D = await api.loadAll();
    ui.tab = isCoach() ? "queue" : "today";
    render();
  } catch (e) {
    console.error(e);
    renderShell(`<div class="empty">Couldn't load your data: ${esc(e.message)}. Refresh to try again.</div>`);
  }
}

function renderShell(html) {
  tabsEl.innerHTML = "";
  document.querySelector(".tabs").hidden = true;
  app.innerHTML = html + lockup();
}

/* ---------- auth screens ---------- */
function vNotConfigured() {
  return `<section class="hero"><div class="kicker">Setup</div><h1>Not connected yet</h1>
    <p class="muted">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the environment, then rebuild. See the README.</p></section>`;
}
function vSignIn() {
  const m = ui.authMode || "in";
  const title = { in: "Sign in", up: "Create your account", forgot: "Reset your password" }[m];
  const lead = {
    in: "Use the email and password you signed up with.",
    up: "New here? Set up your login. Your coach approves new accounts before you can see your program.",
    forgot: "Enter your email and we'll send you a link to choose a new password.",
  }[m];
  return `<section class="hero"><div class="kicker">Tribe Coach</div><h1>${title}</h1><p class="muted">${lead}</p></section>
    <form class="card" id="signin" data-mode="${m}">
      ${m === "up" ? '<label class="f">Your name<input class="t" id="si-name" autocomplete="name" required></label>' : ""}
      <label class="f">Email<input class="t" id="si-email" type="email" autocomplete="email" value="${esc(ui.authEmail || "")}" required></label>
      ${m === "forgot" ? "" : `<label class="f">Password<input class="t" id="si-pass" type="password" minlength="8" autocomplete="${m === "up" ? "new-password" : "current-password"}" required></label>`}
      ${m === "up" ? '<p class="small muted">At least 8 characters.</p>' : ""}
      <div class="row"><button class="btn primary" type="submit">${{ in: "Sign in", up: "Create account", forgot: "Send reset link" }[m]}</button></div>
      <p class="small" id="si-msg" role="status"></p>
    </form>
    <div class="row auth-links">
      ${m !== "in" ? '<button class="link" data-act="auth-mode" data-v="in">I already have an account</button>' : '<button class="link" data-act="auth-mode" data-v="up">Create an account</button><button class="link" data-act="auth-mode" data-v="forgot">Forgot password?</button>'}
    </div>`;
}
function vSetPassword(recovery) {
  return `<section class="hero"><div class="kicker">${recovery ? "Reset password" : "Account"}</div><h1>${recovery ? "Choose a new password" : "Change password"}</h1>
    <p class="muted">At least 8 characters. You'll use it with ${esc(me?.email || "your email")} to sign in.</p></section>
    <form class="card" id="setpass">
      <label class="f">New password<input class="t" id="sp-pass" type="password" minlength="8" autocomplete="new-password" required></label>
      <div class="row"><button class="btn primary" type="submit">Save password</button>${recovery ? "" : '<button class="btn ghost" type="button" data-act="back">Cancel</button>'}</div>
      <p class="small" id="sp-msg" role="status"></p>
    </form>`;
}
function vPending(noProfile) {
  return `<section class="hero"><div class="kicker">Almost there</div><h1>Waiting for approval</h1>
    <p class="muted">${noProfile ? "Your account is still being set up." : "Your coach needs to approve your account before you can see your program. You'll get access as soon as they do."} Refresh this page later.</p></section>
    <div class="row"><button class="btn" data-act="signout">Sign out</button></div>`;
}

/* ---------- main render ---------- */
function render() {
  const tabs = isCoach()
    ? [["queue", "Review", waiting().length], ["programs", "Programs"], ["clients", "Clients", clients().filter((c) => !c.approved).length]]
    : [["today", "Training"], ["videos", "Videos"], ["history", "Log"]];
  document.querySelector(".tabs").hidden = false;
  tabsEl.innerHTML = tabs.map(([k, label, n]) =>
    `<button data-act="tab" data-v="${k}"${ui.tab === k && !ui.view ? ' aria-current="page"' : ""}><span class="dot"></span>${label}${n ? ` <span class="count num">${n}</span>` : ""}</button>`).join("");

  if (bd && ui.view !== "breakdown") { bd.destroy(); bd = null; }
  if (bd) return; // the breakdown tool manages its own screen

  let html;
  if (ui.view === "program") html = vProgramEdit();
  else if (ui.view === "client") html = vClientDetail();
  else if (ui.view === "log") html = vLog();
  else if (ui.view === "password") html = vSetPassword(false);
  else if (ui.view === "breakdown") html = vBreakdown();
  else if (isCoach()) html = ui.tab === "queue" ? vQueue() : ui.tab === "programs" ? vPrograms() : vClients();
  else html = ui.tab === "today" ? vToday() : ui.tab === "videos" ? vClientVideos() : vHistory();
  app.innerHTML = html + footer();
  hydrateVideos();
  if (ui.view === "breakdown") openBreakdown();
}

function lockup() {
  return `<div class="lockup"><div class="logo" role="img" aria-label="TRIBE.HQ"></div><div class="tag">Functional Strength &amp; Conditioning</div></div>`;
}
function footer() {
  return lockup() + `<div class="row" style="justify-content:center">
    <span class="small muted">${esc(me.email || "")}</span><button class="btn small ghost" data-act="password">Change password</button><button class="btn small ghost" data-act="signout">Sign out</button>
    ${isCoach() ? '<button class="btn small ghost" data-act="cleanup">Clear video files reviewed 30+ days ago</button>' : ""}</div>`;
}

function weekStrip() {
  const t = new Date(), mon = addDays(t, -((t.getDay() + 6) % 7));
  let out = '<div class="days" aria-label="This week">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const cls = (REVIEW_DAYS.includes(d.getDay()) ? "rev " : "") + (ymd(d) === ymd(t) ? "now" : "");
    out += `<span class="${cls}" title="${fmtLong(d)}">${DOW[d.getDay()][0]}</span>`;
  }
  return out + "</div>";
}

/* ----- coach: review queue ----- */
function vQueue() {
  const t = today(), isReviewDay = REVIEW_DAYS.includes(new Date().getDay());
  const due = waiting().filter((v) => v.slot <= t);
  const upcoming = waiting().filter((v) => v.slot > t);
  const nextSlot = slotFor(addDays(new Date(), isReviewDay ? 1 : 0));
  let big, sub;
  if (due.length) { big = due.length; sub = `video${due.length === 1 ? "" : "s"} in today's batch`; }
  else if (isReviewDay) { big = 0; sub = `Today's batch is clear. Next review ${fmtLong(nextSlot)}.`; }
  else { big = upcoming.length; sub = `video${upcoming.length === 1 ? "" : "s"} waiting for ${fmtLong(nextSlot)}`; }

  let out = `<section class="hero"><div class="kicker">${isReviewDay ? "Review day" : "Video review"}</div>
    <div class="hero-grid"><div class="big num">${big}</div><h1>${esc(sub)}</h1></div>${weekStrip()}
    <p class="muted small">Clients upload whenever they like. Videos wait here for the next Tuesday or Thursday, so your phone stays quiet the rest of the week.</p></section>`;

  if (due.length) out += batch("Today's batch", due);
  if (upcoming.length) {
    const label = `Next batch, ${fmtLong(upcoming.map((v) => v.slot).sort()[0])}`;
    if (due.length || ui.earlyOpen) out += batch(label, upcoming);
    else out += `<section class="stack"><div class="section-head"><h2>${esc(label)}</h2><span class="chip num">${upcoming.length} waiting</span></div>
      ${groupSummary(upcoming)}<div><button class="btn" data-act="open-early">Review this batch early</button></div></section>`;
  }
  if (!waiting().length) out += '<div class="empty">No videos waiting. When a client uploads one it shows up here for the next review day.</div>';

  const done = D.videos.filter((v) => v.status === "reviewed").sort((a, b) => (b.reviewed_at || "").localeCompare(a.reviewed_at || ""));
  if (done.length) out += `<details class="stack"><summary>Reviewed (${done.length})</summary><div class="list" style="margin-top:10px">${done.slice(0, 30).map((v) =>
    `<div class="item static"><div class="row spread"><strong>${esc(profile(v.client_id)?.name || "Client")} - ${esc(v.exercise)}</strong><span class="row">${v.review_path ? '<span class="chip">Breakdown</span>' : ""}${verdictChip(v.verdict)}</span></div><p class="small muted">${esc(v.feedback)}</p></div>`).join("")}</div></details>`;
  return out;
}
function byClient(list) {
  const by = {};
  list.forEach((v) => (by[v.client_id] ||= []).push(v));
  return by;
}
function groupSummary(list) {
  const by = byClient(list);
  return '<div class="list">' + Object.keys(by).map((cid) => `<div class="item static"><div class="row spread"><strong>${esc(profile(cid)?.name || "Client")}</strong><span class="muted small num">${by[cid].length} video${by[cid].length > 1 ? "s" : ""}</span></div><p class="small muted">${by[cid].map((v) => esc(v.exercise)).join(", ")}</p></div>`).join("") + "</div>";
}
function batch(label, list) {
  const by = byClient(list);
  let out = `<section class="stack"><div class="section-head"><h2>${esc(label)}</h2><span class="chip accent num">${list.length} to review</span></div>`;
  for (const cid of Object.keys(by)) {
    const c = profile(cid) || { name: "Client" }, p = program(c.program_id), w = weekOf(c.start_date, new Date());
    out += `<div class="stack"><div class="row spread"><h3>${esc(c.name || c.email)}</h3><span class="muted small">${p ? esc(p.name) + (w >= 0 ? `, week ${w + 1}` : "") : "No program"}</span></div>`;
    by[cid].sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at)).forEach((v) => (out += reviewCard(v)));
    out += "</div>";
  }
  return out + "</section>";
}
function videoBox(v) {
  if (!v.storage_path) return '<div class="vid placeholder">Video file cleared after review.</div>';
  return `<div class="vid" data-video="${esc(v.storage_path)}">Loading video</div>`;
}
function hydrateVideos() {
  document.querySelectorAll("[data-video]").forEach(async (box) => {
    try {
      const url = await api.videoUrl(box.dataset.video);
      if (box.querySelector("video")) return;
      const v = document.createElement("video");
      v.src = url; v.controls = true; v.playsInline = true; v.preload = "metadata";
      box.textContent = ""; box.appendChild(v);
    } catch (e) {
      box.className = "vid placeholder"; box.textContent = "Couldn't load this video.";
    }
  });
}
function reviewCard(v) {
  const d = ui.drafts[v.id] || { verdict: "", feedback: "" };
  const late = v.slot < today();
  return `<article class="card qcard">${videoBox(v)}<div class="stack">
    <div class="row spread"><strong>${esc(v.exercise)}</strong>${late ? `<span class="chip red">From ${fmtDay(v.slot)}</span>` : ""}</div>
    <p class="small muted">Uploaded ${fmtTime(v.uploaded_at)}</p>
    ${v.note ? `<p class="small">"${esc(v.note)}"</p>` : '<p class="small muted">No note from the client.</p>'}
    ${v.storage_path ? `<div class="row"><button class="btn" data-act="breakdown" data-id="${v.id}">${v.review_path ? "Redo breakdown" : "Break it down"}</button>${v.review_path ? '<span class="chip green">Breakdown saved</span>' : '<span class="small muted">Slow-mo, draw and talk over it.</span>'}</div>` : ""}
    <div class="verdicts" role="group" aria-label="Verdict">${[["good", "Good to go"], ["tweak", "Small fix"], ["refilm", "Re-film it"]].map(([k, l]) =>
      `<button data-act="verdict" data-id="${v.id}" data-v="${k}" aria-pressed="${d.verdict === k}">${l}</button>`).join("")}</div>
    <label class="f">Feedback<textarea class="t" id="fb-${v.id}" data-input="feedback" data-id="${v.id}" placeholder="What you saw and what to change next set.">${esc(d.feedback)}</textarea></label>
    <div class="row"><button class="btn primary" data-act="send-feedback" data-id="${v.id}"${d.verdict ? "" : " disabled"}>Send feedback</button>${d.verdict ? "" : '<span class="muted small">Pick a verdict first.</span>'}</div>
  </div></article>`;
}
const verdictChip = (v) => ({ good: '<span class="chip green">Good to go</span>', tweak: '<span class="chip accent">Small fix</span>', refilm: '<span class="chip red">Re-film it</span>' })[v] || "";

/* ----- coach: breakdown tool ----- */
function vBreakdown() {
  const v = D.videos.find((x) => x.id === ui.bdId), c = v && profile(v.client_id);
  if (!v?.storage_path) { ui.view = null; return vQueue(); }
  return `<div class="row"><button class="link" data-act="back">Back to review</button></div>
    <section class="hero"><div class="kicker">Breakdown</div><h1>${esc(c?.name || "Client")}: ${esc(v.exercise)}</h1>
    ${v.note ? `<p class="small">"${esc(v.note)}"</p>` : ""}
    <p class="muted small">Tap Record, then play, slow down, pause and draw while you talk. Everything on screen and your voice go into one video for ${esc(c?.name || "your client")}.</p></section>
    <div id="bd-root" class="bd"><div class="empty">Loading video</div></div>`;
}
async function openBreakdown() {
  const v = D.videos.find((x) => x.id === ui.bdId), root = document.getElementById("bd-root");
  if (!v || !root) return;
  try {
    const src = await api.videoBlobUrl(v.storage_path);
    if (ui.view !== "breakdown" || ui.bdId !== v.id || !root.isConnected) return URL.revokeObjectURL(src);
    bd = mountBreakdown(root, {
      src,
      maxBytes: api.MAX_VIDEO_MB * 1048576,
      onSave: async (blob) => {
        const row = await api.uploadBreakdown(v, blob);
        D.videos = D.videos.map((x) => (x.id === row.id ? row : x));
      },
      onClose: () => { go(() => (ui.view = null)); toast("Breakdown saved. Add a verdict and send it."); },
    });
  } catch (e) {
    root.innerHTML = `<div class="empty">Couldn't open the video: ${esc(e.message || e)}</div>`;
  }
}

/* ----- coach: programs ----- */
function vPrograms() {
  let out = `<section class="hero"><div class="kicker">Library</div><h1>Programs</h1><p class="muted small">Build a block once, then assign it to any client. Prescriptions follow your notation: sets x reps @ target (cue).</p></section>
    <div class="row"><button class="btn primary" data-act="new-program">New program</button>${D.programs.length ? "" : '<button class="btn" data-act="example-program">Start from an example block</button>'}</div><div class="list">`;
  for (const p of D.programs) {
    const n = clients().filter((c) => c.program_id === p.id).length;
    const sessions = p.weeks.reduce((a, w) => a + w.days.length, 0);
    out += `<button class="item" data-act="open-program" data-id="${p.id}"><h3>${esc(p.name)}</h3><p class="small muted num">${p.weeks.length} weeks, ${sessions} sessions, ${n} client${n === 1 ? "" : "s"}</p>${p.note ? `<p class="small">${esc(p.note)}</p>` : ""}</button>`;
  }
  return out + "</div>";
}
function vProgramEdit() {
  const p = program(ui.programId);
  if (!p) { ui.view = null; return vPrograms(); }
  if (!p.weeks.length) p.weeks.push({ days: [] });
  ui.week = Math.min(ui.week, p.weeks.length - 1);
  const w = p.weeks[ui.week];
  let out = `<div class="row"><button class="link" data-act="back">Back to programs</button><span class="small muted" id="save-state"></span></div>
    <section class="stack"><div class="kicker">Program</div>
    <label class="f">Name<input class="t" id="p-name" data-input="p-name" value="${esc(p.name)}"></label>
    <label class="f">Description<input class="t" id="p-note" data-input="p-note" value="${esc(p.note)}"></label></section>
    <div class="row spread"><div class="week-tabs" role="group" aria-label="Week">${p.weeks.map((_, i) => `<button data-act="week" data-v="${i}" aria-pressed="${i === ui.week}">W${i + 1}</button>`).join("")}</div>
    <div class="row"><button class="btn small" data-act="dup-week">Copy W${ui.week + 1} to new week</button><button class="btn small ghost" data-act="add-week">Blank week</button>${p.weeks.length > 1 ? `<button class="btn small danger" data-act="del-week">Delete W${ui.week + 1}</button>` : ""}</div></div>`;
  const order = (d) => (d.dow + 6) % 7;
  for (const day of [...w.days].sort((a, b) => order(a) - order(b))) {
    const di = w.days.indexOf(day);
    out += `<section class="card"><div class="grid2">
      <label class="f">Session<input class="t" list="streams" id="d-name-${day.id}" data-input="d-name" data-d="${di}" value="${esc(day.name)}"></label>
      <label class="f">Day<select class="t" id="d-dow-${day.id}" data-change="d-dow" data-d="${di}">${[1, 2, 3, 4, 5, 6, 0].map((n) => `<option value="${n}"${day.dow === n ? " selected" : ""}>${DOW_LONG[n]}</option>`).join("")}</select></label></div>
      <label class="f">Coach instructions<textarea class="t" id="d-note-${day.id}" data-input="d-note" data-d="${di}" placeholder="Framing for the session. Optional.">${esc(day.coachNote)}</textarea></label>`;
    day.exercises.forEach((e, ei) => {
      out += `<div class="stack exblock"><div class="row spread"><span class="rx" id="rx-${e.id}">${esc(rxLine(e))}</span><span class="row">
        <button class="btn small ghost" data-act="ex-up" data-d="${di}" data-e="${ei}"${ei ? "" : " disabled"}>Up</button>
        <button class="btn small danger" data-act="ex-del" data-d="${di}" data-e="${ei}">Remove</button></span></div>
        <div class="grid-ex">${fld("Exercise", "name", e, di, ei, "wide")}${fld("Sets", "sets", e, di, ei, "", "number")}${fld("Reps", "reps", e, di, ei, "", "text", "8 or 10.10")}${fld("Load target", "target", e, di, ei, "", "text", "7 RPE or 70-75% of 1RM")}</div>
        <div class="grid2">${fld("Cue (in brackets)", "cue", e, di, ei)}${fld("Rest", "rest", e, di, ei, "", "text", "Rest 3-4 minutes between sets")}</div>
        ${fld("Instruction note", "note", e, di, ei, "", "text", "Increase load by 2.5-5kg from last week.")}</div>`;
    });
    out += `<div class="row spread"><button class="btn small" data-act="ex-add" data-d="${di}">Add exercise</button><button class="btn small danger" data-act="day-del" data-d="${di}">Delete session</button></div></section>`;
  }
  out += `<datalist id="streams">${STREAMS.map((s) => `<option value="${s}">`).join("")}</datalist>
    <div class="row"><button class="btn" data-act="day-add">Add session to W${ui.week + 1}</button></div>
    <div class="row">${ui.confirmDelProgram ? '<span>Delete this program? Clients on it lose their sessions.</span><button class="btn small primary" data-act="del-program-yes">Delete</button><button class="btn small" data-act="del-program-no">Keep it</button>' : '<button class="btn small danger" data-act="del-program">Delete program</button>'}</div>`;
  return out;
}
function fld(label, key, e, di, ei, cls = "", type = "text", ph = "") {
  return `<label class="f ${cls}">${label}<input class="t" id="x-${key}-${e.id}" type="${type}"${type === "number" ? ' min="1" inputmode="numeric"' : ""} data-input="ex" data-k="${key}" data-d="${di}" data-e="${ei}" value="${esc(e[key])}"${ph ? ` placeholder="${esc(ph)}"` : ""}></label>`;
}
function saveProgramSoon() {
  const p = program(ui.programId); if (!p) return;
  const s = document.getElementById("save-state"); if (s) s.textContent = "Saving";
  debounce("program", () => api.saveProgram(p).then(() => { const s2 = document.getElementById("save-state"); if (s2) s2.textContent = "Saved"; }).catch((e) => fail(e, "Program")));
}

/* ----- coach: clients ----- */
function vClients() {
  const pending = clients().filter((c) => !c.approved);
  let out = `<section class="hero"><div class="kicker">Roster</div><h1>Clients</h1>
    <p class="muted small">To add a client, send them this app's link. They create an account with their email and a password, then appear below for you to approve.</p></section>`;
  if (pending.length) out += `<section class="stack"><div class="section-head"><h2>Waiting for approval</h2></div><div class="list">${pending.map((c) =>
    `<div class="item static"><div class="row spread"><div><strong>${esc(c.name || "No name")}</strong><p class="small muted">${esc(c.email)}</p></div><button class="btn small primary" data-act="approve" data-id="${c.id}">Approve</button></div></div>`).join("")}</div></section>`;
  out += '<div class="list">';
  for (const c of clients().filter((c) => c.approved)) {
    const p = program(c.program_id), w = weekOf(c.start_date, new Date()), wk = p && w >= 0 && p.weeks[w];
    const logged = wk ? wk.days.filter((d) => findLog(c.id, p.id, w, d.id)?.done).length : 0;
    const vids = D.videos.filter((v) => v.client_id === c.id && v.status === "waiting").length;
    const status = !p ? "No program assigned" : w < 0 ? `${esc(p.name)}, starts ${fmtDay(c.start_date)}` : w >= p.weeks.length ? `${esc(p.name)}, block finished` : `${esc(p.name)}, week ${w + 1} of ${p.weeks.length}`;
    out += `<button class="item" data-act="open-client" data-id="${c.id}"><h3>${esc(c.name || c.email)}</h3><p class="small muted">${status}</p>
      <div class="row">${wk ? `<span class="chip num">${logged}/${wk.days.length} sessions this week</span>` : ""}${vids ? `<span class="chip accent num">${vids} video${vids > 1 ? "s" : ""} waiting</span>` : ""}</div></button>`;
  }
  if (!clients().some((c) => c.approved)) out += '<div class="empty">No clients yet.</div>';
  return out + "</div>";
}
function vClientDetail() {
  const c = profile(ui.clientId);
  if (!c) { ui.view = null; return vClients(); }
  let out = `<div class="row"><button class="link" data-act="back">Back to clients</button></div>
    <section class="stack"><div class="kicker">Client</div><h1>${esc(c.name || c.email)}</h1><p class="small muted">${esc(c.email)}</p>
    <label class="f">Goal<input class="t" id="c-goal" data-input="c-goal" value="${esc(c.goal)}"></label>
    <div class="grid2"><label class="f">Program<select class="t" id="c-prog" data-change="c-prog"><option value="">None</option>${D.programs.map((p) => `<option value="${p.id}"${c.program_id === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <label class="f">Start date<input class="t" type="date" id="c-start" data-change="c-start" value="${esc(c.start_date || "")}"></label></div>
    <p class="muted small">Start on a Monday so week numbers line up with the calendar.</p></section>`;
  const logs = D.logs.filter((l) => l.client_id === c.id);
  out += `<section class="stack"><div class="section-head"><h2>Logged sessions</h2><span class="muted small num">${logs.length}</span></div>${logs.length ? logs.map(logSummary).join("") : '<div class="empty">Nothing logged yet.</div>'}</section>`;
  const vids = D.videos.filter((v) => v.client_id === c.id);
  out += `<section class="stack"><div class="section-head"><h2>Videos</h2></div>${vids.length ? '<div class="list">' + vids.map((v) =>
    `<div class="item static"><div class="row spread"><strong>${esc(v.exercise)}</strong>${v.status === "waiting" ? `<span class="chip">For ${fmtDay(v.slot)}</span>` : verdictChip(v.verdict)}</div><p class="small muted">${fmtTime(v.uploaded_at)}</p></div>`).join("") + "</div>" : '<div class="empty">No videos yet.</div>'}</section>`;
  out += `<div class="row">${ui.confirmRevoke === c.id
    ? `<span>Remove ${esc(c.name || c.email)}'s access? Their history stays and you can approve them again later.</span><button class="btn small primary" data-act="revoke-yes">Remove access</button><button class="btn small" data-act="revoke-no">Cancel</button>`
    : '<button class="btn small danger" data-act="revoke">Remove access</button>'}</div>`;
  return out;
}
function logSummary(l) {
  const p = program(l.program_id), day = p?.weeks[l.week]?.days.find((d) => d.id === l.day_id);
  const lines = (l.entries || []).map((en) => {
    const e = day?.exercises.find((x) => x.id === en.exId); if (!e) return "";
    const sets = en.sets.filter((s) => s.done || s.kg || s.reps); if (!sets.length) return "";
    return `<div class="small"><strong>${esc(e.name)}</strong> <span class="muted num">${sets.map((s) => esc(s.reps || "-") + (s.kg ? ` x ${esc(s.kg)}kg` : "") + (s.rpe ? ` @${esc(s.rpe)}` : "")).join(", ")}</span></div>`;
  }).join("");
  return `<div class="card"><div class="row spread"><strong>${esc(day ? day.name : "Session")}</strong><span class="muted small">W${l.week + 1}, ${fmtDay(l.date)}${l.done ? "" : ", in progress"}</span></div>${lines}${l.note ? `<p class="small">"${esc(l.note)}"</p>` : ""}</div>`;
}

/* ----- client: training ----- */
function vToday() {
  const p = program(me.program_id);
  let out = `<section class="hero"><div class="kicker">Hey ${esc(me.name || "there")}</div>`;
  if (!p) return out + `<h1>No program yet</h1><p class="muted">Your coach hasn't assigned one. Check back soon.</p></section>`;
  const w = weekOf(me.start_date, new Date());
  if (w < 0) return out + `<h1>${esc(p.name)}</h1><p class="muted">Starts ${fmtLong(me.start_date)}.</p></section>`;
  if (w >= p.weeks.length) return out + `<h1>Block done</h1><p class="muted">You've finished ${esc(p.name)}. Your coach will load the next one.</p></section>`;
  const t = today(), days = [...p.weeks[w].days].sort((a, b) => sessionDate(me.start_date, w, a.dow) - sessionDate(me.start_date, w, b.dow));
  const todays = days.find((d) => ymd(sessionDate(me.start_date, w, d.dow)) === t);
  out += `<h1>${todays ? esc(todays.name) + " today" : `Week ${w + 1} of ${p.weeks.length}`}</h1><p class="muted small">${esc(p.name)}</p></section><div class="list">`;
  for (const d of days) {
    const dt = ymd(sessionDate(me.start_date, w, d.dow)), l = findLog(me.id, p.id, w, d.id);
    const state = l?.done ? '<span class="chip green">Logged</span>' : l ? '<span class="chip accent">In progress</span>' : dt < t ? '<span class="chip red">Missed</span>' : dt === t ? '<span class="chip solid">Today</span>' : `<span class="chip">${fmtDay(dt)}</span>`;
    out += `<button class="item" data-act="open-log" data-w="${w}" data-id="${d.id}"><div class="row spread"><h3>${esc(d.name)}</h3>${state}</div><p class="small muted">${fmtLong(dt)}, ${d.exercises.length} exercises</p></button>`;
  }
  out += "</div>";
  if (w > 0) out += `<details><summary>Earlier weeks</summary><div class="list" style="margin-top:10px">${p.weeks.slice(0, w).flatMap((wk, wi) => wk.days.map((d) =>
    `<button class="item" data-act="open-log" data-w="${wi}" data-id="${d.id}"><div class="row spread"><strong>W${wi + 1} ${esc(d.name)}</strong>${findLog(me.id, p.id, wi, d.id)?.done ? '<span class="chip green">Logged</span>' : '<span class="chip">Not logged</span>'}</div></button>`)).join("")}</div></details>`;
  return out;
}
function logFor(k) {
  const p = program(me.program_id), day = p?.weeks[k.w]?.days.find((d) => d.id === k.id);
  if (!day) return null;
  let l = findLog(me.id, p.id, k.w, day.id);
  if (!l) {
    // A draft stays out of D.logs until the client actually enters something.
    const dr = ui.draftLog;
    l = dr && dr.week === k.w && dr.day_id === day.id ? dr : (ui.draftLog = { id: crypto.randomUUID(), client_id: me.id, program_id: p.id, week: k.w, day_id: day.id, date: ymd(sessionDate(me.start_date, k.w, day.dow)), done: false, note: "",
      entries: day.exercises.map((e) => ({ exId: e.id, sets: Array.from({ length: +e.sets || 1 }, () => ({ reps: "", kg: "", rpe: "", done: false })) })) });
  }
  return { l, day };
}
function touchLog(l) {
  if (!D.logs.includes(l)) { D.logs.unshift(l); ui.draftLog = null; }
  return l;
}
function saveLogSoon(l, now) {
  touchLog(l);
  const go = () => api.saveLog(l).catch((e) => fail(e, "Your log"));
  if (now) { clearTimeout(timers["log"]); return go(); }
  debounce("log", go);
}
function vLog() {
  const r = logFor(ui.logKey);
  if (!r) { ui.view = null; return vToday(); }
  const { l, day } = r;
  let out = `<div class="row"><button class="link" data-act="back">Back</button></div><section class="hero"><div class="kicker">Week ${ui.logKey.w + 1}, ${fmtLong(l.date)}</div><h1>${esc(day.name)}</h1>
    ${day.coachNote ? `<div class="feedback"><span class="kicker">From your coach</span><p class="small">${esc(day.coachNote)}</p></div>` : ""}</section>`;
  day.exercises.forEach((e, ei) => {
    const en = l.entries.find((x) => x.exId === e.id) || (l.entries[ei] = { exId: e.id, sets: [{ reps: "", kg: "", rpe: "", done: false }] });
    const ins = [e.note, e.rest].filter(Boolean).join("\n");
    out += `<section class="card"><div class="row spread"><h3>${esc(e.name)}</h3><button class="link small" data-act="film" data-ex="${esc(e.name)}">Film a set</button></div>
      <p class="rx">${esc(rxLine(e))}</p>${ins ? `<p class="ins">${esc(ins)}</p>` : ""}
      <div class="colhead"><span>Set</span><span>Reps</span><span>kg</span><span>RPE</span><span></span></div>
      ${en.sets.map((s, si) => `<div class="setrow"><span class="n num">${si + 1}</span>${["reps", "kg", "rpe"].map((f) =>
        `<input class="t num" id="s-${e.id}-${si}-${f}" inputmode="decimal" aria-label="Set ${si + 1} ${f}" data-input="set" data-ex="${e.id}" data-s="${si}" data-f="${f}" value="${esc(s[f])}" placeholder="${f === "reps" ? esc(e.reps) : f === "rpe" ? "7" : ""}">`).join("")}
        <button class="tick" data-act="tick" data-ex="${e.id}" data-s="${si}" aria-pressed="${!!s.done}" aria-label="Set ${si + 1} done">${s.done ? "&#10003;" : ""}</button></div>`).join("")}</section>`;
  });
  out += `<label class="f">Notes for your coach<textarea class="t" id="log-note" data-input="log-note" placeholder="How it went, anything that felt off.">${esc(l.note)}</textarea></label>
    <div class="row"><button class="btn primary" data-act="finish-log">${l.done ? "Update session" : "Finish session"}</button></div>`;
  return out;
}

/* ----- client: videos ----- */
function vClientVideos() {
  const slot = slotFor(new Date()), p = program(me.program_id);
  const names = [...new Set((p?.weeks || []).flatMap((w) => w.days.flatMap((d) => d.exercises.map((e) => e.name))).filter(Boolean))];
  let out = `<section class="hero"><div class="kicker">Technique videos</div><h1>Drop it here, not in my DMs</h1>
    <p class="muted">I review videos every Tuesday and Thursday. Upload whenever suits you and you'll get feedback here on the next review day.</p>
    <div class="feedback"><span class="small">Anything you upload now goes into <strong>${fmtLong(slot)}'s</strong> review.</span></div></section>
    <section class="card"><label class="drop" id="drop" for="vfile"><strong>${ui.file ? esc(ui.file.name) : "Choose a video"}</strong>
      <span class="muted small">${ui.file ? `${(ui.file.size / 1048576).toFixed(1)} MB, tap to swap` : `Or drag one in. Side-on, whole body in frame. Up to ${api.MAX_VIDEO_MB} MB, so trim it to the set.`}</span></label>
      <input id="vfile" type="file" accept="video/*" hidden>
      <label class="f">Exercise<input class="t" id="v-ex" list="ex-names" autocomplete="off" maxlength="80" placeholder="e.g. Back Squat" value="${esc(ui.filmEx || "")}"></label>
      <datalist id="ex-names">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <label class="f">What should I look at?<textarea class="t" id="v-note" placeholder="Set 3 at 80kg. Does my back round?">${esc(ui.vnote || "")}</textarea></label>
      <div class="row"><button class="btn primary" data-act="upload"${ui.file && !ui.busy ? "" : " disabled"}>${ui.busy ? "Uploading..." : "Send to review queue"}</button></div></section>`;
  const mine = D.videos.filter((v) => v.client_id === me.id);
  out += `<section class="stack"><div class="section-head"><h2>Your videos</h2></div>${mine.length ? mine.map((v) =>
    `<article class="card qcard">${videoBox(v)}<div class="stack"><div class="row spread"><strong>${esc(v.exercise)}</strong>${v.status === "waiting" ? `<span class="chip">In ${fmtDay(v.slot)} review</span>` : verdictChip(v.verdict)}</div>
      <p class="small muted">Uploaded ${fmtTime(v.uploaded_at)}</p>${v.note ? `<p class="small">"${esc(v.note)}"</p>` : ""}
      ${v.status === "reviewed" ? `<div class="feedback"><span class="kicker">Coach feedback</span>${v.review_path ? `<p class="small">Watch your breakdown, sound on.</p><div class="vid wide" data-video="${esc(v.review_path)}">Loading breakdown</div>` : ""}${v.feedback || !v.review_path ? `<p class="small">${esc(v.feedback || "No notes.")}</p>` : ""}</div>` : ""}</div></article>`).join("") : '<div class="empty">No videos yet. Film a working set and drop it above.</div>'}</section>`;
  return out;
}
function vHistory() {
  const logs = D.logs.filter((l) => l.client_id === me.id);
  return `<section class="hero"><div class="kicker">Training log</div><h1>What you've done</h1></section>${logs.length ? logs.map(logSummary).join("") : '<div class="empty">Log a session from the Training tab and it shows up here.</div>'}`;
}

/* ---------- events ---------- */
const go = (fn) => { fn(); render(); };

const AUTH_ERRORS = {
  "Invalid login credentials": "That email and password don't match. Check them, or tap Forgot password.",
  "Email not confirmed": "Confirm your email first: tap the link we sent when you signed up, then sign in.",
  "User already registered": "There's already an account with that email. Sign in instead, or reset your password.",
};
const authError = (e) => AUTH_ERRORS[e.message] || e.message || String(e);

document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  if (f.id === "signin") {
    ev.preventDefault();
    const m = f.dataset.mode, email = document.getElementById("si-email").value.trim();
    const pass = document.getElementById("si-pass")?.value || "", name = document.getElementById("si-name")?.value.trim() || "";
    const msg = document.getElementById("si-msg"), btn = f.querySelector("button[type=submit]");
    ui.authEmail = email; btn.disabled = true; msg.textContent = "One sec...";
    try {
      if (m === "in") { await api.signIn(email, pass); msg.textContent = ""; }
      else if (m === "up") {
        const r = await api.signUp(email, pass, name);
        msg.textContent = r.session ? "" : `Nearly done. We've emailed ${email} a link to confirm it's you. Tap it, then sign in here.`;
      } else { await api.sendReset(email); msg.textContent = `If ${email} has an account, a reset link is on its way. Check your inbox.`; }
    } catch (e) { msg.textContent = authError(e); }
    btn.disabled = false;
  }
  if (f.id === "setpass") {
    ev.preventDefault();
    const msg = document.getElementById("sp-msg"), btn = f.querySelector("button[type=submit]");
    btn.disabled = true; msg.textContent = "Saving...";
    try {
      await api.setPassword(document.getElementById("sp-pass").value);
      toast("Password saved. Use it next time you sign in.");
      if (ui.recovery) { ui.recovery = false; started = null; start(await api.getSession()); }
      else go(() => (ui.view = null));
    } catch (e) { msg.textContent = authError(e); btn.disabled = false; }
  }
});

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const { act, v, id } = b.dataset, d = +b.dataset.d, e = +b.dataset.e;
  const p = program(ui.programId), wk = p?.weeks[ui.week];
  const progEdit = (fn) => { fn(); render(); saveProgramSoon(); };
  switch (act) {
    case "signout": await api.signOut(); started = null; me = null; ui.authMode = "in"; renderShell(vSignIn()); break;
    case "auth-mode": ui.authEmail = document.getElementById("si-email")?.value.trim() || ui.authEmail; ui.authMode = v; renderShell(vSignIn()); break;
    case "password": go(() => (ui.view = "password")); scrollTo(0, 0); break;
    case "tab":
    case "back":
      if (bd?.unsaved && !confirm("Leave without saving this breakdown?")) return;
      if (act === "tab") { go(() => { ui.tab = v; ui.view = null; }); scrollTo(0, 0); break; }
      go(() => { ui.view = null; ui.confirmRevoke = null; ui.confirmDelProgram = false; }); break;
    case "open-early": go(() => (ui.earlyOpen = true)); break;
    case "breakdown": go(() => { ui.bdId = id; ui.view = "breakdown"; }); scrollTo(0, 0); break;
    case "verdict": go(() => { ui.drafts[id] = { ...(ui.drafts[id] || { feedback: "" }), verdict: v }; }); break;
    case "send-feedback": {
      const dr = ui.drafts[id]; if (!dr?.verdict) return;
      b.disabled = true;
      try {
        const row = await api.reviewVideo(id, dr.verdict, dr.feedback || "");
        D.videos = D.videos.map((x) => (x.id === id ? row : x)); delete ui.drafts[id];
        render(); toast(`Feedback sent to ${profile(row.client_id)?.name || "client"}.`);
      } catch (err) { b.disabled = false; fail(err, "Feedback"); }
      break;
    }
    case "new-program":
    case "example-program":
      try {
        const base = act === "example-program" ? exampleProgram() : { name: "New program", note: "", weeks: [{ days: [{ id: newId(), name: "Tribe Build", dow: 1, coachNote: "", exercises: [] }] }] };
        const row = await api.createProgram(base);
        D.programs.unshift(row);
        go(() => { ui.programId = row.id; ui.week = 0; ui.view = "program"; }); scrollTo(0, 0);
      } catch (err) { fail(err, "Program"); }
      break;
    case "open-program": go(() => { ui.programId = id; ui.week = 0; ui.view = "program"; }); scrollTo(0, 0); break;
    case "week": go(() => (ui.week = +v)); break;
    case "dup-week": progEdit(() => {
      const copy = structuredClone(wk);
      copy.days.forEach((dd) => { dd.id = newId(); dd.exercises.forEach((x) => { x.id = newId(); if (x.note === W1_LINE) x.note = /%/.test(x.target) ? "" : "Increase load by 2.5-5kg from last week."; x.target = bumpTarget(x.target); }); });
      p.weeks.splice(ui.week + 1, 0, copy); ui.week += 1;
      toast("Copied. Percentages moved up 2.5% and calibration notes changed to adding load. Check each line.");
    }); break;
    case "add-week": progEdit(() => { p.weeks.push({ days: [] }); ui.week = p.weeks.length - 1; }); break;
    case "del-week": progEdit(() => { p.weeks.splice(ui.week, 1); ui.week = Math.max(0, ui.week - 1); }); break;
    case "day-add": progEdit(() => wk.days.push({ id: newId(), name: "Tribe Build", dow: 1, coachNote: "", exercises: [] })); break;
    case "day-del": progEdit(() => wk.days.splice(d, 1)); break;
    case "ex-add": progEdit(() => wk.days[d].exercises.push({ id: newId(), name: "", sets: 3, reps: "8", target: "7 RPE", cue: "", rest: "", note: ui.week === 0 ? W1_LINE : "" })); break;
    case "ex-del": progEdit(() => wk.days[d].exercises.splice(e, 1)); break;
    case "ex-up": progEdit(() => { const a = wk.days[d].exercises; [a[e - 1], a[e]] = [a[e], a[e - 1]]; }); break;
    case "del-program": go(() => (ui.confirmDelProgram = true)); break;
    case "del-program-no": go(() => (ui.confirmDelProgram = false)); break;
    case "del-program-yes":
      try { await api.deleteProgram(ui.programId); D.programs = D.programs.filter((x) => x.id !== ui.programId); D.profiles.forEach((c) => { if (c.program_id === ui.programId) c.program_id = null; }); go(() => { ui.view = null; ui.confirmDelProgram = false; }); }
      catch (err) { fail(err, "Delete"); }
      break;
    case "approve": await patchProfile(id, { approved: true }, "Approved."); break;
    case "open-client": go(() => { ui.clientId = id; ui.view = "client"; }); scrollTo(0, 0); break;
    case "revoke": go(() => (ui.confirmRevoke = ui.clientId)); break;
    case "revoke-no": go(() => (ui.confirmRevoke = null)); break;
    case "revoke-yes": await patchProfile(ui.clientId, { approved: false }, "Access removed."); ui.view = null; ui.confirmRevoke = null; render(); break;
    case "open-log": go(() => { ui.logKey = { w: +b.dataset.w, id }; ui.view = "log"; }); scrollTo(0, 0); break;
    case "tick": {
      const { l } = logFor(ui.logKey); const s = l.entries.find((x) => x.exId === b.dataset.ex).sets[+b.dataset.s];
      s.done = !s.done; render(); saveLogSoon(l);
      break;
    }
    case "finish-log": {
      const { l } = logFor(ui.logKey); l.done = true;
      const ok = await saveLogSoon(l, true);
      if (ok !== undefined) { go(() => (ui.view = null)); toast("Session logged."); scrollTo(0, 0); }
      break;
    }
    case "film": go(() => { ui.filmEx = b.dataset.ex; ui.tab = "videos"; ui.view = null; }); scrollTo(0, 0); break;
    case "upload": doUpload(); break;
    case "cleanup":
      try { const n = await api.cleanupVideos(D.videos); if (n) D = await api.loadAll(); render(); toast(n ? `Cleared ${n} old video file${n > 1 ? "s" : ""}. Feedback is kept.` : "Nothing old enough to clear."); }
      catch (err) { fail(err, "Clean-up"); }
      break;
  }
});

async function patchProfile(id, patch, msg) {
  try { const row = await api.updateProfile(id, patch); D.profiles = D.profiles.map((x) => (x.id === id ? row : x)); render(); if (msg) toast(msg); }
  catch (e) { fail(e, "Client"); }
}

document.addEventListener("input", (ev) => {
  const t = ev.target, a = t.dataset.input;
  if (t.id === "v-note") { ui.vnote = t.value; return; }
  if (t.id === "v-ex") { ui.filmEx = t.value; return; }
  if (!a) return;
  const p = program(ui.programId), wk = p?.weeks[ui.week], d = +t.dataset.d, e = +t.dataset.e;
  switch (a) {
    case "feedback": ui.drafts[t.dataset.id] = { ...(ui.drafts[t.dataset.id] || { verdict: "" }), feedback: t.value }; return;
    case "p-name": p.name = t.value; break;
    case "p-note": p.note = t.value; break;
    case "d-name": wk.days[d].name = t.value; break;
    case "d-note": wk.days[d].coachNote = t.value; break;
    case "ex": {
      const x = wk.days[d].exercises[e], k = t.dataset.k;
      x[k] = k === "sets" ? Math.max(1, +t.value || 1) : t.value;
      const rx = document.getElementById("rx-" + x.id); if (rx) rx.textContent = rxLine(x);
      break;
    }
    case "c-goal": { const c = profile(ui.clientId); c.goal = t.value; debounce("goal", () => api.updateProfile(c.id, { goal: c.goal }).catch((err) => fail(err, "Goal"))); return; }
    case "set": { const { l } = logFor(ui.logKey); l.entries.find((x) => x.exId === t.dataset.ex).sets[+t.dataset.s][t.dataset.f] = t.value; saveLogSoon(l); return; }
    case "log-note": { const { l } = logFor(ui.logKey); l.note = t.value; saveLogSoon(l); return; }
  }
  saveProgramSoon();
});

document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.id === "vfile") { const f = t.files?.[0]; if (f) setFile(f); return; }
  const a = t.dataset.change; if (!a) return;
  if (a === "d-dow") { program(ui.programId).weeks[ui.week].days[+t.dataset.d].dow = +t.value; render(); saveProgramSoon(); }
  if (a === "c-prog") await patchProfile(ui.clientId, { program_id: t.value || null }, "Program assigned.");
  if (a === "c-start") await patchProfile(ui.clientId, { start_date: t.value || null }, "Start date saved.");
});

function setFile(f) {
  if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm)$/i.test(f.name)) return toast("That isn't a video file.");
  if (f.size > api.MAX_VIDEO_MB * 1048576) return toast(`That video is ${(f.size / 1048576).toFixed(0)} MB. Trim it to just the set (under ${api.MAX_VIDEO_MB} MB) and try again.`);
  ui.file = f; render();
}
document.addEventListener("dragover", (ev) => { const z = ev.target.closest?.("#drop"); if (z) { ev.preventDefault(); z.classList.add("over"); } });
document.addEventListener("dragleave", (ev) => ev.target.closest?.("#drop")?.classList.remove("over"));
document.addEventListener("drop", (ev) => { const z = ev.target.closest?.("#drop"); if (!z) return; ev.preventDefault(); const f = ev.dataTransfer.files?.[0]; if (f) setFile(f); });

async function doUpload() {
  if (!ui.file || ui.busy) return;
  const exercise = document.getElementById("v-ex")?.value.trim(), note = document.getElementById("v-note")?.value.trim() || "";
  if (!exercise) { toast("Type which exercise this is first."); document.getElementById("v-ex")?.focus(); return; }
  ui.busy = true; render();
  try {
    const row = await api.uploadVideo(me.id, ui.file, { exercise, note, slot: slotFor(new Date()) });
    D.videos.unshift(row);
    ui.file = null; ui.vnote = ""; ui.filmEx = null;
    toast(`Sent. It's in ${fmtLong(row.slot)}'s review.`);
  } catch (e) { fail(e, "Your video"); }
  ui.busy = false; render();
}

if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
