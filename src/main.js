import "./styles.css";
import * as api from "./api.js";
import { exampleProgram } from "./example.js";
import { mountBreakdown } from "./breakdown.js";
import { prepareVideo, checkVideo, warmUp } from "./upload.js";
import * as notify from "./notify.js";
import {
  FEEDBACK_HOURS, DOW_LONG, W1_LINE, ymd, fmtDay, fmtLong, fmtTime,
  dueAt, timeLeft, weekOf, sessionDate, rxLine, bumpTarget,
} from "./schedule.js";

const STREAMS = ["Tribe Build", "Hypertrophy X", "TribeFit", "Aerobic Conditioning", "HYROX"];
const app = document.getElementById("app");
const tabsEl = document.getElementById("tabs");

// All data the signed-in person may see, loaded once and kept in sync as they act.
let D = { profiles: [], programs: [], logs: [], videos: [], messages: [], chatReady: false, clipsReady: false };
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
    `<button data-act="tab" data-v="${k}"${ui.tab === k && !ui.view ? ' aria-current="page"' : ""}><span class="dot"></span>${label}${n ? ` <span class="count num">${n}</span>` : ""}</button>`).join("");
}
function render() {
  renderTabs();

  if (bd && ui.view !== "review") { bd.destroy(); bd = null; }
  if (ui.view !== "review") dropPrefetch();
  if (bd) return; // the breakdown tool manages its own screen

  let html;
  if (ui.view === "program") html = vProgramEdit();
  else if (ui.view === "client") html = vClientDetail();
  else if (ui.view === "log") html = vLog();
  else if (ui.view === "password") html = vSetPassword(false);
  else if (ui.view === "review") html = vReview();
  else if (isCoach()) html = ui.tab === "queue" ? vQueue() : ui.tab === "programs" ? vPrograms() : vClients();
  else html = ui.tab === "today" ? vToday() : ui.tab === "videos" ? vClientVideos() : ui.tab === "chat" ? vClientChat() : vHistory();
  app.innerHTML = html + footer();
  hydrateVideos();
  afterChatPaint();
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
    } catch (e) {
      box.className = "vid placeholder"; box.textContent = "Couldn't load this video.";
    }
  });
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
  const p = program(c?.program_id), w = c ? weekOf(c.start_date, new Date()) : -1;
  if (ui.lib) return `<div class="row"><button class="link" data-act="lib-back">Back to ${esc(c?.name || "client")}'s library</button></div>
    <section class="hero"><div class="kicker">${esc(c?.name || "Client")}, library</div><h1>${esc(v.exercise)}</h1>
    <div class="row">${v.status === "waiting" ? '<span class="chip">Waiting for review</span>' : verdictChip(v.verdict)}<span class="small muted">Uploaded ${fmtTime(v.uploaded_at)}</span></div>
    ${v.feedback ? `<p class="small">Your feedback: ${esc(v.feedback)}</p>` : ""}</section>
    <div class="row"><button class="btn small" data-act="cmp-toggle" id="cmp-btn">Compare</button><span class="small muted" id="cmp-state">Put an earlier rep or a reference rep beside this one.</span></div>
    <div id="cmp-pick" class="card stack" hidden></div>
    <div id="bd-root" class="bd"><div class="empty">Loading video</div></div>
    <p class="small muted">${D.chatReady ? `Record and save a breakdown and it's sent to ${esc(c?.name || "them")} in your chat.` : "Saving a breakdown here replaces the one on this video."}</p>`;
  return `<div class="row spread"><button class="link" data-act="back">Back to queue</button>${at >= 0 ? `<span class="small muted num">${at + 1} of ${list.length}</span>` : ""}</div>
    <section class="hero"><div class="kicker">${esc(c?.name || "Client")}${p ? `, ${esc(p.name)}${w >= 0 ? ` week ${w + 1}` : ""}` : ""}</div><h1>${esc(v.exercise)}</h1>
    <div class="row"><span class="chip${left.overdue ? " red" : ""}">${left.label}</span><span class="small muted">Uploaded ${fmtTime(v.uploaded_at)}</span></div>
    ${v.note ? `<p>"${esc(v.note)}"</p>` : '<p class="small muted">No note from the client.</p>'}</section>
    <div class="row"><button class="btn small" data-act="cmp-toggle" id="cmp-btn">Compare</button><span class="small muted" id="cmp-state">Put an earlier rep or a reference rep beside this one.</span></div>
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
    cmpState(`Comparing with <strong>${esc(label)}</strong>. Line the reps up with Left and Right, then play Both. <button class="link" data-act="cmp-clear">Remove</button>`, true);
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
      <div class="row">${wk ? `<span class="chip num">${logged}/${wk.days.length} sessions this week</span>` : ""}${vids ? `<span class="chip accent num">${vids} video${vids > 1 ? "s" : ""} waiting</span>` : ""}${unread(c.id) ? `<span class="chip solid num">${unread(c.id)} new message${unread(c.id) > 1 ? "s" : ""}</span>` : ""}</div></button>`;
  }
  if (!clients().some((c) => c.approved)) out += '<div class="empty">No clients yet.</div>';
  return out + "</div>";
}
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
    <div class="grid2"><label class="f">Program<select class="t" id="c-prog" data-change="c-prog"><option value="">None</option>${D.programs.map((p) => `<option value="${p.id}"${c.program_id === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <label class="f">Start date<input class="t" type="date" id="c-start" data-change="c-start" value="${esc(c.start_date || "")}"></label></div>
    <p class="muted small">Start on a Monday so week numbers line up with the calendar.</p></section>`;
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
  return `<section class="stack">${pushNotice(who)}<div class="chat" id="chat-list">${chatList(cid, who)}</div>
    <form id="chat-form" class="chat-compose stack" data-cid="${cid}">
      ${ref ? `<div class="row"><span class="chip">About ${esc(ref.exercise)}, ${fmtDay(new Date(ref.uploaded_at))}</span><button class="link small" type="button" data-act="unref">Remove</button></div>` : ""}
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
// Opens what a notification points at: "#chat" for an athlete, "#chat-<athlete id>" for the coach.
function openLink(hash) {
  if (bd || !me) return;
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
    const v = m.video_id && D.videos.find((x) => x.id === m.video_id);
    return `<div class="msg${m.sender_id === me.id ? " mine" : ""}">${v ? `<span class="small muted">About ${esc(v.exercise)}, ${fmtDay(new Date(v.uploaded_at))}</span>` : ""}
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
    const row = await api.sendMessage({ client_id: cid, body, video_id: ui.chatRef || null });
    addMessage(row);
    ui.chatDraft = ""; ui.chatRef = null; render();
    document.getElementById("chat-body")?.focus();
  } catch (e) { fail(e, "Your message"); btn.disabled = false; }
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
  const p = program(me.program_id);
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
    case "signout": stopChat?.(); stopChat = null; await api.signOut(); started = null; me = null; ui.authMode = "in"; renderShell(vSignIn()); break;
    case "auth-mode": ui.authEmail = document.getElementById("si-email")?.value.trim() || ui.authEmail; ui.authMode = v; renderShell(vSignIn()); break;
    case "password": go(() => (ui.view = "password")); scrollTo(0, 0); break;
    case "tab":
    case "back":
      if (bd?.unsaved && !confirm("Leave without saving this breakdown?")) return;
      if (act === "tab") { go(() => { ui.tab = v; ui.view = null; }); scrollTo(0, 0); break; }
      go(() => { ui.view = null; ui.confirmRevoke = null; ui.confirmDelProgram = false; }); break;
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
    case "unref": ui.chatRef = null; ui.chatDraft = document.getElementById("chat-body")?.value || ""; render(); break;
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
    case "cmp-clear": if (bd?.setCompare(null)) cmpState("Put an earlier rep or a reference rep beside this one."); else toast("Stop recording first."); break;
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
    case "open-client": go(() => { ui.clientId = id; ui.view = "client"; ui.clientTab = unread(id) ? "chat" : "profile"; ui.chatRef = null; }); scrollTo(0, 0); break;
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
  if (t.id === "ref-file") { const f = t.files?.[0]; t.value = ""; if (f) { warmUp(); addRef(f); } return; }
  const a = t.dataset.change; if (!a) return;
  if (a === "d-dow") { program(ui.programId).weeks[ui.week].days[+t.dataset.d].dow = +t.value; render(); saveProgramSoon(); }
  if (a === "c-prog") await patchProfile(ui.clientId, { program_id: t.value || null }, "Program assigned.");
  if (a === "lib-theme") {
    const theme = t.value.trim().slice(0, 40);
    try { const row = await api.setLibrary(t.dataset.id, theme ? { theme, keep: true } : { theme }); D.videos = D.videos.map((y) => (y.id === row.id ? row : y)); render(); }
    catch (err) { fail(err, "Theme"); }
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
