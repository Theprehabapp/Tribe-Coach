// Coach's Eye style breakdown: slow the clip down, step frames, draw on it, and record the whole
// thing with the coach's voice as a new video the client can watch.
//
// The video is painted onto a canvas every animation frame with the drawings on top. Recording
// captures that canvas plus the microphone, so whatever the coach does while recording (play,
// pause, scrub, draw) ends up in the file.
//
// Compare puts a second clip beside the first (an earlier rep, or a reference rep), or over it as a
// see-through overlay the coach can move and size to match. Each clip can be lined up in time on its
// own, then both played together.

const COLORS = [["#E4572E", "Red"], ["#FFFFFF", "White"], ["#3FB8F0", "Blue"]];
const TOOLS = [["pen", "Pen"], ["line", "Line"], ["circle", "Circle"], ["angle", "Angle"]];
const SPEEDS = [1, 0.5, 0.25];
const FPS = 30;
const MAX_SIDE = 1280; // recording resolution cap, keeps files small enough to upload
const TYPES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

export const canRecord = () =>
  typeof MediaRecorder !== "undefined" && !!HTMLCanvasElement.prototype.captureStream && !!navigator.mediaDevices?.getUserMedia;

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// multi: each saved recording is one labelled point, and the coach can record another straight after.
export function mountBreakdown(root, { src, label = "", maxSeconds = 180, maxBytes = 50 * 1048576, multi = false, nextLabel = () => "", onSave }) {
  root.innerHTML = `
    <div class="bd-stage"><canvas class="bd-canvas" aria-label="Video with drawings. Drag to draw."></canvas></div>
    <div class="bd-bar">
      <button class="btn" data-bd="play">Play</button>
      <button class="btn small" data-bd="back" aria-label="Back one frame">&lsaquo; Frame</button>
      <button class="btn small" data-bd="fwd" aria-label="Forward one frame">Frame &rsaquo;</button>
      <span class="bd-time num small muted" data-bd-time>0:00</span>
    </div>
    <div class="bd-bar" data-bd-targets hidden><span class="small muted">Controls move</span>
      <div class="seg" role="group" aria-label="Which video the controls move">${[["0", "Left"], ["1", "Right"], ["both", "Both"]].map(([k, l]) => `<button data-bd="target" data-v="${k}" aria-pressed="${k === "both"}">${l}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Layout">${[["side", "Side by side"], ["overlay", "Overlay"]].map(([k, l]) => `<button data-bd="mode" data-v="${k}" aria-pressed="${k === "side"}">${l}</button>`).join("")}</div></div>
    <div class="bd-bar" data-bd-ov hidden>
      <label class="bd-range small muted">See-through<input type="range" min="15" max="85" value="50" data-bd-alpha aria-label="Overlay see-through"></label>
      <label class="bd-range small muted">Size<input type="range" min="40" max="200" value="100" data-bd-size aria-label="Overlay size"></label>
      <button class="btn small" data-bd="move" aria-pressed="false">Move overlay</button>
      <button class="btn small ghost" data-bd="ov-reset">Reset</button></div>
    <input class="bd-scrub" type="range" min="0" max="1000" value="0" step="1" aria-label="Position in video" data-bd-scrub>
    <div class="bd-bar">
      <div class="seg" role="group" aria-label="Speed">${SPEEDS.map((s) => `<button data-bd="speed" data-v="${s}" aria-pressed="${s === 1}">${s === 1 ? "1x" : s === 0.5 ? "½x" : "¼x"}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Drawing tool">${TOOLS.map(([k, l]) => `<button data-bd="tool" data-v="${k}" aria-pressed="${k === "line"}">${l}</button>`).join("")}</div>
    </div>
    <div class="bd-bar">
      <div class="bd-colors" role="group" aria-label="Colour">${COLORS.map(([c, l], i) => `<button data-bd="color" data-v="${c}" aria-label="${l}" aria-pressed="${i === 0}" style="--c:${c}"></button>`).join("")}</div>
      <button class="btn small ghost" data-bd="undo">Undo</button>
      <button class="btn small ghost" data-bd="clear">Clear drawings</button>
    </div>
    <p class="small muted" data-bd-hint></p>
    <div class="bd-rec" data-bd-rec></div>`;

  const $ = (sel) => root.querySelector(sel);
  const canvas = $(".bd-canvas"), ctx = canvas.getContext("2d");
  const st = { tool: "line", color: COLORS[0][0], shapes: [], drawing: null, rec: null, mic: null, chunks: [], recStart: 0, result: null, resultUrl: null, saved: false, raf: 0, dead: false, target: "both", mode: "side", ov: { alpha: 0.5, scale: 1, dx: 0, dy: 0 }, moving: false, drag: null };
  const W = () => canvas.width, H = () => canvas.height;

  // vids[0] is the clip under review, vids[1] the optional compare clip. x/y/w/h is where each sits on the canvas.
  const vids = [];
  function addVideo(url, name) {
    const el = document.createElement("video");
    el.muted = true; el.playsInline = true; el.preload = "auto"; el.src = url;
    el.playbackRate = speed();
    const v = { el, url, label: name, x: 0, y: 0, w: 0, h: 0 };
    el.addEventListener("loadedmetadata", () => { layout(); el.currentTime = 0.001; }); // paint the first frame on iOS
    el.addEventListener("play", syncPlay);
    el.addEventListener("pause", syncPlay);
    el.addEventListener("error", () => { $("[data-bd-hint]").textContent = "A video couldn't be opened in the browser."; });
    return v;
  }
  const speed = () => +(root.querySelector('[data-bd="speed"][aria-pressed="true"]')?.dataset.v || 1);
  // The videos the transport controls move: just the main clip, or whichever side is picked when comparing.
  const targets = () => (vids.length < 2 ? [vids[0]] : st.target === "both" ? vids : [vids[+st.target]]).map((v) => v.el);

  const overlaid = () => st.mode === "overlay" && vids.length > 1;
  function layout() {
    const ready = vids.filter((v) => v.el.videoWidth);
    if (!ready.length) return;
    if (overlaid()) {
      // The canvas is the clip under review; the compare clip sits on top, fitted inside it, then sized and moved by the coach.
      const [a, b] = vids;
      if (!a.el.videoWidth) return;
      const k = Math.min(1, MAX_SIDE / Math.max(a.el.videoWidth, a.el.videoHeight));
      const cw = even(a.el.videoWidth * k), ch = even(a.el.videoHeight * k);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      Object.assign(a, { x: 0, y: 0, w: cw, h: ch });
      if (b.el.videoWidth) {
        const f = Math.min(cw / b.el.videoWidth, ch / b.el.videoHeight) * st.ov.scale, w = b.el.videoWidth * f, h = b.el.videoHeight * f;
        Object.assign(b, { w, h, x: (cw - w) / 2 + st.ov.dx * cw, y: (ch - h) / 2 + st.ov.dy * ch });
      }
      return;
    }
    const hc = Math.max(...ready.map((v) => v.el.videoHeight));
    const ws = vids.map((v) => (v.el.videoWidth ? (v.el.videoWidth * hc) / v.el.videoHeight : 0));
    const total = ws.reduce((a, b) => a + b, 0);
    const k = Math.min(1, MAX_SIDE / Math.max(total, hc));
    canvas.width = even(total * k); canvas.height = even(hc * k);
    let x = 0;
    vids.forEach((v, i) => { Object.assign(v, { x, y: 0, w: ws[i] * k, h: hc * k }); x += ws[i] * k; });
  }
  vids.push(addVideo(src, label));

  /* ---------- drawing ---------- */
  const px = (p) => [p[0] * W(), p[1] * H()];
  function paintShape(s) {
    const lw = Math.max(4, W() / 120);
    ctx.strokeStyle = ctx.fillStyle = s.color; ctx.lineWidth = lw; ctx.lineCap = ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = lw;
    ctx.beginPath();
    if (s.type === "pen") {
      s.pts.forEach((p, i) => { const [x, y] = px(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    } else if (s.type === "line") {
      const [ax, ay] = px(s.a), [bx, by] = px(s.b);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    } else if (s.type === "circle") {
      const [ax, ay] = px(s.a), [bx, by] = px(s.b);
      ctx.arc(ax, ay, Math.hypot(bx - ax, by - ay), 0, Math.PI * 2); ctx.stroke();
    } else if (s.type === "angle") {
      const [ax, ay] = px(s.a), [bx, by] = px(s.b);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      if (s.c) {
        const [cx, cy] = px(s.c);
        ctx.lineTo(cx, cy); ctx.stroke();
        const a1 = Math.atan2(ay - by, ax - bx), a2 = Math.atan2(cy - by, cx - bx);
        let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        const r = Math.max(24, W() / 16);
        ctx.beginPath(); ctx.arc(bx, by, r, a1, a1 + d, d < 0); ctx.stroke();
        const deg = Math.round(Math.abs(d) * 180 / Math.PI), mid = a1 + d / 2;
        const fs = Math.max(16, W() / 22);
        ctx.font = `700 ${fs}px Barlow, Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const tx = bx + Math.cos(mid) * (r + fs * 1.1), ty = by + Math.sin(mid) * (r + fs * 1.1);
        ctx.shadowBlur = 0; ctx.fillStyle = "rgba(0,0,0,.7)";
        const tw = ctx.measureText(`${deg}°`).width + fs * 0.6;
        ctx.fillRect(tx - tw / 2, ty - fs * 0.65, tw, fs * 1.3);
        ctx.fillStyle = s.color; ctx.fillText(`${deg}°`, tx, ty);
      } else ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
  // While a video is seeking (scrubbing, frame steps) the browser has no frame to give, which used to
  // paint black. Each video keeps a copy of its last good frame and shows that until the new one is ready.
  function paintVideo(v) {
    if (!v.w) return;
    const fw = Math.round(v.w), fh = Math.round(v.h);
    if (!v.last) v.last = document.createElement("canvas");
    if (v.last.width !== fw || v.last.height !== fh) { v.last.width = fw; v.last.height = fh; v.hasFrame = false; }
    if (v.el.readyState >= 2 && !v.el.seeking) { v.last.getContext("2d").drawImage(v.el, 0, 0, fw, fh); v.hasFrame = true; }
    if (!v.hasFrame) return;
    ctx.globalAlpha = overlaid() && v === vids[1] ? st.ov.alpha : 1;
    ctx.drawImage(v.last, v.x, v.y, v.w, v.h);
    ctx.globalAlpha = 1;
  }
  function paintLabel(v) {
    if (!v.label || !v.w) return;
    const fs = Math.max(14, W() / 40), pad = fs * 0.45;
    ctx.font = `700 ${fs}px Barlow, Arial, sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "top";
    const tw = Math.min(ctx.measureText(v.label).width, v.w - pad * 4);
    ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(v.x + pad, v.y + pad, tw + pad * 2, fs + pad * 2);
    ctx.fillStyle = "#fff"; ctx.fillText(v.label, v.x + pad * 2, v.y + pad * 2, tw);
  }
  function frame() {
    if (st.dead) return;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W(), H());
    vids.forEach(paintVideo);
    if (vids.length > 1 && !overlaid()) vids.forEach(paintLabel);
    st.shapes.forEach(paintShape);
    if (st.drawing) paintShape(st.drawing);
    tick();
    st.raf = requestAnimationFrame(frame);
  }

  const pos = (ev) => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))];
  };
  canvas.addEventListener("pointerdown", (ev) => {
    ev.preventDefault(); canvas.setPointerCapture(ev.pointerId);
    const p = pos(ev), last = st.shapes[st.shapes.length - 1];
    if (st.moving && overlaid()) { st.drag = { p, dx: st.ov.dx, dy: st.ov.dy }; return; }
    if (st.tool === "angle" && last?.type === "angle" && !last.c) { st.shapes.pop(); st.drawing = { ...last, c: p }; return; }
    st.drawing = st.tool === "pen" ? { type: "pen", color: st.color, pts: [p] } : { type: st.tool, color: st.color, a: p, b: p };
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (st.drag) { const p = pos(ev); st.ov.dx = st.drag.dx + p[0] - st.drag.p[0]; st.ov.dy = st.drag.dy + p[1] - st.drag.p[1]; layout(); return; }
    if (!st.drawing) return;
    const p = pos(ev), d = st.drawing;
    if (d.type === "pen") d.pts.push(p); else if (d.type === "angle" && d.c) d.c = p; else d.b = p;
  });
  const endDraw = () => {
    st.drag = null;
    const d = st.drawing; if (!d) return;
    st.drawing = null;
    const tiny = d.type !== "pen" && !d.c && Math.hypot((d.b[0] - d.a[0]) * W(), (d.b[1] - d.a[1]) * H()) < 6;
    if (!tiny) st.shapes.push(d);
    hint();
  };
  canvas.addEventListener("pointerup", endDraw);
  canvas.addEventListener("pointercancel", endDraw);

  /* ---------- transport ---------- */
  const playBtn = $('[data-bd="play"]'), scrub = $("[data-bd-scrub]"), timeEl = $("[data-bd-time]");
  function syncPlay() { playBtn.textContent = targets().every((el) => el.paused) ? "Play" : "Pause"; }
  let scrubbing = false;
  function tick() {
    const lead = targets()[0], d = lead.duration || 0;
    if (!scrubbing && d) scrub.value = Math.round((lead.currentTime / d) * 1000);
    timeEl.textContent = `${fmt(lead.currentTime || 0)} / ${fmt(d)}${st.rec ? `  ·  REC ${fmt((performance.now() - st.recStart) / 1000)}` : ""}`;
    if (st.rec && (performance.now() - st.recStart) / 1000 >= maxSeconds) stopRec();
  }
  // Scrubbing follows the first target; any other target moves by the same amount so lined-up reps stay lined up.
  // fastSeek jumps to the nearest key frame, which keeps dragging smooth on iPhone; letting go lands on the exact frame.
  const clamp = (el, t) => Math.min(el.duration || 0, Math.max(0, t));
  const seek = (el, t, fast) => { t = clamp(el, t); if (fast && el.fastSeek) el.fastSeek(t); else el.currentTime = t; el._target = t; };
  scrub.addEventListener("input", () => {
    scrubbing = true;
    const [lead, ...rest] = targets();
    if (!lead.duration) return;
    const from = (el) => (el.seeking && el._target != null ? el._target : el.currentTime);
    const delta = (scrub.value / 1000) * lead.duration - from(lead);
    [lead, ...rest].forEach((el) => { el.pause(); seek(el, from(el) + delta, true); });
  });
  scrub.addEventListener("change", () => {
    scrubbing = false;
    targets().forEach((el) => el._target != null && seek(el, el._target)); // settle on the exact frame
  });
  const step = (n) => targets().forEach((el) => { el.pause(); seek(el, el.currentTime + n / FPS); });

  function hint() {
    const last = st.shapes[st.shapes.length - 1];
    $("[data-bd-hint]").textContent = st.moving && overlaid() ? "Drag the overlay to line it up. Tap Move overlay again to draw."
      : st.tool === "angle" ? (last?.type === "angle" && !last.c ? "Now drag from the joint to draw the second line." : "Angle: drag along the first limb, ending at the joint.")
      : st.tool === "circle" ? "Circle: drag out from the centre." : st.tool === "pen" ? "Pen: draw freehand." : "Line: drag from start to end.";
  }

  /* ---------- recording ---------- */
  const recEl = $("[data-bd-rec]");
  function recUI() {
    if (!canRecord()) { recEl.innerHTML = '<p class="small muted">This browser can\'t record a breakdown. Use Safari or Chrome on an up-to-date phone or computer.</p>'; return; }
    if (st.rec) { recEl.innerHTML = `<div class="row"><button class="btn rec on" data-bd="stop"><span class="recdot"></span>Stop recording</button><span class="small muted">Talk them through it. Recording stops by itself at ${fmt(maxSeconds)}.</span></div>`; return; }
    if (st.saved && !st.result) {
      recEl.innerHTML = multi
        ? '<div class="row"><span class="chip green">Saved</span><button class="btn rec" data-bd="record"><span class="recdot"></span>Record another point</button></div><p class="small" data-bd-msg role="status"></p>'
        : '<div class="row"><span class="chip green">Breakdown saved</span><button class="btn small ghost" data-bd="retake">Record a new one</button></div>';
      return;
    }
    if (st.result) {
      const mb = st.result.size / 1048576;
      recEl.innerHTML = `<div class="stack"><div class="section-head"><h3>Your breakdown</h3><span class="small muted num">${mb.toFixed(1)} MB</span></div>
        <video class="bd-preview" controls playsinline src="${st.resultUrl}"></video>
        ${st.result.size > maxBytes ? `<p class="small" style="color:var(--red)">Too big to save (over ${Math.round(maxBytes / 1048576)} MB). Record a shorter one.</p>` : ""}
        ${multi ? `<label class="f">What's this point about?<input class="t" data-bd-label maxlength="60" placeholder="e.g. Bar path off the floor"></label>` : ""}
        <div class="row"><button class="btn primary" data-bd="save"${st.result.size > maxBytes ? " disabled" : ""}>${multi ? "Save this point" : "Save for client"}</button><button class="btn ghost" data-bd="retake">Record again</button></div>
        <p class="small" data-bd-msg role="status"></p></div>`;
      return;
    }
    recEl.innerHTML = `<div class="row"><button class="btn rec" data-bd="record"><span class="recdot"></span>Record breakdown</button><span class="small muted">Records the screen above and your voice.</span></div><p class="small" data-bd-msg role="status"></p>`;
  }
  async function startRec() {
    const msg = () => recEl.querySelector("[data-bd-msg]");
    try {
      st.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      if (msg()) msg().textContent = "Couldn't use the microphone. Allow microphone access for this site in your browser settings, then try again.";
      return;
    }
    const stream = canvas.captureStream(FPS);
    st.mic.getAudioTracks().forEach((t) => stream.addTrack(t));
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    try { st.rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 }); }
    catch (e) { stopMic(); if (msg()) msg().textContent = `Recording isn't available here: ${e.message}`; return; }
    st.chunks = [];
    st.rec.ondataavailable = (e) => e.data.size && st.chunks.push(e.data);
    st.rec.onstop = () => {
      const type = (st.rec?.mimeType || mimeType || "video/webm");
      st.rec = null; stopMic();
      if (st.dead) return;
      st.result = new Blob(st.chunks, { type: type.split(";")[0] });
      st.resultUrl = URL.createObjectURL(st.result);
      recUI();
    };
    st.rec.start(1000);
    st.recStart = performance.now();
    recUI();
  }
  function stopRec() { if (st.rec && st.rec.state !== "inactive") st.rec.stop(); }
  function stopMic() { st.mic?.getTracks().forEach((t) => t.stop()); st.mic = null; }
  function dropResult() { if (st.resultUrl) URL.revokeObjectURL(st.resultUrl); st.result = st.resultUrl = null; }

  /* ---------- buttons ---------- */
  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-bd]"); if (!b || b.disabled) return;
    const v = b.dataset.v;
    const press = (group) => root.querySelectorAll(`[data-bd="${group}"]`).forEach((x) => x.setAttribute("aria-pressed", x === b));
    switch (b.dataset.bd) {
      case "play": {
        const els = targets();
        if (els.every((el) => el.paused)) els.forEach((el) => el.play().catch(() => {}));
        else els.forEach((el) => el.pause());
        break;
      }
      case "back": step(-1); break;
      case "fwd": step(1); break;
      case "speed": press("speed"); vids.forEach((x) => (x.el.playbackRate = +v)); break;
      case "target": st.target = v; press("target"); syncPlay(); break;
      case "mode": {
        // The canvas changes size between layouts, which a recording in progress can't follow.
        if (st.rec || v === st.mode) break;
        st.mode = v; press("mode"); st.shapes = []; st.moving = false; setMoving(); showMode(); layout(); hint();
        break;
      }
      case "move": st.moving = !st.moving; setMoving(); hint(); break;
      case "ov-reset": Object.assign(st.ov, { scale: 1, dx: 0, dy: 0 }); $("[data-bd-size]").value = 100; layout(); break;
      case "tool": st.tool = v; press("tool"); { const last = st.shapes[st.shapes.length - 1]; if (last?.type === "angle" && !last.c) st.shapes.pop(); } hint(); break;
      case "color": st.color = v; press("color"); break;
      case "undo": st.shapes.pop(); hint(); break;
      case "clear": st.shapes = []; hint(); break;
      case "record": b.disabled = true; await startRec(); if (!st.rec) b.disabled = false; break;
      case "stop": stopRec(); break;
      case "retake": dropResult(); st.saved = false; recUI(); break;
      case "save": {
        const m = recEl.querySelector("[data-bd-msg]");
        b.disabled = true; m.textContent = "Saving...";
        const name = recEl.querySelector("[data-bd-label]")?.value.trim() || nextLabel();
        try { await onSave(st.result, name); dropResult(); st.saved = true; recUI(); }
        catch (e) { m.textContent = `Didn't save: ${e.message || e}. Check your connection and try again.`; b.disabled = false; }
        break;
      }
    }
  });

  $("[data-bd-alpha]").addEventListener("input", (ev) => { st.ov.alpha = 1 - ev.target.value / 100; });
  $("[data-bd-size]").addEventListener("input", (ev) => { st.ov.scale = ev.target.value / 100; layout(); });
  function setMoving() { $('[data-bd="move"]').setAttribute("aria-pressed", st.moving); canvas.style.cursor = st.moving && overlaid() ? "move" : ""; }
  // Overlay controls only while overlaid; the time controls name the clips by what they are rather than left and right.
  function showMode() {
    $("[data-bd-ov]").hidden = !overlaid();
    const names = overlaid() ? ["This video", "Overlay"] : ["Left", "Right"];
    root.querySelectorAll('[data-bd="target"]').forEach((x) => { if (x.dataset.v !== "both") x.textContent = names[+x.dataset.v]; });
  }
  function unload(v) { v.el.pause(); v.el.removeAttribute("src"); v.el.load(); URL.revokeObjectURL(v.url); }
  function press(group, val) { root.querySelectorAll(`[data-bd="${group}"]`).forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === val)); }

  hint(); recUI(); syncPlay();
  st.raf = requestAnimationFrame(frame);

  return {
    get unsaved() { return !!st.rec || !!st.result; },
    get recording() { return !!st.rec; },
    // Put a second clip beside the main one, or pass null to remove it. Not while recording: the
    // canvas changes size, which a recording in progress can't follow. Drawings are cleared because
    // they were placed for the old layout.
    setCompare(url, name = "") {
      if (st.rec) return false;
      if (vids[1]) { unload(vids[1]); vids.pop(); }
      if (url) {
        vids[0].label = vids[0].label || "This video";
        vids.push(addVideo(url, name));
        vids[0].el.pause();
      }
      $("[data-bd-targets]").hidden = !url;
      st.shapes = []; st.target = "both"; press("target", "both");
      Object.assign(st.ov, { scale: 1, dx: 0, dy: 0 }); $("[data-bd-size]").value = 100; st.moving = false; setMoving();
      showMode(); layout(); syncPlay(); hint();
      return true;
    },
    destroy() {
      st.dead = true; cancelAnimationFrame(st.raf);
      stopRec(); stopMic(); dropResult();
      vids.forEach(unload);
    },
  };
}
