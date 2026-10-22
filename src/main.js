import "./styles.css";
import * as api from "./api.js";
import { exampleProgram } from "./example.js";
import { mountBreakdown } from "./breakdown.js";
import { prepareVideo, checkVideo, warmUp } from "./upload.js";
import * as notify from "./notify.js";
import { liftSets, series, records, newPRs } from "./progress.js";
import { PR_LIFTS, PR_SETS, KINDS, validScore, scoreKind, prTarget, beats } from "./scores.js";
import { openTimer, closeTimer, presetFor, restSecs } from "./timer.js";
import {
  FEEDBACK_HOURS, DOW_LONG, W1_LINE, ymd, fmtDay, fmtLong, fmtTime,
  dueAt, timeLeft, weekOf, sessionDate, rxLine, bumpTarget, blockLabels, exKey, hasPct, pctLoad,
  daysBetween, parseYmd, METRICS, rowsOf, applyRows, parseVal, shortRx, bumpPct, DAY_ORDER, dayNum, valText,
} from "./schedule.js";

const STREAMS = ["Tribe Build", "Hypertrophy X", "TribeFit", "Aerobic Conditioning", "HYROX"];
const app = document.getElementById("app");
const tabsEl = document.getElementById("tabs");

// All data the signed-in person may see, loaded once and kept in sync as they act.
let D = { profiles: [], programs: [], logs: [], videos: [], messages: [], chatReady: false, clipsReady: false, exercises: [], maxes: [], progReady: false, teams: [], teamsReady: false, socialReady: false, prs: [], prHistory: [], prsReady: false, checkins: [], checkinsReady: false };
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
// What an athlete trains: their own program first, otherwise their team's, each with its start date.
const teamOf = (c) => D.teams.find((t) => t.id === c?.team_id);
function planFor(c) {
  if (c?.program_id && program(c.program_id)) return { p: program(c.program_id), start: c.start_date, team: null };
  const t = teamOf(c);
  if (t?.program_id && program(t.program_id)) return { p: program(t.program_id), start: t.start_date, team: t };
  return { p: null, start: null, team: t || null };
}
const libraryPrograms = () => D.programs.filter((p) => !p.owner_id);
// Exercise library entry and an athlete's 1RM for an exercise name, matched loosely.
const libFor = (name) => D.exercises.find((x) => exKey(x.name) === exKey(name));
const maxFor = (cid, name) => D.maxes.find((m) => m.client_id === cid && exKey(m.exercise) === exKey(name));
// Copy and paste between programs: one week, one session or one block (all exercises sharing a letter).
// Kept in this browser so it survives switching programs or reloading.
const CLIP_KEY = "tribe-clip";
const clip = {
  get() { try { return JSON.parse(localStorage.getItem(CLIP_KEY) || "null"); } catch { return null; } },
  set(c) { try { c ? localStorage.setItem(CLIP_KEY, JSON.stringify(c)) : localStorage.removeItem(CLIP_KEY); } catch {} },
};
// A pasted copy gets new ids so it never shares logs or edits with the original.
const freshDay = (d) => ({ ...structuredClone(d), id: newId(), exercises: d.exercises.map((x) => ({ ...structuredClone(x), id: newId() })) });
const freshWeek = (w) => ({ ...structuredClone(w), days: w.days.map(freshDay) });
function clipBar() {
  const c = clip.get();
  return c ? `<div class="clipbar row spread"><span class="small">Copied: <strong>${esc(c.label)}</strong>. ${{ week: "Paste it after any week, in this program or another.", session: "Paste it on any day with Paste, in this program or another.", block: "Open any session and tap Paste block." }[c.kind]}</span><button class="link small" data-act="clip-clear">Clear</button></div>` : "";
}
const nextBlock = (exs) => { const last = exs.map((e) => String(e.block || "").trim().toUpperCase()).filter(Boolean).pop(); return last ? String.fromCharCode(Math.min(90, last.charCodeAt(0) + 1)) : "A"; };
// Breakdown clips on a video, oldest first: one from before labels (review_path), then the labelled ones.
const clipsOf = (v) => [...(v.review_path ? [{ path: v.review_path, label: "Breakdown" }] : []), ...(v.clips || [])];
const unread = (cid) => D.messages.filter((m) => m.client_id === cid && m.sender_id !== me.id && !m.read_at).length;

let bd = null; // the open breakdown tool, if any
let stopChat = null; // live message subscription

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

// An athlete's data as last loaded, for opening the app with no connection.
const snapshot = {
  key: (uid) => `tribe-snapshot-${uid}`,
  save(uid, v) { try { localStorage.setItem(this.key(uid), JSON.stringify(v)); } catch { /* too big or blocked: no offline copy */ } },
  load(uid) { try { return JSON.parse(localStorage.getItem(this.key(uid))); } catch { return null; } },
};
let started = null;
async function start(session) {
  const uid = session?.user?.id || null;
  if (ui.recovery || (started === uid && me)) return;
  started = uid;
  if (!uid) { me = null; return renderShell(vSignIn()); }
  ui.authMode = "in";
  renderShell('<div class="empty">Loading</div>');
  try {
    let snap = null;
    try {
      me = await api.myProfile(uid);
      if (!me) return renderShell(vPending(true));
      if (!me.approved) return renderShell(vPending(false));
      D = await api.loadAll();
      ui.offlineData = false;
      if (!isCoach()) snapshot.save(uid, { me, D });
    } catch (e) {
      // No connection: an athlete carries on from the copy saved last time, so they can still log.
      if (!(snap = snapshot.load(uid))) throw e;
      ({ me, D } = snap); ui.offlineData = true;
      addEventListener("online", () => { started = null; start(session); }, { once: true });
    }
    flushPending();
    stopChat?.(); stopChat = D.chatReady ? api.onMessage(onIncoming) : null;
    ui.tab = isCoach() ? "queue" : "today";
    render();
    if (location.hash) { openLink(location.hash); history.replaceState(null, "", location.pathname + location.search); }
    notify.state().then((st) => { ui.push = st; if (!bd) render(); }).catch(() => {});
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
function renderTabs() {
  const tabs = isCoach()
    ? [["queue", "Review", waiting().length], ["programs", "Programs"], ["clients", "Clients", clients().filter((c) => !c.approved).length + clients().reduce((n, c) => n + unread(c.id), 0)]]
    : [["today", "Training"], ["videos", "Videos"], ["chat", "Coach", unread(me.id)], ["history", "Log"]];
  document.querySelector(".tabs").hidden = false;
  tabsEl.innerHTML = tabs.map(([k, label, n]) =>
    `<button data-act="tab" data-v="${k}"${ui.tab === k && !ui.view ? ' aria-current="page"' : ""}><span class="tab-ico">${TAB_ICON[k]}${n ? `<span class="badge num">${n}</span>` : ""}</span>${label}</button>`).join("");
}
function render() {
  renderTabs();

  if (bd && ui.view !== "review") { bd.destroy(); bd = null; }
  if (ui.view !== "review") dropPrefetch();
  if (bd) return; // the breakdown tool manages its own screen

  let html;
  if (ui.view === "program") html = vProgramEdit();
  else if (ui.view === "session") html = vSession();
  else if (ui.view === "client") html = vClientDetail();
  else if (ui.view === "log") html = vLog();
  else if (ui.view === "exlib") html = vExLib();
  else if (ui.view === "team") html = vTeam();
  else if (ui.view === "password") html = vSetPassword(false);
  else if (ui.view === "review") html = vReview();
  else if (isCoach()) html = ui.tab === "queue" ? vQueue() : ui.tab === "programs" ? vPrograms() : vClients();
  else html = ui.tab === "today" ? vToday() : ui.tab === "videos" ? vClientVideos() : ui.tab === "chat" ? vClientChat() : vHistory();
  app.innerHTML = offlineBar() + html + footer();
  hydrateVideos();
  afterChatPaint();
  filterAth();
  hydrateBoards();
  document.body.classList.toggle("wide", ["program", "session"].includes(ui.view) || (isCoach() && !ui.view && ui.tab === "clients"));
  if (ui.view === "review") { openBreakdown(); paintCompare(); }
}

function lockup() {
  return `<div class="lockup"><div class="logo" role="img" aria-label="TRIBE.HQ"></div><div class="tag">Functional Strength &amp; Conditioning</div></div>`;
}
function footer() {
  return lockup() + `<div class="row" style="justify-content:center">
    <span class="small muted">${esc(me.email || "")}</span>${D.chatReady && ui.push === "on" ? '<button class="btn small ghost" data-act="push-off">Turn off notifications</button>' : ""}<button class="btn small ghost" data-act="password">Change password</button><button class="btn small ghost" data-act="signout">Sign out</button>
    ${isCoach() ? '<button class="btn small ghost" data-act="cleanup">Clear video files reviewed 30+ days ago</button>' : ""}</div>`;
}

/* ----- coach: review queue ----- */
const queue = () => waiting().sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at));
function vQueue() {
  const list = queue();
  const overdue = list.filter((v) => timeLeft(dueAt(v.uploaded_at)).overdue).length;
  let out = `<section class="hero"><div class="kicker">Video review</div>
    <div class="hero-grid"><div class="big num">${list.length}</div><h1>${list.length ? `video${list.length === 1 ? "" : "s"} to review` : "All caught up"}</h1></div>
    <p class="muted small">You get an email for each new video. Clients are promised feedback within ${FEEDBACK_HOURS} hours.${overdue ? ` <strong>${overdue} past ${FEEDBACK_HOURS} hours.</strong>` : ""}</p>
    ${list.length ? `<div class="row"><button class="btn primary" data-act="review" data-id="${list[0].id}">Start reviewing</button><span class="small muted">Oldest first. Send one and the next opens.</span></div>` : ""}</section>`;
  if (list.length) out += `<section class="stack"><div class="section-head"><h2>Oldest first</h2></div><div class="list">${list.map(queueRow).join("")}</div></section>`;
  else out += '<div class="empty">No videos waiting. You\'ll get an email when a client sends one.</div>';
  return out + reviewedList();
}
function queueRow(v) {
  const c = profile(v.client_id), left = timeLeft(dueAt(v.uploaded_at));
  return `<button class="item" data-act="review" data-id="${v.id}"><div class="row spread"><h3>${esc(c?.name || "Client")}: ${esc(v.exercise)}</h3><span class="chip${left.overdue ? " red" : ""}">${left.label}</span></div>
    <p class="small muted">Uploaded ${fmtTime(v.uploaded_at)}${clipsOf(v).length ? `, ${clipsOf(v).length} breakdown${clipsOf(v).length > 1 ? "s" : ""} saved` : ""}</p>${v.note ? `<p class="small">"${esc(v.note)}"</p>` : ""}</button>`;
}
function reviewedList() {
  const done = D.videos.filter((v) => v.status === "reviewed").sort((a, b) => (b.reviewed_at || "").localeCompare(a.reviewed_at || ""));
  return done.length ? `<details class="stack"><summary>Reviewed (${done.length})</summary><div class="list" style="margin-top:10px">${done.slice(0, 30).map((v) =>
    `<div class="item static"><div class="row spread"><strong>${esc(profile(v.client_id)?.name || "Client")} - ${esc(v.exercise)}</strong><span class="row">${clipsOf(v).length ? `<span class="chip">${clipsOf(v).length > 1 ? `${clipsOf(v).length} breakdowns` : "Breakdown"}</span>` : ""}${verdictChip(v.verdict)}</span></div><p class="small muted">${esc(v.feedback)}</p></div>`).join("")}</div></details>` : "";
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
      if (box.nextElementSibling?.dataset.act !== "save-vid")
        box.insertAdjacentHTML("afterend", `<button class="link small save-vid" data-act="save-vid" data-path="${esc(box.dataset.video)}">Save video</button>`);
    } catch (e) {
      box.className = "vid placeholder"; box.textContent = "Couldn't load this video.";
    }
  });
}
// On a phone the share sheet is the only route to the camera roll (iPhone has no download in its
// video controls). Sharing has to follow a tap closely, so a slow download asks for a second tap.
const saved = new Map();
async function saveVideo(b) {
  const path = b.dataset.path;
  let file = saved.get(path);
  if (!file) {
    b.disabled = true; b.textContent = "Saving";
    try {
      const blob = await api.videoBlob(path), ext = path.split(".").pop() || "mp4";
      file = new File([blob], `tribe-${path.split("/").pop().replace(/\.[^.]*$/, "")}.${ext}`, { type: blob.type || `video/${ext === "mov" ? "quicktime" : ext}` });
      saved.set(path, file);
    } catch (e) { console.error(e); return toast("Couldn't download this video. Check your connection and try again."); } finally { b.disabled = false; b.textContent = "Save video"; }
  }
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try { return await navigator.share({ files: [file] }); } catch (e) {
      if (e.name === "AbortError") return;
      if (e.name === "NotAllowedError") { b.textContent = "Tap again to save"; return; }
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const verdictChip = (v) => ({ good: '<span class="chip green">Good to go</span>', tweak: '<span class="chip accent">Small fix</span>', refilm: '<span class="chip red">Re-film it</span>' })[v] || "";

/* ----- coach: review one video at a time ----- */
// The breakdown tool owns its part of the screen while it's open (render() leaves it alone), so the
// feedback panel and compare picker below update their own DOM instead of re-rendering.
function nextAfter(v) {
  const rest = queue().filter((x) => x.id !== v.id);
  return rest.find((x) => x.uploaded_at > v.uploaded_at) || rest[0] || null;
}
function openReview(id, lib = false) {
  if (bd) { bd.destroy(); bd = null; }
  ui.cmpOpen = false; ui.lib = lib;
  go(() => { ui.view = id ? "review" : null; ui.bdId = id; });
  scrollTo(0, 0);
}
// Downloads of the next video start while the coach works on the current one.
const prefetched = new Map();
function clipUrl(path) {
  const hit = prefetched.get(path);
  prefetched.delete(path);
  return hit || api.videoBlobUrl(path);
}
function prefetch(paths) {
  for (const [p, u] of prefetched) if (!paths.includes(p)) { prefetched.delete(p); u.then((x) => x && URL.revokeObjectURL(x)); }
  paths.forEach((p) => prefetched.has(p) || prefetched.set(p, api.videoBlobUrl(p).catch(() => null)));
}
const dropPrefetch = () => prefetch([]);

function vReview() {
  const v = D.videos.find((x) => x.id === ui.bdId), c = v && profile(v.client_id);
  if (!v?.storage_path) { ui.view = null; return vQueue(); }
  const list = queue(), at = list.findIndex((x) => x.id === v.id), left = timeLeft(dueAt(v.uploaded_at));
  const { p, start } = planFor(c), w = weekOf(start, new Date());
  if (ui.lib) return `<div class="row"><button class="link" data-act="lib-back">Back to ${esc(c?.name || "client")}'s library</button></div>
    <section class="hero"><div class="kicker">${esc(c?.name || "Client")}, library</div><h1>${esc(v.exercise)}</h1>
    <div class="row">${v.status === "waiting" ? '<span class="chip">Waiting for review</span>' : verdictChip(v.verdict)}<span class="small muted">Uploaded ${fmtTime(v.uploaded_at)}</span></div>
    ${v.feedback ? `<p class="small">Your feedback: ${esc(v.feedback)}</p>` : ""}</section>
    <div class="row"><button class="btn small" data-act="cmp-toggle" id="cmp-btn">Compare</button><span class="small muted" id="cmp-state">Put an earlier rep or one of your reference reps beside or over this one.</span></div>
    <div id="cmp-pick" class="card stack" hidden></div>
    <div id="bd-root" class="bd"><div class="empty">Loading video</div></div>
    <p class="small muted">${D.chatReady ? `Record and save a breakdown and it's sent to ${esc(c?.name || "them")} in your chat.` : "Saving a breakdown here replaces the one on this video."}</p>`;
  return `<div class="row spread"><button class="link" data-act="back">Back to queue</button>${at >= 0 ? `<span class="small muted num">${at + 1} of ${list.length}</span>` : ""}</div>
    <section class="hero"><div class="kicker">${esc(c?.name || "Client")}${p ? `, ${esc(p.name)}${w >= 0 ? ` week ${w + 1}` : ""}` : ""}</div><h1>${esc(v.exercise)}</h1>
    <div class="row"><span class="chip${left.overdue ? " red" : ""}">${left.label}</span><span class="small muted">Uploaded ${fmtTime(v.uploaded_at)}</span></div>
    ${v.note ? `<p>"${esc(v.note)}"</p>` : '<p class="small muted">No note from the client.</p>'}</section>
    <div class="row"><button class="btn small" data-act="cmp-toggle" id="cmp-btn">Compare</button><span class="small muted" id="cmp-state">Put an earlier rep or one of your reference reps beside or over this one.</span></div>
    <div id="cmp-pick" class="card stack" hidden></div>
    <div id="bd-root" class="bd"><div class="empty">Loading video</div></div>
    <p class="small muted">To send a breakdown: tap Record, then play, slow down, pause and draw while you talk. Everything on screen and your voice go into one video for ${esc(c?.name || "your client")}.${D.clipsReady ? " Cover one point per recording and label it; they all go out together when you send." : ""}</p>
    ${D.clipsReady ? `<section class="card stack" id="rv-clips">${clipsPanel(v)}</section>` : ""}
    <section class="card stack" id="rv-panel">${reviewPanel(v)}</section>`;
}
function clipsPanel(v) {
  const list = clipsOf(v);
  return `<div class="section-head"><h3>Breakdowns</h3><span class="small muted num">${list.length}</span></div>
    ${list.length ? `<div class="list">${list.map((c, i) => `<div class="item static row spread"><span><span class="num muted">${i + 1}.</span> ${esc(c.label)}</span>
      <span class="row"><button class="btn small ghost" data-act="clip-play" data-path="${esc(c.path)}">Watch</button><button class="btn small ghost" data-act="clip-del" data-id="${v.id}" data-path="${esc(c.path)}" aria-label="Delete ${esc(c.label)}">Delete</button></span></div>`).join("")}</div>
      <div id="clip-watch"></div>` : '<p class="small muted">None yet. Record one point, label it, then record the next.</p>'}`;
}
function paintClips(v) { const el = document.getElementById("rv-clips"); if (el) el.innerHTML = clipsPanel(v); }
function reviewPanel(v) {
  const d = ui.drafts[v.id] || { verdict: "", feedback: "" }, next = nextAfter(v);
  return `<h3>Feedback</h3>
    <div class="verdicts" role="group" aria-label="Verdict">${[["good", "Good to go"], ["tweak", "Small fix"], ["refilm", "Re-film it"]].map(([k, l]) =>
      `<button data-act="rv-verdict" data-id="${v.id}" data-v="${k}" aria-pressed="${d.verdict === k}">${l}</button>`).join("")}</div>
    <label class="f">Notes<textarea class="t" id="fb-${v.id}" data-input="feedback" data-id="${v.id}" placeholder="What you saw and what to change next set.">${esc(d.feedback)}</textarea></label>
    <div class="row"><button class="btn primary" data-act="rv-send" data-id="${v.id}"${d.verdict ? "" : " disabled"}>${next ? "Send and next video" : "Send feedback"}</button>
    ${next ? `<button class="btn ghost" data-act="rv-skip" data-id="${v.id}">Skip for now</button>` : ""}<span class="muted small" id="rv-hint">${d.verdict ? "" : "Pick a verdict first."}</span></div>`;
}
async function openBreakdown() {
  const v = D.videos.find((x) => x.id === ui.bdId), root = document.getElementById("bd-root");
  if (!v || !root) return;
  const next = nextAfter(v);
  try {
    const src = await clipUrl(v.storage_path);
    if (!src) throw new Error("download failed");
    if (ui.view !== "review" || ui.bdId !== v.id || !root.isConnected) return URL.revokeObjectURL(src);
    const toChat = ui.lib && D.chatReady, multi = toChat || D.clipsReady;
    const cur = () => D.videos.find((x) => x.id === v.id) || v;
    bd = mountBreakdown(root, {
      src, label: fmtDay(new Date(v.uploaded_at)),
      maxBytes: api.MAX_VIDEO_MB * 1048576,
      multi, nextLabel: () => (toChat ? v.exercise : `Point ${clipsOf(cur()).length + 1}`),
      onSave: async (blob, label) => {
        if (toChat) {
          const clip_path = await api.uploadChatClip(v.client_id, blob);
          addMessage(await api.sendMessage({ client_id: v.client_id, body: label && label !== v.exercise ? `Breakdown: ${v.exercise}, ${label}` : `Breakdown: ${v.exercise}`, video_id: v.id, clip_path }));
          return toast(`Sent to ${profile(v.client_id)?.name || "the athlete"}'s chat.`);
        }
        const row = D.clipsReady ? await api.addClip(cur(), blob, label) : await api.uploadBreakdown(v, blob);
        D.videos = D.videos.map((x) => (x.id === row.id ? row : x));
        paintClips(row);
        toast(ui.lib ? "Breakdown saved." : D.clipsReady ? `Saved "${label}". Record another point, or add a verdict and send.` : "Breakdown saved. Add a verdict and send it.");
      },
    });
    if (!ui.lib) prefetch(next ? [next.storage_path] : []);
  } catch (e) {
    root.innerHTML = `<div class="empty">Couldn't open the video: ${esc(e.message || e)}</div>`;
  }
}

/* compare picker */
async function paintCompare() {
  const box = document.getElementById("cmp-pick"), v = D.videos.find((x) => x.id === ui.bdId);
  if (!box || !v) return;
  box.hidden = !ui.cmpOpen;
  if (!ui.cmpOpen) return;
  const same = (x) => x.exercise.trim().toLowerCase() === v.exercise.trim().toLowerCase();
  const theirs = D.videos.filter((x) => x.client_id === v.client_id && x.id !== v.id && x.storage_path)
    .sort((a, b) => same(b) - same(a) || b.uploaded_at.localeCompare(a.uploaded_at)); // same exercise first, newest first
  const pick = (path, label, title) => `<button class="item" data-act="cmp-pick" data-path="${esc(path)}" data-label="${esc(label)}">${title}</button>`;
  box.innerHTML = `<div class="section-head"><h3>Compare with</h3><button class="link" data-act="cmp-toggle">Close</button></div>
    <p class="kicker">${esc(profile(v.client_id)?.name || "Client")}'s other videos</p>
    ${theirs.length ? `<div class="list">${theirs.map((x) => pick(x.storage_path, fmtDay(new Date(x.uploaded_at)), `<div class="row spread"><strong>${esc(x.exercise)}</strong><span class="row">${verdictChip(x.verdict)}<span class="small muted">${fmtDay(new Date(x.uploaded_at))}</span></span></div>`)).join("")}</div>` : '<p class="small muted">No other videos from them yet.</p>'}
    <p class="kicker">Your reference reps</p>
    ${ui.refs == null ? '<p class="small muted">Loading...</p>' : ui.refs.length ? `<div class="list">${ui.refs.map((r) =>
      `<div class="row ref-row">${pick(r.path, r.label, `<strong>${esc(r.label)}</strong>`)}<button class="btn small ghost" data-act="ref-del" data-path="${esc(r.path)}" aria-label="Delete ${esc(r.label)}">Delete</button></div>`).join("")}</div>` : '<p class="small muted">None yet. Add a clip of a good rep and use it with any athlete.</p>'}
    <div class="row"><input class="t" id="ref-label" maxlength="50" placeholder="Name it, e.g. Back Squat side on" aria-label="Reference rep name">
    <label class="btn small" for="ref-file">Add reference rep</label><input id="ref-file" type="file" accept="video/*" hidden></div>
    <p class="small" id="ref-msg" role="status"></p>`;
  if (ui.refs == null) {
    try { ui.refs = await api.listRefs(me.id); } catch (e) { ui.refs = []; toast(`Couldn't load your reference reps: ${e.message || e}`); }
    paintCompare();
  }
}
function cmpState(text, on) {
  const s = document.getElementById("cmp-state"), b = document.getElementById("cmp-btn");
  if (s) s.innerHTML = text;
  if (b) { b.textContent = on ? "Change compare" : "Compare"; }
}
async function pickCompare(path, label) {
  if (!bd) return;
  if (bd.recording) return toast("Stop recording before changing the compare video.");
  ui.cmpOpen = false; paintCompare();
  cmpState("Loading compare video...");
  try {
    const url = await api.videoBlobUrl(path);
    if (!bd || !bd.setCompare(url, label)) { URL.revokeObjectURL(url); cmpState(""); return; }
    cmpState(`Comparing with <strong>${esc(label)}</strong>. Line the reps up one at a time, then play Both. Tap Overlay to lay it over this video instead. <button class="link" data-act="cmp-clear">Remove</button>`, true);
  } catch (e) { cmpState(`Couldn't load that video: ${esc(e.message || e)}`); }
}
async function addRef(file) {
  const msg = document.getElementById("ref-msg"), label = document.getElementById("ref-label")?.value.trim();
  if (!label) { msg.textContent = "Name the reference rep first, then choose the video."; document.getElementById("ref-label")?.focus(); return; }
  try {
    const f = await prepareVideo(file, (t) => (msg.textContent = t));
    msg.textContent = "Uploading...";
    const r = await api.uploadRef(me.id, f, label);
    ui.refs = [r, ...(ui.refs || [])];
    await pickCompare(r.path, r.label);
  } catch (e) { msg.textContent = `Didn't upload: ${e.message || e}`; }
}

/* ----- coach: programs ----- */
function vPrograms() {
  let out = `<section class="hero"><div class="kicker">Library</div><h1>Programs</h1><p class="muted small">Build a block once, then assign it to any client. Prescriptions follow your notation: sets x reps @ target (cue).</p></section>
    <div class="row"><button class="btn primary" data-act="new-program">New program</button>${libraryPrograms().length ? "" : '<button class="btn" data-act="example-program">Start from an example block</button>'}${D.progReady ? `<button class="btn" data-act="open-exlib">Exercise library (${D.exercises.length})</button>` : ""}</div><div class="list">`;
  for (const p of libraryPrograms()) {
    const n = clients().filter((c) => planFor(c).p?.id === p.id).length;
    const sessions = p.weeks.reduce((a, w) => a + w.days.length, 0);
    out += `<button class="item" data-act="open-program" data-id="${p.id}"><h3>${esc(p.name)}</h3><p class="small muted num">${p.weeks.length} weeks, ${sessions} sessions, ${n} client${n === 1 ? "" : "s"}</p>${p.note ? `<p class="small">${esc(p.note)}</p>` : ""}</button>`;
  }
  return out + "</div>";
}
// The program as a grid: weeks down the page, Day 1 to Day 7 across, each session a card.
function sessCard(wi, day, current) {
  const labels = blockLabels(day.exercises);
  return `<button class="sess${current ? " on" : ""}" data-act="open-sess" data-w="${wi}" data-id="${day.id}"><span class="sess-name">${esc(day.name || "Session")}</span>
    ${day.exercises.map((e, i) => `<span class="sx${/\d$/.test(labels[i] || "") ? " ss" : ""}"><span class="lb">${labels[i] || ""}</span><span class="sx-t"><span>${esc(e.name || "New exercise")}</span><span class="muted small num">${esc(shortRx(e))}</span></span></span>`).join("")}
    ${day.exercises.length ? "" : '<span class="muted small">No exercises yet</span>'}</button>`;
}
function vProgramEdit() {
  const p = program(ui.programId);
  if (!p) { ui.view = null; return vPrograms(); }
  if (!p.weeks.length) p.weeks.push({ days: [] });
  const cb = clip.get();
  let out = `${clipBar()}<div class="row"><button class="link" data-act="back">${p.owner_id ? "Back to athlete" : "Back to programs"}</button><span class="small muted" id="save-state"></span></div>
    <section class="stack"><div class="kicker">${p.owner_id ? `Program just for ${esc(profile(p.owner_id)?.name || "one athlete")}` : "Program"}</div>
    <div class="grid2"><label class="f">Name<input class="t" id="p-name" data-input="p-name" value="${esc(p.name)}"></label>
    <label class="f">Description<input class="t" id="p-note" data-input="p-note" value="${esc(p.note)}"></label></div>
    <p class="small muted">${p.weeks.length} week${p.weeks.length === 1 ? "" : "s"}. Tap a session to edit it, or + to add one on that day. Day 1 is Monday.</p></section>
    <div class="pgrid-wrap"><div class="pgrid">${DAY_ORDER.map((dow) => `<div class="pg-head">Day ${dayNum(dow)} <span class="muted">${DOW_LONG[dow].slice(0, 3)}</span></div>`).join("")}`;
  p.weeks.forEach((w, wi) => {
    out += `<div class="pg-week"><h2>Week ${wi + 1}</h2><span class="row"><button class="btn small" data-act="dup-week" data-w="${wi}">Copy to new week</button><button class="btn small" data-act="clip-week" data-w="${wi}">Copy week</button>${cb?.kind === "week" ? `<button class="btn small primary" data-act="paste-week" data-w="${wi}">Paste after</button>` : ""}${p.weeks.length > 1 ? `<button class="btn small danger" data-act="del-week" data-w="${wi}">Delete</button>` : ""}</span></div>`;
    out += DAY_ORDER.map((dow) => `<div class="pg-cell">${w.days.filter((d) => d.dow === dow).map((d) => sessCard(wi, d)).join("")}
      <button class="pg-add" data-act="sess-add" data-w="${wi}" data-dow="${dow}" aria-label="Add a session to week ${wi + 1} day ${dayNum(dow)}">+</button>${cb?.kind === "session" ? `<button class="pg-add paste" data-act="paste-sess" data-w="${wi}" data-dow="${dow}" aria-label="Paste ${esc(cb.label)} into week ${wi + 1} day ${dayNum(dow)}">Paste</button>` : ""}</div>`).join("");
  });
  out += `</div></div>
    <div class="row"><button class="btn" data-act="add-week">Add a blank week</button>${cb?.kind === "week" ? `<button class="btn primary" data-act="paste-week" data-w="${p.weeks.length - 1}">Paste ${esc(cb.label)} at the end</button>` : ""}</div>
    <div class="row">${ui.confirmDelProgram ? '<span>Delete this program? Clients on it lose their sessions.</span><button class="btn small primary" data-act="del-program-yes">Delete</button><button class="btn small" data-act="del-program-no">Keep it</button>' : '<button class="btn small danger" data-act="del-program">Delete program</button>'}</div>`;
  return out;
}

// One session: the program's days on the left as a calendar, the session itself on the right.
function vSession() {
  const p = program(ui.programId), s = ui.sess;
  if (!p || !s || !p.weeks[s.w]) { ui.view = p ? "program" : null; return p ? vProgramEdit() : vPrograms(); }
  const wk = p.weeks[s.w], day = wk.days.find((d) => d.id === s.id), dow = day ? day.dow : s.dow, di = wk.days.indexOf(day);
  const sameDay = wk.days.filter((d) => d.dow === dow), cb = clip.get();
  const cal = p.weeks.map((w, wi) => `<div class="cal-wk"><span class="kicker">Week ${wi + 1}</span><div class="cal-row">${DAY_ORDER.map((dd) => {
    const n = w.days.filter((d) => d.dow === dd).length;
    return `<button class="cal-d num" data-act="sess-day" data-w="${wi}" data-dow="${dd}"${wi === s.w && dd === dow ? ' aria-current="true"' : ""} aria-label="Week ${wi + 1} day ${dayNum(dd)}, ${n} session${n === 1 ? "" : "s"}">${wi * 7 + dayNum(dd)}<span class="dots">${"&bull;".repeat(Math.min(n, 3))}</span></button>`; }).join("")}</div></div>`).join("");
  let out = `<div class="sess-layout"><aside class="sess-side"><div class="cal">${cal}</div>
    <div class="stack"><h2>Day ${s.w * 7 + dayNum(dow)}</h2>${sameDay.map((d) => sessCard(s.w, d, d === day)).join("")}
    <button class="btn small" data-act="sess-add" data-w="${s.w}" data-dow="${dow}">Add ${sameDay.length ? "another" : "a"} session</button>
    ${cb?.kind === "session" ? `<button class="btn small primary" data-act="paste-sess" data-w="${s.w}" data-dow="${dow}">Paste ${esc(cb.label)} here</button>` : ""}</div></aside><div class="sess-main stack">${clipBar()}
    <div class="row spread"><button class="link" data-act="back">Back to program</button><span class="small muted" id="save-state"></span></div>
    <h1>Week ${s.w + 1} Day ${dayNum(dow)}</h1>`;
  if (!day) return out + `<div class="empty">No session on this day.</div></div></div>`;
  out += `<section class="stack"><div class="grid2"><label class="f">Session<input class="t" list="streams" id="d-name-${day.id}" data-input="d-name" data-d="${di}" value="${esc(day.name)}"></label>
    <label class="f">Day<select class="t" id="d-dow-${day.id}" data-change="d-dow" data-d="${di}">${DAY_ORDER.map((n) => `<option value="${n}"${day.dow === n ? " selected" : ""}>Day ${dayNum(n)} (${DOW_LONG[n]})</option>`).join("")}</select></label></div>
    <label class="f">Coach instructions<textarea class="t tall" id="d-note-${day.id}" data-input="d-note" data-d="${di}" placeholder="Framing for the session: what to chase, what to log.">${esc(day.coachNote)}</textarea></label></section>`;
  const labels = blockLabels(day.exercises);
  day.exercises.forEach((e, ei) => { out += exBlock(e, di, ei, labels[ei]); });
  out += `<div class="row"><button class="btn" data-act="ex-add" data-d="${di}">Add exercise</button>${cb?.kind === "block" ? `<button class="btn primary" data-act="paste-block" data-d="${di}">Paste ${esc(cb.label)}</button>` : ""}</div>
    <p class="small muted">Block: give exercises the same letter to superset them (A1, A2). Pick a column (kg, % 1RM, RPE, watts...) to set a target per set. Exercise names come from your exercise library.</p>
    <div class="row"><button class="btn small" data-act="sess-dup" data-d="${di}">Duplicate session</button><button class="btn small" data-act="clip-sess" data-d="${di}">Copy session</button><button class="btn small danger" data-act="sess-del" data-d="${di}">Delete session</button></div>
    <datalist id="streams">${STREAMS.map((x) => `<option value="${x}">`).join("")}</datalist>
    <datalist id="ex-lib">${D.exercises.map((x) => `<option value="${esc(x.name)}">`).join("")}</datalist></div></div>`;
  return out;
}
function exBlock(e, di, ei, label) {
  const rows = rowsOf(e), on = !!e.metric, attrs = `data-d="${di}" data-e="${ei}"`;
  return `<section class="exb"><div class="exb-lb" id="blk-${e.id}">${label || ""}</div><div class="stack">
    <div class="exb-top">${fld("Exercise", "name", e, di, ei, "wide")}${fld("Block", "block", e, di, ei, "blkf", "text", "A")}
      <span class="row"><button class="btn small ghost" data-act="clip-block" ${attrs}>Copy block</button><button class="btn small ghost" data-act="ex-up" ${attrs}${ei ? "" : " disabled"}>Up</button><button class="btn small danger" data-act="ex-del" ${attrs}>Remove</button></span></div>
    <p class="rx" id="rx-${e.id}">${esc(rxLine(e))}</p>
    <div class="exb-grid"><div class="stack">
      <label class="f">Exercise instructions<textarea class="t" id="x-note-${e.id}" data-input="ex" data-k="note" ${attrs} placeholder="Warm up, tempo, what to log.">${esc(e.note)}</textarea></label>
      <div class="grid2">${fld("Cue (in brackets)", "cue", e, di, ei)}${fld("Rest", "rest", e, di, ei, "", "text", "Rest 3-4 minutes between sets")}</div>
      <div class="grid2">${fld("Block heading", "section", e, di, ei, "", "text", "STRENGTH/POWER or EMOM X 12 MINUTES")}${fld("Scoring", "score", e, di, ei, "", "text", "(FOR REPS) or (TEST) (FOR WATTS)")}</div></div>
    <div class="stack"><table class="sets"><thead><tr><th class="num">${rows.length} sets</th><th>Reps</th><th><select class="t mini" id="x-metric-${e.id}" data-change="metric" ${attrs} aria-label="Target per set">${METRICS.map((m) => `<option value="${m}"${(e.metric || "") === m ? " selected" : ""}>${m || "No column"}</option>`).join("")}</select></th><th></th></tr></thead>
      <tbody>${rows.map((r, ri) => `<tr><td class="num muted">${ri + 1}</td><td><input class="t num" id="r-${e.id}-${ri}-reps" data-input="row" data-f="reps" data-r="${ri}" ${attrs} value="${esc(r.reps)}" aria-label="Set ${ri + 1} reps"></td>
        <td>${on ? `<input class="t num" id="r-${e.id}-${ri}-val" data-input="row" data-f="val" data-r="${ri}" ${attrs} value="${esc(r.val)}" aria-label="Set ${ri + 1} ${esc(e.metric)}">` : ""}</td>
        <td>${rows.length > 1 ? `<button class="btn small ghost" data-act="row-del" data-r="${ri}" ${attrs} aria-label="Remove set ${ri + 1}">&times;</button>` : ""}</td></tr>`).join("")}</tbody></table>
      <div class="row"><button class="btn small" data-act="row-add" ${attrs}>Add set</button></div>
      ${on ? "" : fld("Load target", "target", e, di, ei, "", "text", "7 RPE or 70-75% of 1RM")}</div></div></div></section>`;
}
function fld(label, key, e, di, ei, cls = "", type = "text", ph = "") {
  return `<label class="f ${cls}">${label}<input class="t" id="x-${key}-${e.id}" type="${type}"${key === "name" ? ' list="ex-lib" autocomplete="off"' : key === "block" ? ' maxlength="2" autocapitalize="characters"' : ""}${type === "number" ? ' min="1" inputmode="numeric"' : ""} data-input="ex" data-k="${key}" data-d="${di}" data-e="${ei}" value="${esc(e[key])}"${ph ? ` placeholder="${esc(ph)}"` : ""}></label>`;
}
function saveProgramSoon() {
  const p = program(ui.programId); if (!p) return;
  const s = document.getElementById("save-state"); if (s) s.textContent = "Saving";
  debounce("program", () => api.saveProgram(p).then(() => { const s2 = document.getElementById("save-state"); if (s2) s2.textContent = "Saved"; }).catch((e) => fail(e, "Program")));
}

/* ----- coach: teams and each athlete's program ----- */
// Team, own program (overrides the team's) and start date, plus copying a program just for this athlete.
function programBox(c) {
  const own = D.programs.filter((p) => p.owner_id === c.id), team = teamOf(c), plan = planFor(c);
  const opts = (sel) => `<option value="">${team?.program_id ? "None, follow the team" : "None"}</option>
    ${own.length ? `<optgroup label="Just for ${esc(c.name || "them")}">${own.map((p) => `<option value="${p.id}"${sel === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>` : ""}
    <optgroup label="Programs">${libraryPrograms().map((p) => `<option value="${p.id}"${sel === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`;
  return `${D.teamsReady ? `<label class="f">Team<select class="t" id="c-team" data-change="c-team"><option value="">No team</option>${D.teams.map((t) => `<option value="${t.id}"${c.team_id === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>` : ""}
    <div class="grid2"><label class="f">${team ? "Own program" : "Program"}<select class="t" id="c-prog" data-change="c-prog">${opts(c.program_id)}</select></label>
    <label class="f">Start date<input class="t" type="date" id="c-start" data-change="c-start" value="${esc(c.start_date || "")}"></label></div>
    <p class="muted small">${plan.team && !c.program_id ? `Following ${esc(plan.team.name)}${plan.p ? `: ${esc(plan.p.name)}` : ""}${plan.start ? ` from ${fmtDay(plan.start)}` : ""}. Pick an own program to override it.` : "Start on a Monday so week numbers line up with the calendar."}</p>
    ${D.teamsReady ? `<div class="row">${plan.p ? `<button class="btn small" data-act="copy-for" data-id="${c.id}">Copy ${esc(plan.p.name)} just for ${esc(c.name || "them")}</button>` : ""}<button class="btn small ghost" data-act="new-for" data-id="${c.id}">Write a new program for ${esc(c.name || "them")}</button></div>
    ${own.length ? `<div class="list">${own.map((p) => `<button class="item" data-act="open-program" data-id="${p.id}"><div class="row spread"><strong>${esc(p.name)}</strong><span class="small muted">Edit</span></div></button>`).join("")}</div>` : ""}` : ""}`;
}
function vTeam() {
  const t = D.teams.find((x) => x.id === ui.teamId);
  if (!t) { ui.view = null; return vClients(); }
  const athletes = clients().filter((c) => c.approved);
  return `<div class="row"><button class="link" data-act="back">Back to clients</button></div>
    <section class="stack"><div class="kicker">Team</div>
    <label class="f">Name<input class="t" id="t-name" maxlength="60" data-change="t-name" value="${esc(t.name)}"></label>
    <div class="grid2"><label class="f">Program<select class="t" id="t-prog" data-change="t-prog"><option value="">None</option>${libraryPrograms().map((p) => `<option value="${p.id}"${t.program_id === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <label class="f">Start date<input class="t" type="date" id="t-start" data-change="t-start" value="${esc(t.start_date || "")}"></label></div>
    <p class="muted small">Everyone in the team trains this program from this date, unless they have their own program.</p>
    ${D.socialReady ? `<label class="row small"><input type="checkbox" data-change="t-board"${t.leaderboard !== false ? " checked" : ""}> Show the team leaderboard to its athletes</label>` : ""}</section>
    ${boardBox(t, true)}
    <section class="stack"><div class="section-head"><h2>Athletes</h2><span class="muted small num">${athletes.filter((c) => c.team_id === t.id).length}</span></div>
    ${athletes.length ? `<div class="list">${athletes.map((c) => { const other = c.team_id && c.team_id !== t.id ? teamOf(c) : null;
      return `<label class="item static row spread"><span><strong>${esc(c.name || c.email)}</strong>${other ? ` <span class="small muted">in ${esc(other.name)}</span>` : ""}${c.program_id ? ' <span class="small muted">has own program</span>' : ""}</span>
        <input type="checkbox" data-change="t-member" data-id="${c.id}"${c.team_id === t.id ? " checked" : ""} aria-label="${esc(c.name || c.email)} in ${esc(t.name)}"></label>`; }).join("")}</div>` : '<div class="empty">No approved athletes yet.</div>'}</section>
    <div class="row">${ui.confirmDelTeam ? `<span>Delete ${esc(t.name)}? Athletes stay, they just leave the team.</span><button class="btn small primary" data-act="team-del-yes">Delete</button><button class="btn small" data-act="team-del-no">Keep it</button>` : '<button class="btn small danger" data-act="team-del">Delete team</button>'}</div>`;
}

/* ----- daily check-in: the athlete rates sleep, soreness and energy; the coach sees who's flagging ----- */
const CHECK = [["sleep", "Sleep", "poor", "great"], ["soreness", "Soreness", "very sore", "fresh"], ["energy", "Energy", "flat", "flying"]];
const checkinOf = (cid, day) => D.checkins.find((c) => c.client_id === cid && c.day === day);
const lowCheck = (c) => CHECK.some(([k]) => c[k] && c[k] <= 2);
const checkChips = (c) => CHECK.filter(([k]) => c[k]).map(([k, label]) => `<span class="chip num${c[k] <= 2 ? " red" : ""}">${label} ${c[k]}</span>`).join("");
function checkinBox() {
  if (!D.checkinsReady) return "";
  const c = checkinOf(me.id, today()) || {};
  if (CHECK.every(([k]) => c[k]) && !ui.ckEdit) return `<section class="card checkin"><div class="row spread"><span class="row ck-chips"><strong>Checked in</strong>${checkChips(c)}</span><button class="link small" data-act="ck-edit">Change</button></div></section>`;
  return `<section class="card stack checkin"><div class="row spread"><h3>How are you today?</h3>${c.day ? '<span class="chip green">Sent to your coach</span>' : ""}</div>
    ${CHECK.map(([k, label, lo, hi]) => `<div class="ck-row"><span class="ck-label"><strong>${label}</strong><span class="small muted">1 ${lo}, 5 ${hi}</span></span>
      <div class="seg ck" role="group" aria-label="${label}">${[1, 2, 3, 4, 5].map((n) => `<button data-act="checkin" data-k="${k}" data-v="${n}" aria-pressed="${c[k] === n}">${n}</button>`).join("")}</div></div>`).join("")}
    <input class="t" id="ck-note" data-change="ck-note" maxlength="300" placeholder="Anything your coach should know? (optional)" aria-label="Note for your coach" value="${esc(c.note)}"></section>`;
}
async function saveCheckin(patch) {
  const day = today(), cur = checkinOf(me.id, day), row = { client_id: me.id, day, sleep: null, soreness: null, energy: null, note: "", ...cur, ...patch };
  D.checkins = [row, ...D.checkins.filter((c) => c !== cur)];
  try { await api.saveCheckin(row); } catch (err) { fail(err, "Your check-in"); }
}
// Coach, Clients tab: today's check-ins, anyone scoring 1 or 2 first.
function checkinsToday() {
  if (!D.checkinsReady) return "";
  const list = clients().filter((c) => c.approved).map((c) => [c, checkinOf(c.id, today())]).filter(([, k]) => k).sort(([, a], [, b]) => lowCheck(b) - lowCheck(a));
  const low = list.filter(([, k]) => lowCheck(k)).length;
  return `<section class="stack"><div class="section-head"><h2>Check-ins today</h2><span class="small muted num">${list.length ? `${list.length} in${low ? `, ${low} flagging` : ""}` : "None yet"}</span></div>
    ${list.length ? `<div class="list">${list.map(([c, k]) => `<button class="item" data-act="open-client" data-id="${c.id}"><div class="row spread"><strong>${esc(c.name || c.email)}</strong><span class="row ck-chips">${checkChips(k)}</span></div>${k.note ? `<p class="small">"${esc(k.note)}"</p>` : ""}</button>`).join("")}</div>` : ""}</section>`;
}
// Coach, athlete profile: their last two weeks of check-ins.
function checkinHistory(cid) {
  if (!D.checkinsReady) return "";
  const list = D.checkins.filter((c) => c.client_id === cid).slice(0, 14);
  return `<section class="stack"><div class="section-head"><h2>Check-ins</h2><span class="small muted">1 is worst, 5 is best</span></div>
    ${list.length ? `<div class="list">${list.map((k) => `<div class="item static"><div class="row spread"><strong class="small">${fmtDay(k.day)}</strong><span class="row ck-chips">${checkChips(k)}</span></div>${k.note ? `<p class="small">"${esc(k.note)}"</p>` : ""}</div>`).join("")}</div>` : '<p class="small muted">No check-ins yet.</p>'}</section>`;
}

/* ----- coach: clients ----- */
function vClients() {
  const pending = clients().filter((c) => !c.approved);
  let out = `<section class="hero"><div class="kicker">Roster</div><h1>Clients</h1>
    <p class="muted small">To add a client, send them this app's link. They create an account with their email and a password, then appear below for you to approve.</p></section>`;
  if (pending.length) out += `<section class="stack"><div class="section-head"><h2>Waiting for approval</h2></div><div class="list">${pending.map((c) =>
    `<div class="item static"><div class="row spread"><div><strong>${esc(c.name || "No name")}</strong><p class="small muted">${esc(c.email)}</p></div><button class="btn small primary" data-act="approve" data-id="${c.id}">Approve</button></div></div>`).join("")}</div></section>`;
  out += checkinsToday();
  if (D.teamsReady) out += `<section class="stack"><div class="section-head"><h2>Teams</h2><button class="btn small" data-act="team-new">New team</button></div>
    ${D.teams.length ? `<div class="list">${D.teams.map((t) => { const n = clients().filter((c) => c.team_id === t.id).length, p = program(t.program_id);
      return `<button class="item" data-act="open-team" data-id="${t.id}"><div class="row spread"><h3>${esc(t.name)}</h3><span class="chip num">${n} athlete${n === 1 ? "" : "s"}</span></div><p class="small muted">${p ? esc(p.name) : "No program"}${t.start_date ? `, from ${fmtDay(t.start_date)}` : ""}</p></button>`; }).join("")}</div>`
      : '<p class="small muted">Put athletes on the same program in a team and assign the program once.</p>'}</section>
    <div class="section-head"><h2>Athletes</h2></div>`;
  const approved = clients().filter((c) => c.approved), g = ui.athGroup || "all", sel = ui.athSel || (ui.athSel = new Set());
  const shown = approved.filter((c) => g === "all" || (g === "none" ? !teamOf(c) : c.team_id === g));
  out += `<div class="ath-tools"><label class="f">Group<select class="t" id="ath-group" data-change="ath-group"><option value="all">All athletes (${approved.length})</option>
      ${D.teamsReady ? `${D.teams.map((t) => `<option value="${t.id}"${g === t.id ? " selected" : ""}>${esc(t.name)} (${approved.filter((c) => c.team_id === t.id).length})</option>`).join("")}<option value="none"${g === "none" ? " selected" : ""}>No team (${approved.filter((c) => !teamOf(c)).length})</option>` : ""}</select></label>
    <label class="f grow">Search<input class="t" type="search" id="ath-q" data-input="ath-q" placeholder="Name or email" value="${esc(ui.athQ || "")}"></label>
    ${D.teamsReady && sel.size ? `<div class="row bulk"><span class="small num">${sel.size} selected</span><select class="t mini" id="bulk-team" data-change="bulk-team" aria-label="Add selected to a team"><option value="">Add to team...</option>${D.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select><button class="btn small ghost" data-act="bulk-unteam">Remove from teams</button></div>` : ""}</div>`;
  out += `<div class="ath" role="table" aria-label="Athletes"><div class="ath-row ath-head" role="row"><span role="columnheader">${D.teamsReady ? `<input type="checkbox" data-change="ath-all" aria-label="Select all shown"${shown.length && shown.every((c) => sel.has(c.id)) ? " checked" : ""}>` : ""}</span><span role="columnheader">Athlete</span><span role="columnheader">Actions</span><span role="columnheader">Program</span><span role="columnheader">Team</span><span role="columnheader">Last session</span></div>`;
  for (const c of shown) {
    const { p, start } = planFor(c), team = teamOf(c), w = weekOf(start, new Date()), wk = p && w >= 0 && p.weeks[w];
    const logged = wk ? wk.days.filter((d) => findLog(c.id, p.id, w, d.id)?.done).length : 0;
    const vids = D.videos.filter((v) => v.client_id === c.id && v.status === "waiting").length, msgs = unread(c.id);
    const status = !p ? "No program" : !start ? `${esc(p.name)}, no start date` : w < 0 ? `${esc(p.name)}, starts ${fmtDay(start)}` : w >= p.weeks.length ? `${esc(p.name)}, finished` : `${esc(p.name)}, week ${w + 1} of ${p.weeks.length}${wk ? `, ${logged}/${wk.days.length} done` : ""}`;
    const last = D.logs.filter((l) => l.client_id === c.id && l.done).map((l) => l.date).sort().pop(), ago = last ? daysBetween(parseYmd(last), new Date()) : null;
    const name = c.name || c.email, initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");
    out += `<div class="ath-row" role="row" data-q="${esc((name + " " + c.email).toLowerCase())}"><span role="cell">${D.teamsReady ? `<input type="checkbox" data-change="ath-sel" data-id="${c.id}" aria-label="Select ${esc(name)}"${sel.has(c.id) ? " checked" : ""}>` : ""}</span>
      <button class="ath-name" role="cell" data-act="open-client" data-id="${c.id}"><span class="av" aria-hidden="true">${esc(initials)}</span><span><strong>${esc(name)}</strong><span class="small muted">${esc(c.email)}</span></span></button>
      <span class="ath-act" role="cell"><button class="ico" data-act="ath-go" data-id="${c.id}" data-v="profile" title="Program" aria-label="${esc(name)} program">${ICON.cal}</button><button class="ico" data-act="ath-go" data-id="${c.id}" data-v="chat" title="Chat" aria-label="Chat with ${esc(name)}">${ICON.chat}${msgs ? `<span class="badge num">${msgs}</span>` : ""}</button><button class="ico" data-act="ath-go" data-id="${c.id}" data-v="library" title="Videos" aria-label="${esc(name)} videos">${ICON.vid}${vids ? `<span class="badge num">${vids}</span>` : ""}</button></span>
      <span class="small" role="cell">${status}</span><span class="small muted" role="cell">${team ? esc(team.name) : "No team"}</span><span class="small muted num" role="cell">${ago == null ? "Never" : ago <= 0 ? "Today" : ago === 1 ? "Yesterday" : `${ago} days ago`}</span></div>`;
  }
  if (!shown.length) out += `<div class="empty">${approved.length ? "No athletes in this group." : "No clients yet."}</div>`;
  return out + "</div>";
}
// Line icons for the athlete table, drawn in the text colour.
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  vid: svg('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'),
};
const TAB_ICON = {
  queue: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>'),
  programs: svg('<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  clients: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2"/>'),
  today: svg('<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>'),
  videos: svg('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
  history: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
};
function vClientDetail() {
  const c = profile(ui.clientId);
  if (!c) { ui.view = null; return vClients(); }
  const tab = ui.clientTab || "profile", n = unread(c.id);
  let out = `<div class="row"><button class="link" data-act="back">Back to clients</button></div>
    <section class="stack"><div class="kicker">Client</div><h1>${esc(c.name || c.email)}</h1><p class="small muted">${esc(c.email)}</p>
    <div class="seg" role="group" aria-label="Section">${[["profile", "Profile"], ["chat", `Chat${n ? ` (${n})` : ""}`], ["library", "Library"]].map(([k, l]) =>
      `<button data-act="client-tab" data-v="${k}" aria-pressed="${tab === k}">${l}</button>`).join("")}</div></section>`;
  if (tab === "chat") return out + chatBox(c.id, c.name || "them");
  if (tab === "library") return out + vLibrary(c);
  out += `<section class="stack">
    <label class="f">Goal<input class="t" id="c-goal" data-input="c-goal" value="${esc(c.goal)}"></label>
    ${programBox(c)}</section>${checkinHistory(c.id)}${prBoard(c.id)}${progressBox(c.id)}`;
  const logs = D.logs.filter((l) => l.client_id === c.id);
  out += `<section class="stack"><div class="section-head"><h2>Logged sessions</h2><span class="muted small num">${logs.length}</span></div>${logs.length ? logs.map(logSummary).join("") : '<div class="empty">Nothing logged yet.</div>'}</section>`;
  out += `<div class="row">${ui.confirmRevoke === c.id
    ? `<span>Remove ${esc(c.name || c.email)}'s access? Their history stays and you can approve them again later.</span><button class="btn small primary" data-act="revoke-yes">Remove access</button><button class="btn small" data-act="revoke-no">Cancel</button>`
    : '<button class="btn small danger" data-act="revoke">Remove access</button>'}</div>`;
  return out;
}

/* ----- coach: athlete video library ----- */
const movement = (s) => s.trim().replace(/\s+/g, " ").toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase());
function vLibrary(c) {
  const vids = D.videos.filter((v) => v.client_id === c.id && v.storage_path).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  const by = ui.libGroup || "movement", groups = {};
  vids.forEach((v) => (groups[by === "theme" ? v.theme || "No theme yet" : movement(v.exercise)] ||= []).push(v));
  const themes = [...new Set(D.videos.map((v) => v.theme).filter(Boolean))].sort();
  const names = Object.keys(groups).sort((a, b) => (a === "No theme yet") - (b === "No theme yet") || a.localeCompare(b));
  let out = `<section class="stack"><div class="row spread"><div class="seg" role="group" aria-label="Group by">${[["movement", "By movement"], ["theme", "By theme"]].map(([k, l]) =>
    `<button data-act="lib-group" data-v="${k}" aria-pressed="${by === k}">${l}</button>`).join("")}</div></div>
    <p class="small muted">Open any video to slow it down, draw on it or compare it with another rep. A breakdown you record from here goes to ${c.name ? esc(c.name) + "'s" : "their"} chat. Give a video a theme to save it: saved videos are never cleared by the 30-day clean-up.</p>
    <datalist id="themes">${themes.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>`;
  if (!vids.length) return out + '<div class="empty">No videos yet.</div></section>';
  for (const g of names) {
    out += `<div class="stack"><div class="section-head"><h3>${esc(g)}</h3><span class="small muted num">${groups[g].length}</span></div><div class="list">${groups[g].map((v) =>
      `<div class="item static stack"><div class="row spread"><strong>${esc(v.exercise)}</strong><span class="row">${v.keep ? '<span class="chip green">Saved</span>' : ""}${v.status === "waiting" ? '<span class="chip">Waiting</span>' : verdictChip(v.verdict)}</span></div>
        <p class="small muted">${fmtTime(v.uploaded_at)}${v.note ? ` · "${esc(v.note)}"` : ""}</p>
        <div class="row"><input class="t lib-theme" list="themes" maxlength="40" placeholder="Add a theme" aria-label="Theme" data-change="lib-theme" data-id="${v.id}" value="${esc(v.theme || "")}">
        <button class="btn small" data-act="lib-open" data-id="${v.id}">Open</button>
        <button class="btn small ghost" data-act="lib-keep" data-id="${v.id}">${v.keep ? "Unsave" : "Save"}</button>
        ${D.chatReady ? `<button class="btn small ghost" data-act="discuss" data-id="${v.id}">Discuss</button>` : ""}</div></div>`).join("")}</div></div>`;
  }
  return out + "</section>";
}

/* ----- chat (both sides) ----- */
function vClientChat() {
  return `<section class="hero"><div class="kicker">Coach</div><h1>Chat</h1><p class="muted small">Questions about your feedback, your program or anything else.</p></section>` + chatBox(me.id, "your coach");
}
const openThread = () => (isCoach() ? (ui.view === "client" && ui.clientTab === "chat" ? ui.clientId : null) : (ui.tab === "chat" && !ui.view ? me.id : null));
function chatBox(cid, who) {
  if (!D.chatReady) return '<div class="empty">Chat isn\'t switched on yet. Run the 0004 database update (see the README).</div>';
  const ref = ui.chatRef && D.videos.find((v) => v.id === ui.chatRef && v.client_id === cid);
  const lref = ui.chatLog && D.logs.find((l) => l.id === ui.chatLog && l.client_id === cid);
  return `<section class="stack">${pushNotice(who)}<div class="chat" id="chat-list">${chatList(cid, who)}</div>
    <form id="chat-form" class="chat-compose stack" data-cid="${cid}">
      ${ref ? `<div class="row"><span class="chip">About ${esc(ref.exercise)}, ${fmtDay(new Date(ref.uploaded_at))}</span><button class="link small" type="button" data-act="unref">Remove</button></div>` : ""}
      ${lref ? `<div class="row"><span class="chip">About ${esc(logTitle(lref))}</span><button class="link small" type="button" data-act="unref">Remove</button></div>` : ""}
      <div class="row chat-row"><textarea class="t" id="chat-body" data-input="chat" rows="2" maxlength="4000" placeholder="Message ${esc(who)}">${esc(ui.chatDraft || "")}</textarea>
      <button class="btn primary" type="submit">Send</button></div></form></section>`;
}
function pushNotice(who) {
  const st = ui.push;
  if (st === "off") return `<div class="card row spread notice"><span class="small">Get a phone alert when ${esc(who)} messages you.</span><button class="btn small primary" data-act="push-on">Turn on notifications</button></div>`;
  if (st === "install") return `<div class="card notice"><p class="small">To get a phone alert when ${esc(who)} messages you, add this app to your Home Screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, then open Tribe from there and turn notifications on.</p></div>`;
  if (st === "blocked") return '<div class="card notice"><p class="small">Notifications are blocked for this app. Allow them in your phone\'s settings to get an alert for new messages.</p></div>';
  return "";
}
// Opens what a notification or email points at: "#chat" or "#videos" for an athlete, "#chat-<athlete id>" for the coach.
function openLink(hash) {
  if (bd || !me) return;
  if (hash === "#videos" && !isCoach()) { // "your feedback is ready": show it, with the review just sent
    go(() => { ui.tab = "videos"; ui.view = null; }); scrollTo(0, 0);
    api.loadAll().then((d) => { D = d; if (ui.tab === "videos" && !ui.view) render(); }).catch(() => {});
    return;
  }
  const m = /^#chat(?:-(.+))?$/.exec(hash || "");
  if (!m) return;
  if (isCoach() && m[1] && profile(m[1])) go(() => { ui.tab = "clients"; ui.view = "client"; ui.clientId = m[1]; ui.clientTab = "chat"; });
  else if (!isCoach()) go(() => { ui.tab = "chat"; ui.view = null; });
  scrollTo(0, 0);
}
// Live updates pause while the phone is locked or the app is in the background; catch up on return.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !me || !D.chatReady) return;
  try { (await api.loadMessages()).forEach((m) => { const i = D.messages.findIndex((x) => x.id === m.id); if (i < 0) D.messages.push(m); else D.messages[i] = m; }); }
  catch { return; }
  if (!repaintChat()) { renderTabs(); if (isCoach() && ui.tab === "clients" && !ui.view && !bd) render(); }
});
navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.type === "open") openLink(new URL(e.data.url).hash); });
function chatList(cid, who) {
  const msgs = D.messages.filter((m) => m.client_id === cid);
  if (!msgs.length) return `<p class="small muted">No messages yet. Say hi to ${esc(who)}.</p>`;
  return msgs.map((m) => {
    const v = m.video_id && D.videos.find((x) => x.id === m.video_id), lg = m.log_id && D.logs.find((x) => x.id === m.log_id);
    return `<div class="msg${m.sender_id === me.id ? " mine" : ""}">${v ? `<span class="small muted">About ${esc(v.exercise)}, ${fmtDay(new Date(v.uploaded_at))}</span>` : ""}${lg ? `<span class="small muted">About ${esc(logTitle(lg))}</span>` : ""}
      ${m.clip_path ? `<div class="vid wide" data-video="${esc(m.clip_path)}">Loading video</div>` : ""}${m.body ? `<p>${esc(m.body)}</p>` : ""}<span class="tiny muted">${fmtTime(m.created_at)}</span></div>`;
  }).join("");
}
// After the chat is on screen: scroll to the newest message and mark the other side's messages read.
function afterChatPaint() {
  const cid = openThread(), list = document.getElementById("chat-list");
  if (!cid || !list) return;
  list.scrollTop = list.scrollHeight;
  if (unread(cid)) {
    const now = new Date().toISOString();
    D.messages.forEach((m) => { if (m.client_id === cid && m.sender_id !== me.id && !m.read_at) m.read_at = now; });
    renderTabs();
    api.markRead(cid).catch((e) => console.warn("mark read", e));
  }
}
function repaintChat() {
  const cid = openThread(), list = document.getElementById("chat-list");
  if (!cid || !list) return false;
  list.innerHTML = chatList(cid, isCoach() ? profile(cid)?.name || "them" : "your coach");
  hydrateVideos(); afterChatPaint();
  return true;
}
function addMessage(m) {
  if (D.messages.some((x) => x.id === m.id)) return false;
  D.messages.push(m);
  return true;
}
function onIncoming(m) {
  if (!addMessage(m)) return;
  if (repaintChat()) return;
  renderTabs();
  if (isCoach() && ui.tab === "clients" && !ui.view && !bd) render(); // refresh the unread chips
}
async function sendChat(form) {
  const cid = form.dataset.cid, box = document.getElementById("chat-body"), body = box.value.trim();
  if (!body) return;
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const row = await api.sendMessage({ client_id: cid, body, video_id: ui.chatRef || null, log_id: D.socialReady ? ui.chatLog : null });
    addMessage(row);
    ui.chatDraft = ""; ui.chatRef = null; ui.chatLog = null; render();
    document.getElementById("chat-body")?.focus();
  } catch (e) { fail(e, "Your message"); btn.disabled = false; }
}
function logSummary(l) {
  const p = program(l.program_id), day = p?.weeks[l.week]?.days.find((d) => d.id === l.day_id);
  const prs = l.done ? newPRs(l, clientLogs(l.client_id).filter((x) => x.date < l.date || (x.date === l.date && x.id < l.id)), nameOf) : [];
  const lines = (l.entries || []).map((en) => {
    const e = { name: day?.exercises.find((x) => x.id === en.exId)?.name || en.name }; if (!e.name) return "";
    const ex = day?.exercises.find((x) => x.id === en.exId), unit = ex && VAL_METRICS.includes(ex.metric) ? " " + ex.metric.toLowerCase() : "";
    const sets = en.sets.filter((s) => s.done || s.kg || s.reps || s.val); if (!sets.length && !en.result) return "";
    const pr = prs.find((x) => exKey(x.name) === exKey(e.name));
    return `<div class="small"><strong>${esc(e.name)}</strong>${pr || en.pr ? ` <span class="chip solid" title="${en.pr ? "Best score yet" : pr.kind === "heaviest" ? "Heaviest yet" : "Best estimated 1RM yet"}">PR</span>` : ""} <span class="muted num">${sets.map((s) => esc(s.reps || "-") + (s.kg ? ` x ${esc(s.kg)}kg` : "") + (s.val ? ` x ${esc(s.val)}${esc(unit)}` : "") + (s.rpe ? ` @${esc(s.rpe)}` : "")).join(", ")}</span>${en.result ? ` <span class="num">Score ${esc(en.result)}</span>` : ""}</div>`;
  }).join("");
  const talk = D.socialReady && D.chatReady ? D.messages.filter((m) => m.log_id === l.id) : [];
  const who = (m) => (m.sender_id === me.id ? "You" : isCoach() ? esc(profile(m.sender_id)?.name || "Athlete") : "Coach");
  return `<div class="card"><div class="row spread"><strong>${esc(day ? day.name : "Session")}</strong><span class="muted small">W${l.week + 1}, ${fmtDay(l.date)}${l.done ? "" : ", in progress"}</span></div>${lines}${l.note ? `<p class="small">"${esc(l.note)}"</p>` : ""}
    ${talk.map((m) => `<p class="small comment"><strong>${who(m)}:</strong> ${esc(m.body)}</p>`).join("")}
    ${D.socialReady && D.chatReady && l.done ? `<div class="row"><button class="link small" data-act="log-comment" data-id="${l.id}" data-cid="${l.client_id}">${isCoach() ? "Comment" : "Comment to your coach"}</button></div>` : ""}</div>`;
}

/* ----- progress: estimated 1RM over time and PRs, for the athlete and on their profile ----- */
// Exercise name for a logged entry, from the entry itself or the program it was logged against.
const nameOf = (l, exId) => program(l.program_id)?.weeks[l.week]?.days.find((d) => d.id === l.day_id)?.exercises.find((x) => x.id === exId)?.name;
const clientLogs = (cid) => D.logs.filter((l) => l.client_id === cid);
const kgs = (n) => `${+n.toFixed(1)} kg`;
function progressBox(cid) {
  const sets = liftSets(clientLogs(cid), nameOf), ser = series(sets), recs = records(sets);
  if (!ser.size) return `<section class="stack"><div class="section-head"><h2>Progress</h2></div><div class="empty">Log sets with reps and kg and each lift's progress shows here.</div></section>`;
  const keys = [...ser.keys()].sort((a, b) => ser.get(b).points.length - ser.get(a).points.length || a.localeCompare(b));
  const pick = ui.progEx?.[cid] && ser.has(ui.progEx[cid]) ? ui.progEx[cid] : keys[0], s = ser.get(pick);
  const rows = keys.map((k) => {
    const r = recs.get(k), m = D.progReady && maxFor(cid, r.name), better = D.progReady && r.best && (!m || r.best.e1rm > +m.kg);
    return `<tr><th scope="row">${esc(r.name)}</th><td class="num">${kgs(r.heaviest.kg)} x ${r.heaviest.reps}<span class="muted small"> ${fmtDay(r.heaviest.date)}</span></td>
      <td class="num">${r.best ? kgs(r.best.e1rm) : "-"}${m ? `<span class="muted small"> 1RM ${+m.kg}</span>` : ""}${better ? ` <button class="link small" data-act="use-e1rm" data-cid="${cid}" data-ex="${esc(r.name)}" data-kg="${Math.round(r.best.e1rm * 2) / 2}">Use as 1RM</button>` : ""}</td></tr>`;
  }).join("");
  return `<section class="stack"><div class="section-head"><h2>Progress</h2><span class="muted small">Estimated 1RM from the best set each session</span></div>
    <label class="f">Lift<select class="t" id="prog-ex-${cid}" data-change="prog-ex" data-cid="${cid}">${keys.map((k) => `<option value="${esc(k)}"${k === pick ? " selected" : ""}>${esc(ser.get(k).name)} (${ser.get(k).points.length})</option>`).join("")}</select></label>
    ${chart(s)}
    <div class="tbl"><table class="recs"><caption class="kicker">Personal records</caption><thead><tr><th scope="col">Lift</th><th scope="col">Heaviest</th><th scope="col">Best est. 1RM</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
// One lift, one line: estimated 1RM by session date. Tap or hover a point for the set behind it.
function chart(s) {
  const W = innerWidth < 600 ? 360 : 600, H = W < 600 ? 210 : 220, L = 40, R = 48, T = 14, B = 28, pts = s.points;
  const vals = pts.map((p) => p.e1rm), lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = Math.max(2.5, (hi0 - lo0) * 0.15);
  const step = [2.5, 5, 10, 20, 25, 50].find((x) => (hi0 - lo0 + 2 * pad) / x <= 4) || 100;
  const lo = Math.floor((lo0 - pad) / step) * step, hi = Math.ceil((hi0 + pad) / step) * step;
  const t0 = parseYmd(pts[0].date).getTime(), t1 = parseYmd(pts[pts.length - 1].date).getTime();
  const x = (p) => (pts.length === 1 ? (L + W - R) / 2 : L + ((parseYmd(p.date).getTime() - t0) / (t1 - t0 || 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const grid = []; for (let v = lo; v <= hi + 1e-9; v += step) grid.push(v);
  const last = pts[pts.length - 1];
  return `<figure class="chart" data-chart><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.name)} estimated 1RM: ${pts.map((p) => `${fmtDay(p.date)} ${kgs(p.e1rm)}`).join(", ")}">
    ${grid.map((v) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`).join("")}
    <text class="ax" x="${L}" y="${H - 8}">${fmtDay(pts[0].date)}</text>${pts.length > 1 ? `<text class="ax" x="${W - R}" y="${H - 8}" text-anchor="end">${fmtDay(last.date)}</text>` : ""}
    ${pts.length > 1 ? `<polyline class="ln" points="${pts.map((p) => `${x(p)},${y(p.e1rm)}`).join(" ")}"/>` : ""}
    ${pts.map((p) => `<circle class="pt" cx="${x(p)}" cy="${y(p.e1rm)}" r="4.5"/><circle class="hit" cx="${x(p)}" cy="${y(p.e1rm)}" r="16" data-tip="${esc(`${fmtDay(p.date)}: ${kgs(p.kg)} x ${p.reps}, est. 1RM ${kgs(p.e1rm)}`)}"/>`).join("")}
    <text class="lbl" x="${x(last) + 9}" y="${y(last.e1rm) + 4}">${+last.e1rm.toFixed(1)}</text></svg>
    <div class="tip" role="status" hidden></div></figure>`;
}
document.addEventListener("pointerover", (ev) => {
  const h = ev.target.closest?.(".hit"); const fig = ev.target.closest?.("[data-chart]"); if (!fig) return;
  const tip = fig.querySelector(".tip");
  if (!h) { tip.hidden = true; return; }
  const box = fig.getBoundingClientRect(), r = h.getBoundingClientRect();
  tip.textContent = h.dataset.tip; tip.hidden = false;
  const half = tip.offsetWidth / 2 + 4;
  tip.style.left = Math.min(Math.max(r.left + r.width / 2 - box.left, half), box.width - half) + "px"; tip.style.top = r.top - box.top - 6 + "px";
});

/* ----- team leaderboard: best set per lift, ranked by estimated 1RM ----- */
// Filled in after render, since it comes from the database rather than what's already loaded.
function boardBox(team, coachView) {
  if (!D.socialReady || !team) return "";
  if (!coachView && team.leaderboard === false) return "";
  return `<section class="stack"><div class="section-head"><h2>${esc(team.name)} leaderboard</h2><span class="muted small">Best set per lift, ranked by estimated 1RM</span></div>
    <div data-board="${team.id}">${boardBody(team.id)}</div></section>`;
}
function boardBody(tid) {
  const rows = ui.boards?.[tid];
  if (!rows) return '<p class="small muted">Loading leaderboard</p>';
  if (!rows.length) return '<div class="empty">No logged sets with reps and kg in this team yet.</div>';
  const lifts = [...new Map(rows.map((r) => [exKey(r.exercise), r.exercise])).entries()]
    .map(([k, name]) => ({ k, name, n: rows.filter((r) => exKey(r.exercise) === k).length })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const pick = lifts.some((x) => x.k === ui.boardEx?.[tid]) ? ui.boardEx[tid] : lifts[0].k;
  const ranked = rows.filter((r) => exKey(r.exercise) === pick).sort((a, b) => +b.e1rm - +a.e1rm);
  return `<label class="f">Lift<select class="t" id="board-ex-${tid}" data-change="board-ex" data-tid="${tid}">${lifts.map((x) => `<option value="${esc(x.k)}"${x.k === pick ? " selected" : ""}>${esc(x.name)} (${x.n})</option>`).join("")}</select></label>
    <div class="tbl"><table class="recs board"><thead><tr><th scope="col">#</th><th scope="col">Athlete</th><th scope="col">Best set</th><th scope="col">Est. 1RM</th></tr></thead><tbody>
    ${ranked.map((r, i) => `<tr${r.client_id === me.id ? ' class="me"' : ""}><td class="num">${i + 1}</td><th scope="row">${esc(r.athlete)}${r.client_id === me.id ? " (you)" : ""}</th><td class="num">${+r.kg} kg x ${r.reps}<span class="muted small"> ${fmtDay(r.day)}</span></td><td class="num">${+(+r.e1rm).toFixed(1)} kg</td></tr>`).join("")}</tbody></table></div>`;
}
async function hydrateBoards() {
  for (const el of document.querySelectorAll("[data-board]")) {
    const tid = el.dataset.board;
    if (ui.boards?.[tid]) continue;
    try { const rows = await api.teamBoard(tid); ui.boards = { ...ui.boards, [tid]: rows }; }
    catch (err) { console.error(err); ui.boards = { ...ui.boards, [tid]: [] }; }
    document.querySelectorAll(`[data-board="${tid}"]`).forEach((x) => (x.innerHTML = boardBody(tid)));
  }
}
// "Tribe Build, Mon 5 Oct" for a logged session.
const logTitle = (l) => `${program(l.program_id)?.weeks[l.week]?.days.find((d) => d.id === l.day_id)?.name || "Session"}, ${fmtDay(l.date)}`;

/* ----- client: training ----- */
function vToday() { const h = vTodayPlan(), i = h.indexOf("</section>") + 10; return i > 9 ? h.slice(0, i) + checkinBox() + h.slice(i) : checkinBox() + h; }
function vTodayPlan() {
  const { p, start } = planFor(me);
  let out = `<section class="hero"><div class="kicker">Hey ${esc(me.name || "there")}</div>`;
  if (!p) return out + `<h1>No program yet</h1><p class="muted">Your coach hasn't assigned one. Check back soon.</p></section>`;
  if (!start) return out + `<h1>${esc(p.name)}</h1><p class="muted">Your coach hasn't set a start date yet.</p></section>`;
  const w = weekOf(start, new Date());
  if (w < 0) return out + `<h1>${esc(p.name)}</h1><p class="muted">Starts ${fmtLong(start)}.</p></section>`;
  if (w >= p.weeks.length) return out + `<h1>Block done</h1><p class="muted">You've finished ${esc(p.name)}. Your coach will load the next one.</p></section>`;
  const t = today(), days = [...p.weeks[w].days].sort((a, b) => sessionDate(start, w, a.dow) - sessionDate(start, w, b.dow));
  const todays = days.find((d) => ymd(sessionDate(start, w, d.dow)) === t);
  out += `<h1>${todays ? esc(todays.name) + " today" : `Week ${w + 1} of ${p.weeks.length}`}</h1><p class="muted small">${esc(p.name)}</p></section>`;
  // One big button for the session that matters now: today's, or else the next one not yet logged.
  const next = todays || days.find((d) => ymd(sessionDate(start, w, d.dow)) > t && !findLog(me.id, p.id, w, d.id)?.done);
  if (next) {
    const l = findLog(me.id, p.id, w, next.id), when = next === todays ? "today's session" : `next: ${esc(next.name)}, ${fmtDay(ymd(sessionDate(start, w, next.dow)))}`;
    out += `<button class="btn primary start-btn${l?.done ? " done" : ""}" data-act="open-log" data-w="${w}" data-id="${next.id}"><span>${l?.done ? "View" : l ? "Continue" : "Start"} ${when}</span>${next === todays ? `<span class="small">${esc(next.name)}, ${next.exercises.length} exercises${l?.done ? ", logged" : ""}</span>` : ""}</button>`;
  }
  out += `<div class="list">`;
  for (const d of days) {
    const dt = ymd(sessionDate(start, w, d.dow)), l = findLog(me.id, p.id, w, d.id);
    const state = l?.done ? '<span class="chip green">Logged</span>' : l ? '<span class="chip accent">In progress</span>' : dt < t ? '<span class="chip red">Missed</span>' : dt === t ? '<span class="chip solid">Today</span>' : `<span class="chip">${fmtDay(dt)}</span>`;
    out += `<button class="item" data-act="open-log" data-w="${w}" data-id="${d.id}"><div class="row spread"><h3>${esc(d.name)}</h3>${state}</div><p class="small muted">${fmtLong(dt)}, ${d.exercises.length} exercises</p></button>`;
  }
  out += "</div>";
  if (w > 0) out += `<details><summary>Earlier weeks</summary><div class="list" style="margin-top:10px">${p.weeks.slice(0, w).flatMap((wk, wi) => wk.days.map((d) =>
    `<button class="item" data-act="open-log" data-w="${wi}" data-id="${d.id}"><div class="row spread"><strong>W${wi + 1} ${esc(d.name)}</strong>${findLog(me.id, p.id, wi, d.id)?.done ? '<span class="chip green">Logged</span>' : '<span class="chip">Not logged</span>'}</div></button>`)).join("")}</div></details>`;
  return out;
}
function logFor(k) {
  const { p, start } = planFor(me), day = p?.weeks[k.w]?.days.find((d) => d.id === k.id);
  if (!day) return null;
  let l = findLog(me.id, p.id, k.w, day.id);
  if (!l) {
    // A draft stays out of D.logs until the client actually enters something.
    const dr = ui.draftLog;
    l = dr && dr.week === k.w && dr.day_id === day.id ? dr : (ui.draftLog = { id: crypto.randomUUID(), client_id: me.id, program_id: p.id, week: k.w, day_id: day.id, date: ymd(sessionDate(start, k.w, day.dow)), done: false, note: "",
      entries: day.exercises.map((e) => ({ exId: e.id, name: e.name, sets: Array.from({ length: +e.sets || 1 }, () => ({ reps: "", kg: "", rpe: "", done: false })) })) });
  }
  return { l, day };
}
function touchLog(l) {
  if (!D.logs.includes(l)) { D.logs.unshift(l); ui.draftLog = null; }
  return l;
}
// Every log change is kept on the phone until the server has it, so a session logged with no signal
// isn't lost: it sends when the connection comes back (or the next time the app opens).
const pendKey = () => `tribe-pending-logs-${me?.id}`;
const pending = {
  all() { try { return JSON.parse(localStorage.getItem(pendKey())) || {}; } catch { return {}; } },
  write(m) { try { Object.keys(m).length ? localStorage.setItem(pendKey(), JSON.stringify(m)) : localStorage.removeItem(pendKey()); } catch { /* storage full or blocked */ } },
  put(l) { const m = this.all(); m[l.id] = { log: structuredClone(l), at: Date.now() }; this.write(m); },
  drop(id, at) { const m = this.all(); if (m[id] && m[id].at <= at) { delete m[id]; this.write(m); } },
  count() { return Object.keys(this.all()).length; },
};
async function sendLog(l) {
  const at = Date.now();
  await api.saveLog(l);
  pending.drop(l.id, at);
}
function saveLogSoon(l, now) {
  touchLog(l);
  pending.put(l);
  const go = () => sendLog(l).then(() => { if (ui.offline) { ui.offline = false; render(); } return "sent"; }, (e) => {
    console.error(e);
    if (!ui.offline) { ui.offline = true; render(); }
    return "queued";
  });
  if (now) { clearTimeout(timers["log"]); return go(); }
  debounce("log", go);
}
// Sends whatever is waiting. Logs waiting on this phone also replace the older copies loaded from the server.
async function flushPending() {
  if (!me || isCoach()) return;
  const waiting = Object.values(pending.all()).map((x) => x.log);
  if (!waiting.length) return;
  for (const l of waiting) { const i = D.logs.findIndex((x) => x.id === l.id); if (i >= 0) D.logs[i] = l; else D.logs.unshift(l); }
  let left = 0;
  for (const l of waiting) await sendLog(l).catch(() => left++);
  const was = ui.offline; ui.offline = left > 0;
  if (was !== ui.offline || !left) { if (was && !left) toast("Back online. Your sessions are sent."); render(); }
}
addEventListener("online", () => { flushPending(); });
setInterval(() => { if (pending.count()) flushPending(); }, 30000);
function offlineBar() {
  const n = !isCoach() && pending.count();
  if (!n && !ui.offlineData) return "";
  return `<div class="offline-bar small">${ui.offlineData ? "No connection. Showing what was on this phone when you last opened the app. " : ""}${n ? `${n} session${n > 1 ? "s" : ""} saved on this phone, sending when you're back online.` : ""}</div>`;
}
// "Your 1RM is 120 kg, so 85-90 kg today", or a box to add the 1RM when the target is a percentage.
function loadLine(cid, e) {
  const perSet = e.metric === "% 1RM" && !hasPct(e.target) && e.rows?.some((r) => String(r.val).trim());
  if (!D.progReady || !(hasPct(e.target) || perSet)) return "";
  const m = maxFor(cid, e.name);
  if (m) return `<p class="small load">${esc(perSet ? e.rows.map((r) => pctLoad(r.val + "%", +m.kg)?.replace(" kg", "") || "-").join(" / ") + " kg" : pctLoad(e.target, +m.kg))} today <span class="muted">(1RM ${+m.kg} kg)</span></p>`;
  return `<div class="row max-add"><input class="t num" id="max-${e.id}" inputmode="decimal" placeholder="1RM kg" aria-label="${esc(e.name)} 1RM in kg">
    <button class="btn small" data-act="max-save" data-cid="${cid}" data-ex="${esc(e.name)}" data-in="max-${e.id}">Add 1RM</button><span class="small muted">to see this in kg</span></div>`;
}
// What goes in each set box as a hint: the prescribed reps, and the kg or RPE for that set when the coach set one.
function setHint(e, si, f) {
  const r = e.rows?.[si];
  if (f === "reps") return r ? String(r.reps) : String(e.reps);
  const v = String(r?.val ?? "").trim();
  if (f === "rpe") return e.metric === "RPE" && v ? v : "7";
  if (f === "val") return v;
  if (e.metric === "kg") return v;
  if (e.metric === "% 1RM" && v && D.progReady) { const m = maxFor(me.id, e.name), kg = m && pctLoad(v + "%", +m.kg); return kg ? kg.replace(" kg", "") : ""; }
  return "";
}
function demoBit(name) {
  const x = D.progReady && libFor(name);
  if (!x || !(x.demo_url || x.demo_path || x.cues)) return "";
  return `<div class="demo">${x.demo_path ? `<button class="link small" data-act="demo" data-path="${esc(x.demo_path)}">Watch demo</button>` : ""}${x.demo_url ? `<a class="link small" href="${esc(x.demo_url)}" target="_blank" rel="noopener">Watch demo</a>` : ""}
    ${x.cues ? `<p class="ins">${esc(x.cues)}</p>` : ""}<div class="demo-vid"></div></div>`;
}
// PR board for one athlete, editable by the coach and by the athlete. Barbell PRs are the 1RMs in maxes,
// so percentages in the program show as kg from them; gymnastics and benchmarks live in prs.
const prFor = (cid, name) => D.prs.find((r) => r.client_id === cid && exKey(r.name) === exKey(name));
// Earlier values of one PR, newest first, leaving out the current one: "Was 2:58 (Sat 12 Sep), 3:10 (Mon 1 Jun)".
function prTrail(cid, name) {
  const h = D.prHistory.filter((x) => x.client_id === cid && exKey(x.name) === exKey(name)).sort((x, y) => y.scored_on.localeCompare(x.scored_on)).slice(1, 4);
  return h.length ? `<span class="small muted pr-was">Was ${h.map((x) => `${esc(x.value)}${x.category === "lift" ? " kg" : ""} (${fmtDay(x.scored_on)})`).join(", ")}</span>` : "";
}
function prBoard(cid) {
  if (!D.progReady && !D.prsReady) return "";
  // Collapsed, the board shows only what's filled in (plus 1RMs the program needs); "Show all" lists every preset.
  const all = !!ui.prAll?.[cid];
  const p = planFor(profile(cid)).p;
  const pctNames = D.progReady ? [...new Set((p?.weeks || []).flatMap((w) => w.days.flatMap((d) => d.exercises.filter((e) => hasPct(e.target)).map((e) => e.name))).filter(Boolean))] : [];
  const missing = pctNames.filter((n) => !maxFor(cid, n)), needed = new Set(missing.map(exKey));
  const row = (name, input, when) => `<div class="pr-row"><span class="pr-name">${esc(name)}${when ? `<span class="small muted">${fmtDay(when)}</span>` : ""}${prTrail(cid, name)}</span>${input}</div>`;
  const liftRow = (name) => { const m = maxFor(cid, name);
    if (!all && !m && !needed.has(exKey(name))) return "";
    return row(m ? m.exercise : name, `<span class="row"><input class="t num kg" inputmode="decimal" aria-label="${esc(name)} 1RM in kg" data-change="pr-kg" data-cid="${cid}" data-ex="${esc(m ? m.exercise : name)}" value="${m ? +m.kg : ""}"><span class="small">kg</span></span>`, m?.tested_on); };
  const setRow = (cat, name, kind) => { const r = prFor(cid, name), [ph, mode] = KINDS[kind];
    if (!all && !r) return "";
    return row(r ? r.name : name, `<input class="t num pr-in" inputmode="${mode}" placeholder="${ph}" aria-label="${esc(name)} PR" data-change="pr-val" data-cid="${cid}" data-cat="${cat}" data-kind="${kind}" data-name="${esc(r ? r.name : name)}" value="${esc(r?.value)}">`, r?.scored_on); };
  const group = (title, note, rows) => { const shown = rows.filter(Boolean);
    return `<div class="pr-group"><div class="kicker">${title}${note ? ` <span class="muted">${note}</span>` : ""}</div>${shown.length ? `<div class="pr-grid">${shown.join("")}</div>` : '<p class="small muted">None yet.</p>'}</div>`; };
  let out = "", filled = 0;
  if (D.progReady) {
    const presets = new Set(Object.values(PR_LIFTS).flat().map(exKey));
    const others = D.maxes.filter((m) => m.client_id === cid && !presets.has(exKey(m.exercise))).map((m) => m.exercise);
    filled += D.maxes.filter((m) => m.client_id === cid).length;
    out += group("Strength", "1RM", [...PR_LIFTS.Strength, ...others, ...missing.filter((n) => !presets.has(exKey(n)))].map(liftRow)) + group("Olympic lifting", "1RM", PR_LIFTS.Olympic.map(liftRow));
    if (all) out += `${missing.length ? `<p class="small muted">Missing for this program: ${missing.map(esc).join(", ")}</p>` : ""}
      <div class="row pr-add"><input class="t" id="max-new-ex-${cid}" list="max-names-${cid}" maxlength="80" placeholder="Other lift, e.g. Box Squat" aria-label="Lift">
        <input class="t num kg" id="max-new-kg-${cid}" inputmode="decimal" placeholder="kg" aria-label="1RM in kg">
        <button class="btn small" data-act="max-save" data-cid="${cid}" data-in="max-new-kg-${cid}" data-exin="max-new-ex-${cid}">Add</button></div>
      <datalist id="max-names-${cid}">${[...missing, ...D.exercises.map((x) => x.name)].map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
  }
  if (D.prsReady) {
    const sets = (cat) => { const names = new Set(PR_SETS[cat].map(([n]) => exKey(n)));
      return [...PR_SETS[cat], ...D.prs.filter((r) => r.client_id === cid && r.category === cat && !names.has(exKey(r.name))).map((r) => [r.name, "score"])]; };
    filled += D.prs.filter((r) => r.client_id === cid).length;
    out += group("Gymnastics", "max unbroken", sets("gymnastics").map(([n, k]) => setRow("gymnastics", n, k)))
      + group("Benchmarks", "", sets("benchmark").map(([n, k]) => setRow("benchmark", n, k)));
    if (all) out += `<div class="row pr-add"><input class="t" id="pr-new-name-${cid}" maxlength="80" placeholder="Other, e.g. Amanda" aria-label="PR name">
        <select class="t pr-cat" id="pr-new-cat-${cid}" aria-label="Type"><option value="benchmark">Benchmark</option><option value="gymnastics">Gymnastics</option></select>
        <input class="t num pr-in" id="pr-new-val-${cid}" placeholder="score" aria-label="PR">
        <button class="btn small" data-act="pr-add" data-cid="${cid}">Add</button></div>`;
  } else if (isCoach()) out += '<p class="small muted">Gymnastics and benchmark PRs show here once run-0011-prs.sql has been run in Supabase.</p>';
  const toggle = `<button class="btn small" data-act="pr-all" data-cid="${cid}">${all ? "Show filled only" : filled ? "Show all / add" : "Add PRs"}</button>`;
  return `<section class="stack prs"><div class="section-head"><h2>PRs</h2>${toggle}</div>${all ? '<p class="small muted">Clear a box to remove it. Percentages in the program use the 1RMs.</p>' : ""}${out}${all ? `<div class="row">${toggle}</div>` : ""}</section>`;
}
async function savePr(cid, name, cat, val) {
  const rows = await api.setPr(cid, name, cat, val);
  D.prs = [...D.prs.filter((r) => r.client_id !== cid), ...rows];
  await freshHistory(cid);
}
async function saveMax(cid, ex, kg) {
  const rows = await api.setMax(cid, ex, kg);
  D.maxes = [...D.maxes.filter((m) => m.client_id !== cid), ...rows];
  await freshHistory(cid);
}
// Scores in this log that beat the athlete's PR board (benchmarks, max-effort gymnastics). Marks those entries.
function scorePRs(l, day) {
  if (!D.prsReady) return [];
  const wins = [];
  for (const en of l.entries) {
    const e = day.exercises.find((x) => x.id === en.exId), t = e && en.result && prTarget(e, myCustomPrs(l.client_id));
    en.pr = !!(t && validScore(t.kind, en.result) && beats(t.kind, en.result, prFor(l.client_id, t.name)?.value));
    if (en.pr) wins.push({ name: t.name, cat: t.cat, value: en.result });
  }
  return wins;
}
async function freshHistory(cid) {
  if (!D.prsReady) return;
  const rows = await api.prHistory(cid).catch(() => null);
  if (rows) D.prHistory = [...D.prHistory.filter((x) => x.client_id !== cid), ...rows];
}

/* ----- coach: exercise library ----- */
function vExLib() {
  return `<div class="row"><button class="link" data-act="back">Back to programs</button></div>
    <section class="hero"><div class="kicker">Library</div><h1>Exercises</h1><p class="muted small">Add a demo for an exercise once and every athlete sees a Watch demo button wherever it's programmed. Names match what you type in programs.</p></section>
    <section class="card stack"><h3>Add an exercise</h3>
      <label class="f">Name<input class="t" id="xl-name" maxlength="80" placeholder="e.g. Bulgarian Split Squat"></label>
      <label class="f">Demo link (optional)<input class="t" id="xl-url" type="url" placeholder="https://youtube.com/..."></label>
      <div class="row"><label class="btn small" for="xl-file">Or upload a demo video</label><input id="xl-file" type="file" accept="video/*" hidden><span class="small muted" id="xl-file-name"></span></div>
      <label class="f">Cues (optional)<textarea class="t" id="xl-cues" placeholder="Front foot flat, knee tracks over toes."></textarea></label>
      <div class="row"><button class="btn primary" data-act="exlib-add">Add exercise</button><span class="small" id="xl-msg" role="status"></span></div></section>
    ${D.exercises.length ? `<div class="list">${D.exercises.map((x) => `<div class="item static stack">
      <div class="row spread"><strong>${esc(x.name)}</strong><span class="row">${x.demo_path ? `<button class="btn small ghost" data-act="demo" data-path="${esc(x.demo_path)}">Watch</button>` : ""}${x.demo_url ? `<a class="btn small ghost" href="${esc(x.demo_url)}" target="_blank" rel="noopener">Open link</a>` : ""}<button class="btn small danger" data-act="exlib-del" data-id="${x.id}">Delete</button></span></div>
      <label class="f">Demo link<input class="t" type="url" data-change="exlib-field" data-k="demo_url" data-id="${x.id}" value="${esc(x.demo_url)}" placeholder="https://..."></label>
      <label class="f">Cues<textarea class="t" data-change="exlib-field" data-k="cues" data-id="${x.id}">${esc(x.cues)}</textarea></label>
      <div class="demo-vid"></div></div>`).join("")}</div>` : '<div class="empty">No exercises yet.</div>'}`;
}
async function addExercise() {
  const name = document.getElementById("xl-name").value.trim(), url = document.getElementById("xl-url").value.trim();
  const cues = document.getElementById("xl-cues").value.trim(), file = ui.demoFile, msg = document.getElementById("xl-msg");
  if (!name) { msg.textContent = "Give it a name first."; return; }
  if (url && !/^https:\/\//i.test(url)) { msg.textContent = "The link needs to start with https://"; return; }
  if (libFor(name)) { msg.textContent = `${name} is already in the library. Edit it below.`; return; }
  let demo_path = null;
  try {
    if (file) { const f = await prepareVideo(file, (t) => (msg.textContent = t)); msg.textContent = "Uploading..."; demo_path = await api.uploadDemo(me.id, f, name); }
    const row = await api.saveExercise({ name, demo_url: url, demo_path, cues });
    D.exercises = [...D.exercises, row].sort((a, b) => a.name.localeCompare(b.name));
    ui.demoFile = null; render(); toast(`${name} added.`);
  } catch (e) {
    if (demo_path) api.removeFile(demo_path).catch(() => {});
    msg.textContent = `Didn't save: ${e.message || e}`;
  }
}

// Per-set columns that aren't a weight are logged as "val", so they never count towards lifting PRs.
const VAL_METRICS = ["Watts", "Seconds", "Metres", "Calories"];
const myCustomPrs = (cid) => D.prs.filter((r) => r.client_id === cid);
// The block's score (a time, watts, rounds...) under its sets, with the PR to beat when it's on the board.
function scoreRow(e, en) {
  const custom = myCustomPrs(me.id), kind = String(e.score || "").trim() || prTarget(e, custom) ? scoreKind(e, custom) : null;
  if (!kind && !en.result && !ui.scoreOpen?.[e.id]) return `<button class="link small" data-act="add-score" data-ex="${e.id}">Add a score</button>`;
  const [ph, mode] = KINDS[kind || "score"], tgt = D.prsReady && prTarget(e, custom), cur = tgt && prFor(me.id, tgt.name);
  return `<div class="score-row"><label class="f">Score${e.score ? ` <span class="muted">${esc(e.score.replace(/[()]/g, ""))}</span>` : ""}
    <input class="t num" id="score-${e.id}" inputmode="${mode}" placeholder="${ph}" data-input="result" data-ex="${e.id}" value="${esc(en.result)}"></label>
    ${tgt ? `<span class="small muted">${cur ? `PR to beat: ${esc(cur.value)}` : "Goes on your PR board"}</span>` : ""}</div>`;
}
// Ticking a set starts the prescribed rest, except between the exercises of a superset.
function restAfter(exId) {
  const day = logFor(ui.logKey)?.day, i = day?.exercises.findIndex((x) => x.id === exId);
  if (!day || i < 0) return;
  const e = day.exercises[i], next = day.exercises[i + 1], t = restSecs(e.rest);
  if (!t || (next && e.block && next.block === e.block)) return;
  openTimer({ mode: "rest", total: t, label: "Rest" }, true);
}
function vLog() {
  const r = logFor(ui.logKey);
  if (!r) { ui.view = null; return vToday(); }
  const { l, day } = r;
  let out = `<div class="row spread"><button class="link" data-act="back">Back</button><button class="btn small" data-act="timer">Timer</button></div><section class="hero"><div class="kicker">Week ${ui.logKey.w + 1}, ${fmtLong(l.date)}</div><h1>${esc(day.name)}</h1>
    ${day.coachNote ? `<div class="feedback"><span class="kicker">From your coach</span><p class="small">${esc(day.coachNote)}</p></div>` : ""}</section>`;
  const labels = blockLabels(day.exercises);
  day.exercises.forEach((e, ei) => {
    const en = l.entries.find((x) => x.exId === e.id) || (l.entries[ei] = { exId: e.id, sets: [{ reps: "", kg: "", rpe: "", done: false }] });
    const ins = [e.note, e.rest].filter(Boolean).join("\n"), vf = VAL_METRICS.includes(e.metric) ? "val" : "kg";
    const lb = labels[ei], mates = lb && /\d$/.test(lb) ? labels.filter((x) => x && x[0] === lb[0]) : [];
    out += `${e.section ? `<div class="section-tag"><span class="kicker">${esc(e.section)}</span>${e.score ? `<span class="chip">${esc(e.score)}</span>` : ""}</div>` : ""}<section class="card${mates.length ? " superset" : ""}"><div class="row spread"><h3>${lb ? `<span class="blk">${lb}</span> ` : ""}${esc(e.name)}</h3><span class="row">${presetFor([e.name, e.section, e.score, e.reps, e.note].join(" ")) ? `<button class="link small" data-act="timer-ex" data-ex="${e.id}">Timer</button>` : ""}<button class="link small" data-act="film" data-ex="${esc(e.name)}">Film a set</button></span></div>
      ${mates.length && lb.endsWith("1") ? `<p class="small muted">Superset: do ${mates.join(" and ")} back to back, then rest.</p>` : ""}
      ${rxLine(e) ? `<p class="rx">${esc(rxLine(e))}</p>` : ""}${loadLine(me.id, e)}${ins ? `<p class="ins">${esc(ins)}</p>` : ""}${demoBit(e.name)}
      <div class="colhead"><span>Set</span><span>Reps</span><span>${vf === "val" ? esc(e.metric) : "kg"}</span><span>RPE</span><span></span></div>
      ${en.sets.map((s, si) => `<div class="setrow"><span class="n num">${si + 1}</span>${["reps", vf, "rpe"].map((f) =>
        `<input class="t num" id="s-${e.id}-${si}-${f}" inputmode="decimal" aria-label="Set ${si + 1} ${f}" data-input="set" data-ex="${e.id}" data-s="${si}" data-f="${f}" value="${esc(s[f])}" placeholder="${esc(setHint(e, si, f))}">`).join("")}
        <button class="tick" data-act="tick" data-ex="${e.id}" data-s="${si}" aria-pressed="${!!s.done}" aria-label="Set ${si + 1} done">${s.done ? "&#10003;" : ""}</button></div>`).join("")}${scoreRow(e, en)}</section>`;
  });
  out += `<label class="f">Notes for your coach<textarea class="t" id="log-note" data-input="log-note" placeholder="How it went, anything that felt off.">${esc(l.note)}</textarea></label>
    <div class="row"><button class="btn primary" data-act="finish-log">${l.done ? "Update session" : "Finish session"}</button></div>`;
  return out;
}

/* ----- client: videos ----- */
function vClientVideos() {
  const { p } = planFor(me);
  const names = [...new Set((p?.weeks || []).flatMap((w) => w.days.flatMap((d) => d.exercises.map((e) => e.name))).filter(Boolean))];
  let out = `<section class="hero"><div class="kicker">Technique videos</div><h1>Drop it here, not in my DMs</h1>
    <p class="muted">Upload whenever suits you. You'll get feedback right here within ${FEEDBACK_HOURS} hours.</p></section>
    <section class="card"><label class="drop" id="drop" for="vfile"><strong>${ui.file ? esc(ui.file.name) : "Choose a video"}</strong>
      <span class="muted small">${ui.file ? `${(ui.file.size / 1048576).toFixed(1)} MB, tap to swap` : "Or drag one in. Side-on, whole body in frame, just the set. It's shrunk on your phone before it sends."}</span></label>
      <input id="vfile" type="file" accept="video/*" hidden>
      <label class="f">Exercise<input class="t" id="v-ex" list="ex-names" autocomplete="off" maxlength="80" placeholder="e.g. Back Squat" value="${esc(ui.filmEx || "")}"></label>
      <datalist id="ex-names">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
      <label class="f">What should I look at?<textarea class="t" id="v-note" placeholder="Set 3 at 80kg. Does my back round?">${esc(ui.vnote || "")}</textarea></label>
      <div class="row"><button class="btn primary" data-act="upload"${ui.file && !ui.busy ? "" : " disabled"}>${ui.busy ? "Uploading..." : "Send to review queue"}</button></div></section>`;
  const mine = D.videos.filter((v) => v.client_id === me.id);
  out += `<section class="stack"><div class="section-head"><h2>Your videos</h2></div>${mine.length ? mine.map((v) =>
    `<article class="card qcard">${videoBox(v)}<div class="stack"><div class="row spread"><strong>${esc(v.exercise)}</strong>${v.status === "waiting" ? `<span class="chip">Feedback by ${fmtTime(dueAt(v.uploaded_at))}</span>` : verdictChip(v.verdict)}</div>
      <p class="small muted">Uploaded ${fmtTime(v.uploaded_at)}</p>${v.note ? `<p class="small">"${esc(v.note)}"</p>` : ""}
      ${v.status === "reviewed" ? `<div class="feedback"><span class="kicker">Coach feedback</span>${clipsOf(v).length ? `<p class="small">Watch your breakdown${clipsOf(v).length > 1 ? "s" : ""}, sound on.</p>${clipsOf(v).map((c, i, all) => `${all.length > 1 ? `<p class="kicker">${i + 1}. ${esc(c.label)}</p>` : ""}<div class="vid wide" data-video="${esc(c.path)}">Loading breakdown</div>`).join("")}` : ""}${v.feedback || !clipsOf(v).length ? `<p class="small">${esc(v.feedback || "No notes.")}</p>` : ""}${D.chatReady ? `<button class="link small" data-act="ask" data-id="${v.id}">Ask your coach about this</button>` : ""}</div>` : ""}</div></article>`).join("") : '<div class="empty">No videos yet. Film a working set and drop it above.</div>'}</section>`;
  return out;
}
function vHistory() {
  const logs = D.logs.filter((l) => l.client_id === me.id);
  return `<section class="hero"><div class="kicker">Training log</div><h1>What you've done</h1></section>${prBoard(me.id)}${progressBox(me.id)}${boardBox(teamOf(me), false)}${logs.length ? logs.map(logSummary).join("") : '<div class="empty">Log a session from the Training tab and it shows up here.</div>'}`;
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
  if (f.id === "chat-form") { ev.preventDefault(); sendChat(f); return; }
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
    case "signout": stopChat?.(); stopChat = null; try { localStorage.removeItem(snapshot.key(me.id)); } catch { /* blocked */ } await api.signOut(); started = null; me = null; ui.authMode = "in"; renderShell(vSignIn()); break;
    case "auth-mode": ui.authEmail = document.getElementById("si-email")?.value.trim() || ui.authEmail; ui.authMode = v; renderShell(vSignIn()); break;
    case "password": go(() => (ui.view = "password")); scrollTo(0, 0); break;
    case "tab":
    case "back":
      if (bd?.unsaved && !confirm("Leave without saving this breakdown?")) return;
      if (act === "tab") { go(() => { ui.tab = v; ui.view = null; }); scrollTo(0, 0); break; }
      if (ui.view === "session") { go(() => { ui.view = "program"; ui.sess = null; }); break; }
      if (ui.view === "program" && program(ui.programId)?.owner_id) { const cid = program(ui.programId).owner_id; go(() => { ui.view = "client"; ui.clientId = cid; ui.clientTab = "profile"; ui.confirmDelProgram = false; }); scrollTo(0, 0); break; }
      go(() => { ui.view = null; ui.confirmRevoke = null; ui.confirmDelProgram = false; ui.confirmDelTeam = false; }); break;
    case "review": openReview(id); break;
    case "lib-open": openReview(id, true); break;
    case "lib-back":
      if (bd?.unsaved && !confirm("Leave without saving this breakdown?")) return;
      if (bd) { bd.destroy(); bd = null; }
      go(() => { ui.lib = false; ui.view = "client"; ui.clientTab = "library"; }); break;
    case "lib-group": go(() => (ui.libGroup = v)); break;
    case "lib-keep": {
      const x = D.videos.find((y) => y.id === id);
      try { const row = await api.setLibrary(id, { keep: !x.keep }); D.videos = D.videos.map((y) => (y.id === id ? row : y)); render(); }
      catch (err) { fail(err, "Library"); }
      break;
    }
    case "client-tab": go(() => (ui.clientTab = v)); break;
    case "discuss": go(() => { ui.chatRef = id; ui.clientTab = "chat"; }); break;
    case "ask": go(() => { ui.chatRef = id; ui.tab = "chat"; ui.view = null; }); scrollTo(0, 0); break;
    case "push-on":
      b.disabled = true;
      try { await notify.turnOn(isCoach()); ui.push = "on"; toast("Notifications are on for this phone."); }
      catch (err) { err.userFacing ? toast(err.message) : fail(err, "Notifications"); }
      render(); break;
    case "push-off":
      try { await notify.turnOff(); ui.push = "off"; toast("Notifications are off for this phone."); } catch (err) { fail(err, "Notifications"); }
      render(); break;
    case "log-comment":
      if (isCoach()) go(() => { ui.clientId = b.dataset.cid; ui.view = "client"; ui.clientTab = "chat"; ui.chatRef = null; ui.chatLog = id; });
      else go(() => { ui.tab = "chat"; ui.view = null; ui.chatRef = null; ui.chatLog = id; });
      scrollTo(0, 0); break;
    case "unref": ui.chatRef = null; ui.chatLog = null; ui.chatDraft = document.getElementById("chat-body")?.value || ""; render(); break;
    case "rv-verdict": {
      ui.drafts[id] = { ...(ui.drafts[id] || { feedback: "" }), verdict: v };
      b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      document.querySelector('[data-act="rv-send"]').disabled = false;
      document.getElementById("rv-hint").textContent = "";
      break;
    }
    case "rv-skip":
      if (bd?.unsaved && !confirm("Leave without saving this breakdown?")) return;
      openReview(nextAfter(D.videos.find((x) => x.id === id))?.id);
      break;
    case "rv-send": {
      const dr = ui.drafts[id]; if (!dr?.verdict) return;
      if (bd?.unsaved && !confirm("Your breakdown recording isn't saved yet. Send without it?")) return;
      b.disabled = true;
      try {
        const cur = D.videos.find((x) => x.id === id);
        const row = await api.reviewVideo(id, dr.verdict, dr.feedback || "");
        D.videos = D.videos.map((x) => (x.id === id ? row : x)); delete ui.drafts[id];
        const next = nextAfter(cur);
        openReview(next?.id);
        toast(`Feedback sent to ${profile(row.client_id)?.name || "client"}.${next ? "" : " That's the queue done."}`);
      } catch (err) { b.disabled = false; fail(err, "Feedback"); }
      break;
    }
    case "cmp-toggle": ui.cmpOpen = !ui.cmpOpen; paintCompare(); break;
    case "cmp-pick": pickCompare(b.dataset.path, b.dataset.label); break;
    case "cmp-clear": if (bd?.setCompare(null)) cmpState("Put an earlier rep or one of your reference reps beside or over this one."); else toast("Stop recording first."); break;
    case "save-vid": saveVideo(b); break;
    case "clip-play": {
      const box = document.getElementById("clip-watch");
      if (box) { box.innerHTML = `<div class="vid wide" data-video="${esc(b.dataset.path)}">Loading breakdown</div>`; hydrateVideos(); }
      break;
    }
    case "clip-del": {
      const v0 = D.videos.find((x) => x.id === id), c = v0 && clipsOf(v0).find((x) => x.path === b.dataset.path);
      if (!c || !confirm(`Delete the breakdown "${c.label}"?`)) return;
      try { const row = await api.deleteClip(v0, c.path); D.videos = D.videos.map((x) => (x.id === row.id ? row : x)); paintClips(row); }
      catch (err) { fail(err, "Delete"); }
      break;
    }
    case "team-new":
      try { const row = await api.createTeam({ name: `Team ${D.teams.length + 1}` }); D.teams.push(row); go(() => { ui.view = "team"; ui.teamId = row.id; }); scrollTo(0, 0); }
      catch (err) { fail(err, "Team"); }
      break;
    case "open-team": go(() => { ui.view = "team"; ui.teamId = id; ui.confirmDelTeam = false; }); scrollTo(0, 0); break;
    case "team-del": go(() => (ui.confirmDelTeam = true)); break;
    case "team-del-no": go(() => (ui.confirmDelTeam = false)); break;
    case "team-del-yes":
      try { await api.deleteTeam(ui.teamId); D.teams = D.teams.filter((t) => t.id !== ui.teamId); D.profiles.forEach((c) => { if (c.team_id === ui.teamId) c.team_id = null; }); go(() => { ui.view = null; ui.confirmDelTeam = false; }); }
      catch (err) { fail(err, "Delete"); }
      break;
    case "copy-for":
    case "new-for": {
      const c = profile(id), src = act === "copy-for" ? planFor(c).p : null, plan = planFor(c);
      const base = src ? { name: `${src.name} (${c.name || c.email})`, note: src.note, weeks: structuredClone(src.weeks) }
        : { name: `Program for ${c.name || c.email}`, note: "", weeks: [{ days: [{ id: newId(), name: "Tribe Build", dow: 1, coachNote: "", exercises: [] }] }] };
      try {
        const row = await api.createProgram({ ...base, owner_id: c.id });
        D.programs.unshift(row);
        const patch = { program_id: row.id, ...(!c.start_date && plan.start ? { start_date: plan.start } : {}) };
        const prof = await api.updateProfile(c.id, patch); D.profiles = D.profiles.map((x) => (x.id === c.id ? prof : x));
        toast(src ? `Copied. Changes here only affect ${c.name || "them"}.` : `New program for ${c.name || "them"}. Add sessions below.`);
        go(() => { ui.programId = row.id; ui.week = 0; ui.view = "program"; }); scrollTo(0, 0);
      } catch (err) { fail(err, "Program"); }
      break;
    }
    case "open-exlib": go(() => { ui.view = "exlib"; }); scrollTo(0, 0); break;
    case "exlib-add": b.disabled = true; await addExercise(); b.disabled = false; break;
    case "exlib-del": {
      const x = D.exercises.find((y) => y.id === id);
      if (!x || !confirm(`Delete ${x.name} from the library?`)) return;
      try { await api.deleteExercise(x); D.exercises = D.exercises.filter((y) => y.id !== id); render(); } catch (err) { fail(err, "Delete"); }
      break;
    }
    case "demo": {
      const box = b.closest(".demo, .item")?.querySelector(".demo-vid");
      if (box) { box.innerHTML = box.innerHTML ? "" : `<div class="vid wide" data-video="${esc(b.dataset.path)}">Loading demo</div>`; hydrateVideos(); }
      break;
    }
    case "max-save": {
      const kg = parseFloat((document.getElementById(b.dataset.in)?.value || "").replace(",", "."));
      const ex = b.dataset.exin ? document.getElementById(b.dataset.exin)?.value.trim() : b.dataset.ex;
      if (!ex) return toast("Type the exercise first.");
      if (!(kg > 0 && kg < 1000)) return toast("Enter the 1RM in kg, e.g. 120.");
      b.disabled = true;
      try { await saveMax(b.dataset.cid, ex, kg); render(); toast(`${ex} 1RM saved: ${kg} kg.`); } catch (err) { fail(err, "1RM"); b.disabled = false; }
      break;
    }
    case "use-e1rm":
      b.disabled = true;
      try { await saveMax(b.dataset.cid, b.dataset.ex, +b.dataset.kg); render(); toast(`${b.dataset.ex} 1RM set to ${b.dataset.kg} kg.`); } catch (err) { fail(err, "1RM"); b.disabled = false; }
      break;
    case "pr-add": {
      const cid = b.dataset.cid, name = document.getElementById(`pr-new-name-${cid}`)?.value.trim(), cat = document.getElementById(`pr-new-cat-${cid}`)?.value;
      const val = document.getElementById(`pr-new-val-${cid}`)?.value.trim();
      if (!name) return toast("Type what the PR is for first.");
      if (!val || val.length > 20) return toast("Enter the PR, up to 20 characters.");
      b.disabled = true;
      try { await savePr(cid, name, cat, val); render(); toast(`${name} PR saved: ${val}.`); } catch (err) { fail(err, "PR"); b.disabled = false; }
      break;
    }
    case "ref-del":
      if (!confirm("Delete this reference rep?")) return;
      try { await api.deleteRef(b.dataset.path); ui.refs = ui.refs.filter((r) => r.path !== b.dataset.path); paintCompare(); }
      catch (err) { fail(err, "Delete"); }
      break;
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
    case "dup-week": progEdit(() => {
      const wi = +b.dataset.w, copy = structuredClone(p.weeks[wi]);
      copy.days.forEach((dd) => { dd.id = newId(); dd.exercises.forEach((x) => {
        x.id = newId(); if (x.note === W1_LINE) x.note = /%/.test(x.target) ? "" : "Increase load by 2.5-5kg from last week.";
        if (x.rows && x.metric === "% 1RM") applyRows(x, x.rows.map((r) => ({ ...r, val: bumpPct(r.val) }))); else x.target = bumpTarget(x.target);
      }); });
      p.weeks.splice(wi + 1, 0, copy);
      toast(`Copied to week ${wi + 2}. Percentages moved up 2.5% and calibration notes changed to adding load. Check each line.`);
    }); break;
    case "add-week": progEdit(() => p.weeks.push({ days: [] })); break;
    case "clip-week": {
      const wi = +b.dataset.w;
      clip.set({ kind: "week", label: `Week ${wi + 1} of ${p.name}`, data: p.weeks[wi] }); render();
      toast(`Week ${wi + 1} copied. Open any program and tap Paste after.`); break;
    }
    case "clip-sess": {
      const x = wk.days[d];
      clip.set({ kind: "session", label: `${x.name || "Session"} (week ${ui.week + 1} day ${dayNum(x.dow)})`, data: x }); render();
      toast("Session copied. Tap Paste on any day, in any program."); break;
    }
    case "clip-block": {
      const exs = wk.days[d].exercises, key = String(exs[e].block || "").trim().toUpperCase();
      const part = key ? exs.filter((x) => String(x.block || "").trim().toUpperCase() === key) : [exs[e]];
      const title = part[0].section || part.map((x) => x.name).filter(Boolean).join(" + ") || "exercise";
      clip.set({ kind: "block", label: `block ${key || ""} ${title}`.replace(/\s+/g, " ").trim(), data: part }); render();
      toast(`Copied ${part.length > 1 ? `${part.length} exercises` : "1 exercise"}. Open any session and tap Paste block.`); break;
    }
    case "clip-clear": clip.set(null); render(); break;
    case "paste-week": {
      const c = clip.get(); if (c?.kind !== "week") return;
      const wi = +b.dataset.w;
      progEdit(() => p.weeks.splice(wi + 1, 0, freshWeek(c.data)));
      toast(`Pasted as week ${wi + 2}.`); break;
    }
    case "paste-sess": {
      const c = clip.get(); if (c?.kind !== "session") return;
      const wi = +b.dataset.w, day = { ...freshDay(c.data), dow: +b.dataset.dow };
      p.weeks[wi].days.push(day);
      go(() => { ui.week = wi; ui.sess = { w: wi, id: day.id }; ui.view = "session"; }); saveProgramSoon(); scrollTo(0, 0);
      toast("Pasted. You're editing the copy."); break;
    }
    case "paste-block": {
      const c = clip.get(); if (c?.kind !== "block") return;
      const exs = wk.days[d].exercises, letter = c.data[0].block ? nextBlock(exs) : "";
      progEdit(() => exs.push(...c.data.map((x) => ({ ...structuredClone(x), id: newId(), block: letter }))));
      toast(letter ? `Pasted as block ${letter}.` : "Pasted."); break;
    }
    case "del-week": {
      const wi = +b.dataset.w;
      if (p.weeks[wi].days.length && !confirm(`Delete week ${wi + 1} and its ${p.weeks[wi].days.length} sessions?`)) return;
      progEdit(() => p.weeks.splice(wi, 1)); break;
    }
    case "open-sess": go(() => { ui.week = +b.dataset.w; ui.sess = { w: +b.dataset.w, id }; ui.view = "session"; }); scrollTo(0, 0); break;
    case "sess-day": {
      const wi = +b.dataset.w, dw = +b.dataset.dow, first = p.weeks[wi].days.find((x) => x.dow === dw);
      go(() => { ui.week = wi; ui.sess = { w: wi, id: first?.id || null, dow: dw }; }); break;
    }
    case "sess-add": {
      const wi = +b.dataset.w, day = { id: newId(), name: "Tribe Build", dow: +b.dataset.dow, coachNote: "", exercises: [] };
      p.weeks[wi].days.push(day);
      go(() => { ui.week = wi; ui.sess = { w: wi, id: day.id }; ui.view = "session"; }); saveProgramSoon(); scrollTo(0, 0); break;
    }
    case "sess-dup": {
      const copy = structuredClone(wk.days[d]); copy.id = newId(); copy.exercises.forEach((x) => (x.id = newId()));
      wk.days.splice(d + 1, 0, copy);
      go(() => (ui.sess = { w: ui.week, id: copy.id })); saveProgramSoon(); toast("Duplicated. You're editing the copy."); break;
    }
    case "sess-del":
      if (!confirm(`Delete ${wk.days[d].name || "this session"}?`)) return;
      wk.days.splice(d, 1); go(() => { ui.view = "program"; ui.sess = null; }); saveProgramSoon(); break;
    case "row-add": progEdit(() => { const x = wk.days[d].exercises[e], rows = rowsOf(x).map((r) => ({ ...r })); rows.push({ ...rows[rows.length - 1] }); applyRows(x, rows); }); break;
    case "row-del": progEdit(() => { const x = wk.days[d].exercises[e], rows = rowsOf(x).map((r) => ({ ...r })); rows.splice(+b.dataset.r, 1); applyRows(x, rows); }); break;
    case "ex-add": progEdit(() => wk.days[d].exercises.push({ id: newId(), block: nextBlock(wk.days[d].exercises), name: "", sets: 3, reps: "8", target: "7 RPE", cue: "", rest: "", note: ui.week === 0 ? W1_LINE : "" })); break;
    case "ex-del": progEdit(() => wk.days[d].exercises.splice(e, 1)); break;
    case "ex-up": progEdit(() => { const a = wk.days[d].exercises; [a[e - 1], a[e]] = [a[e], a[e - 1]]; }); break;
    case "del-program": go(() => (ui.confirmDelProgram = true)); break;
    case "del-program-no": go(() => (ui.confirmDelProgram = false)); break;
    case "del-program-yes":
      try { await api.deleteProgram(ui.programId); D.programs = D.programs.filter((x) => x.id !== ui.programId); D.profiles.forEach((c) => { if (c.program_id === ui.programId) c.program_id = null; }); D.teams.forEach((t) => { if (t.program_id === ui.programId) t.program_id = null; }); go(() => { ui.view = null; ui.confirmDelProgram = false; }); }
      catch (err) { fail(err, "Delete"); }
      break;
    case "approve": await patchProfile(id, { approved: true }, "Approved."); break;
    case "ath-go": go(() => { ui.clientId = id; ui.view = "client"; ui.clientTab = v; ui.chatRef = null; }); scrollTo(0, 0); break;
    case "bulk-unteam": await setTeams(null); break;
    case "open-client": go(() => { ui.clientId = id; ui.view = "client"; ui.clientTab = unread(id) ? "chat" : "profile"; ui.chatRef = null; }); scrollTo(0, 0); break;
    case "revoke": go(() => (ui.confirmRevoke = ui.clientId)); break;
    case "revoke-no": go(() => (ui.confirmRevoke = null)); break;
    case "revoke-yes": await patchProfile(ui.clientId, { approved: false }, "Access removed."); ui.view = null; ui.confirmRevoke = null; render(); break;
    case "open-log": go(() => { ui.logKey = { w: +b.dataset.w, id }; ui.view = "log"; }); scrollTo(0, 0); break;
    case "checkin": {
      const k = b.dataset.k, v = +b.dataset.v;
      b.closest(".seg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      await saveCheckin({ [k]: v });
      // Stays open for a note; it shows as one line next time the page draws.
      const head = b.closest(".checkin")?.querySelector(".row.spread");
      if (head && !head.querySelector(".chip")) head.insertAdjacentHTML("beforeend", '<span class="chip green">Sent to your coach</span>');
      ui.ckEdit = false;
      break;
    }
    case "pr-all": go(() => { (ui.prAll ||= {})[b.dataset.cid] = !ui.prAll[b.dataset.cid]; }); if (!ui.prAll[b.dataset.cid]) document.querySelector(".prs")?.scrollIntoView(); break;
    case "ck-edit": go(() => (ui.ckEdit = true)); break;
    case "timer": openTimer(); break;
    case "timer-ex": { const e = logFor(ui.logKey)?.day.exercises.find((x) => x.id === b.dataset.ex); if (e) openTimer(presetFor([e.name, e.section, e.score, e.reps, e.note].join(" "))); break; }
    case "add-score": go(() => { (ui.scoreOpen ||= {})[b.dataset.ex] = true; }); document.getElementById(`score-${b.dataset.ex}`)?.focus(); break;
    case "tick": {
      const { l } = logFor(ui.logKey); const s = l.entries.find((x) => x.exId === b.dataset.ex).sets[+b.dataset.s];
      s.done = !s.done; render(); saveLogSoon(l);
      if (s.done) restAfter(b.dataset.ex);
      break;
    }
    case "finish-log": {
      const { l, day } = logFor(ui.logKey); l.done = true;
      const wins = scorePRs(l, day);
      const ok = await saveLogSoon(l, true);
      const prs = newPRs(l, clientLogs(me.id), nameOf);
      ui.boards = {}; // fresh numbers next time a leaderboard shows
      if (ok === "sent") for (const w of wins) await savePr(me.id, w.name, w.cat, w.value).catch((err) => fail(err, "PR"));
      const said = [...prs.map((x) => x.kind === "heaviest" ? `${x.name} ${x.kg} kg x ${x.reps}` : `${x.name} est. 1RM ${x.e1rm} kg`), ...wins.map((w) => `${w.name} ${w.value}`)];
      go(() => (ui.view = null));
      toast(ok === "queued" ? "Saved on your phone. It sends when you're back online." : said.length ? `Session logged. New PR${said.length > 1 ? "s" : ""}: ${said.join(", ")}.` : "Session logged."); scrollTo(0, 0);
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

// Search box on the athlete table: hides rows in place so typing keeps focus.
function filterAth() {
  const q = (ui.athQ || "").trim().toLowerCase();
  document.querySelectorAll(".ath-row[data-q]").forEach((r) => (r.hidden = !!q && !r.dataset.q.includes(q)));
}
// Move the selected athletes into a team, or out of every team.
async function setTeams(teamId) {
  const ids = [...ui.athSel];
  try {
    const rows = await Promise.all(ids.map((id) => api.updateProfile(id, { team_id: teamId })));
    D.profiles = D.profiles.map((x) => rows.find((r) => r.id === x.id) || x);
    ui.athSel = new Set(); render();
    toast(teamId ? `${ids.length} added to ${D.teams.find((t) => t.id === teamId)?.name || "the team"}.` : `${ids.length} removed from their teams.`);
  } catch (err) { fail(err, "Teams"); }
}
async function patchProfile(id, patch, msg) {
  try { const row = await api.updateProfile(id, patch); D.profiles = D.profiles.map((x) => (x.id === id ? row : x)); render(); if (msg) toast(msg); }
  catch (e) { fail(e, "Client"); }
}

document.addEventListener("input", (ev) => {
  const t = ev.target, a = t.dataset.input;
  if (t.id === "v-note") { ui.vnote = t.value; return; }
  if (t.id === "v-ex") { ui.filmEx = t.value; return; }
  if (t.id === "chat-body") { ui.chatDraft = t.value; return; }
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
      x[k] = k === "sets" ? Math.max(1, +t.value || 1) : k === "block" ? t.value.trim().toUpperCase() : t.value;
      const rx = document.getElementById("rx-" + x.id); if (rx) rx.textContent = rxLine(x);
      if (k === "block") blockLabels(wk.days[d].exercises).forEach((lb, i) => { const el = document.getElementById("blk-" + wk.days[d].exercises[i].id); if (el) el.textContent = lb; });
      break;
    }
    case "row": {
      const x = wk.days[d].exercises[e], rows = rowsOf(x).map((r) => ({ ...r }));
      rows[+t.dataset.r][t.dataset.f] = t.value; applyRows(x, rows);
      const rx = document.getElementById("rx-" + x.id); if (rx) rx.textContent = rxLine(x);
      break;
    }
    case "ath-q": ui.athQ = t.value; filterAth(); return;
    case "c-goal": { const c = profile(ui.clientId); c.goal = t.value; debounce("goal", () => api.updateProfile(c.id, { goal: c.goal }).catch((err) => fail(err, "Goal"))); return; }
    case "result": { const { l } = logFor(ui.logKey); l.entries.find((x) => x.exId === t.dataset.ex).result = t.value.trim(); saveLogSoon(l); return; }
    case "set": { const { l } = logFor(ui.logKey); l.entries.find((x) => x.exId === t.dataset.ex).sets[+t.dataset.s][t.dataset.f] = t.value; saveLogSoon(l); return; }
    case "log-note": { const { l } = logFor(ui.logKey); l.note = t.value; saveLogSoon(l); return; }
  }
  saveProgramSoon();
});

document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.id === "vfile") { const f = t.files?.[0]; if (f) setFile(f); return; }
  if (t.id === "xl-file") { const f = t.files?.[0]; t.value = ""; if (f) { const bad = checkVideo(f); if (bad) return toast(bad); ui.demoFile = f; warmUp(); document.getElementById("xl-file-name").textContent = f.name; } return; }
  if (t.id === "ref-file") { const f = t.files?.[0]; t.value = ""; if (f) { warmUp(); addRef(f); } return; }
  const a = t.dataset.change; if (!a) return;
  if (a === "board-ex") { ui.boardEx = { ...ui.boardEx, [t.dataset.tid]: t.value }; document.querySelector(`[data-board="${t.dataset.tid}"]`).innerHTML = boardBody(t.dataset.tid); return; }
  if (a === "t-board") {
    try { const row = await api.saveTeam(ui.teamId, { leaderboard: t.checked }); D.teams = D.teams.map((x) => (x.id === row.id ? row : x)); toast(t.checked ? "Athletes in this team can see the leaderboard." : "Leaderboard hidden from athletes."); }
    catch (err) { fail(err, "Team"); t.checked = !t.checked; }
    return;
  }
  if (a === "prog-ex") { ui.progEx = { ...ui.progEx, [t.dataset.cid]: t.value }; render(); return; }
  if (a === "ath-group") { ui.athGroup = t.value; ui.athSel = new Set(); render(); return; }
  if (a === "ath-sel") { t.checked ? ui.athSel.add(t.dataset.id) : ui.athSel.delete(t.dataset.id); render(); return; }
  if (a === "ath-all") { document.querySelectorAll('[data-change="ath-sel"]').forEach((x) => { if (!x.closest(".ath-row").hidden) t.checked ? ui.athSel.add(x.dataset.id) : ui.athSel.delete(x.dataset.id); }); render(); return; }
  if (a === "bulk-team") { if (t.value) await setTeams(t.value); return; }
  if (a === "metric") {
    const x = program(ui.programId).weeks[ui.week].days[+t.dataset.d].exercises[+t.dataset.e], rows = rowsOf(x).map((r) => ({ ...r }));
    const was = x.metric; x.metric = t.value;
    // Switching a column on picks up the number from the old target ("7 RPE"); switching it off keeps the summary as text.
    if (x.metric && !rows.some((r) => String(r.val).trim())) { const v = parseVal(x.target, x.metric); rows.forEach((r) => (r.val = v)); }
    if (!x.metric && was) x.target = rows.every((r) => r.val === rows[0].val) ? valText(rows[0].val, was) : "";
    applyRows(x, rows); render(); saveProgramSoon();
  }
  if (a === "d-dow") { program(ui.programId).weeks[ui.week].days[+t.dataset.d].dow = +t.value; render(); saveProgramSoon(); }
  if (a === "c-prog") await patchProfile(ui.clientId, { program_id: t.value || null }, "Program assigned.");
  if (a === "lib-theme") {
    const theme = t.value.trim().slice(0, 40);
    try { const row = await api.setLibrary(t.dataset.id, theme ? { theme, keep: true } : { theme }); D.videos = D.videos.map((y) => (y.id === row.id ? row : y)); render(); }
    catch (err) { fail(err, "Theme"); }
  }
  if (a === "exlib-field") {
    const x = D.exercises.find((y) => y.id === t.dataset.id), k = t.dataset.k, val = t.value.trim();
    if (!x) return;
    if (k === "demo_url" && val && !/^https:\/\//i.test(val)) return toast("The link needs to start with https://");
    try { const row = await api.saveExercise({ ...x, [k]: val }); D.exercises = D.exercises.map((y) => (y.id === row.id ? row : y)); toast("Saved."); } catch (err) { fail(err, "Exercise"); }
  }
  if (a === "ck-note") { await saveCheckin({ note: t.value.trim().slice(0, 300) }); toast("Sent to your coach."); }
  if (a === "pr-kg") {
    const raw = t.value.trim(), kg = parseFloat(raw.replace(",", "."));
    if (raw && !(kg > 0 && kg < 1000)) return toast("Enter the 1RM in kg, e.g. 120.");
    try { await saveMax(t.dataset.cid, t.dataset.ex, raw ? kg : null); toast(raw ? `${t.dataset.ex} 1RM saved.` : `${t.dataset.ex} removed.`); } catch (err) { fail(err, "1RM"); }
  }
  if (a === "pr-val") {
    const val = t.value.trim(), kind = KINDS[t.dataset.kind] ? t.dataset.kind : "score";
    if (val && !validScore(kind, val)) return toast(`Enter ${KINDS[kind][3]}.`);
    try { await savePr(t.dataset.cid, t.dataset.name, t.dataset.cat, val); toast(val ? `${t.dataset.name} PR saved.` : `${t.dataset.name} removed.`); } catch (err) { fail(err, "PR"); }
  }
  if (a === "c-team") await patchProfile(ui.clientId, { team_id: t.value || null }, t.value ? "Added to team." : "Removed from team.");
  if (a === "t-member") await patchProfile(t.dataset.id, { team_id: t.checked ? ui.teamId : null }, t.checked ? "Added to team." : "Removed from team.");
  if (a === "t-name" || a === "t-prog" || a === "t-start") {
    const k = { "t-name": "name", "t-prog": "program_id", "t-start": "start_date" }[a], val = t.value.trim() || null;
    if (k === "name" && !val) return toast("Give the team a name.");
    try { const row = await api.saveTeam(ui.teamId, { [k]: val }); D.teams = D.teams.map((x) => (x.id === row.id ? row : x)); render(); toast("Team saved."); }
    catch (err) { fail(err, "Team"); }
  }
  if (a === "c-start") await patchProfile(ui.clientId, { start_date: t.value || null }, "Start date saved.");
});

function setFile(f) {
  const bad = checkVideo(f);
  if (bad) return toast(bad);
  ui.file = f; warmUp(); render();
}
document.addEventListener("dragover", (ev) => { const z = ev.target.closest?.("#drop"); if (z) { ev.preventDefault(); z.classList.add("over"); } });
document.addEventListener("dragleave", (ev) => ev.target.closest?.("#drop")?.classList.remove("over"));
document.addEventListener("drop", (ev) => { const z = ev.target.closest?.("#drop"); if (!z) return; ev.preventDefault(); const f = ev.dataTransfer.files?.[0]; if (f) setFile(f); });

async function doUpload() {
  if (!ui.file || ui.busy) return;
  const exercise = document.getElementById("v-ex")?.value.trim(), note = document.getElementById("v-note")?.value.trim() || "";
  if (!exercise) { toast("Type which exercise this is first."); document.getElementById("v-ex")?.focus(); return; }
  ui.busy = true; ui.vnote = note; ui.filmEx = exercise; render();
  const btn = () => document.querySelector('[data-act="upload"]');
  try {
    const f = await prepareVideo(ui.file, (t) => { if (btn()) btn().textContent = t; });
    if (btn()) btn().textContent = "Uploading...";
    const row = await api.uploadVideo(me.id, f, { exercise, note, slot: today() });
    D.videos.unshift(row);
    ui.file = null; ui.vnote = ""; ui.filmEx = null;
    toast(`Sent. You'll get feedback here within ${FEEDBACK_HOURS} hours.`);
  } catch (e) { e.userFacing ? toast(e.message) : fail(e, "Your video"); }
  ui.busy = false; render();
}

if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
