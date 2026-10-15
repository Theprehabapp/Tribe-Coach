// Everything that talks to Supabase. The UI never calls supabase directly.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const sb = configured ? createClient(url, key) : null;

const BUCKET = "videos";
export const MAX_VIDEO_MB = 50;

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/* ---------- auth ---------- */
export const getSession = async () => (await sb.auth.getSession()).data.session;
export const onAuth = (fn) => sb.auth.onAuthStateChange((event, session) => fn(session, event));
const home = () => location.origin + location.pathname;
export const signIn = (email, password) => sb.auth.signInWithPassword({ email, password }).then(check);
// Returns { session } straight away when Supabase doesn't require email confirmation, otherwise { session: null }.
export const signUp = (email, password, name) =>
  sb.auth.signUp({ email, password, options: { emailRedirectTo: home(), data: name ? { name } : undefined } }).then(check);
export const sendReset = (email) => sb.auth.resetPasswordForEmail(email, { redirectTo: home() }).then(check);
export const setPassword = (password) => sb.auth.updateUser({ password }).then(check);
export const signOut = () => sb.auth.signOut();

/* ---------- loading ---------- */
export async function myProfile(uid) {
  return check(await sb.from("profiles").select("*").eq("id", uid).maybeSingle());
}

// RLS decides what comes back: the coach gets everyone, a client gets their own rows and assigned program.
export async function loadAll() {
  const [profiles, programs, logs, videos, messages] = await Promise.all([
    sb.from("profiles").select("*").order("created_at").then(check),
    sb.from("programs").select("*").order("created_at", { ascending: false }).then(check),
    sb.from("logs").select("*").order("date", { ascending: false }).then(check),
    sb.from("videos").select("*").order("uploaded_at", { ascending: false }).then(check),
    // Chat arrived with migration 0004. Until it's run, the rest of the app keeps working without it.
    sb.from("messages").select("*").order("created_at").then(check).catch(() => null),
  ]);
  // Labelled breakdown clips arrived with migration 0006; until it's run, one breakdown per video as before.
  return { profiles, programs, logs, videos, messages: messages || [], chatReady: !!messages, clipsReady: videos.some((v) => "clips" in v) };
}

/* ---------- profiles ---------- */
export const updateProfile = (id, patch) => sb.from("profiles").update(patch).eq("id", id).select().single().then(check);

/* ---------- programs ---------- */
export const createProgram = (p) => sb.from("programs").insert(p).select().single().then(check);
export const saveProgram = (p) =>
  sb.from("programs").update({ name: p.name, note: p.note, weeks: p.weeks, updated_at: new Date().toISOString() }).eq("id", p.id).then(check);
export const deleteProgram = (id) => sb.from("programs").delete().eq("id", id).then(check);

/* ---------- logs ---------- */
export const saveLog = (l) =>
  sb.from("logs")
    .upsert({ id: l.id, client_id: l.client_id, program_id: l.program_id, week: l.week, day_id: l.day_id, date: l.date, done: l.done, note: l.note, entries: l.entries, updated_at: new Date().toISOString() })
    .select().single().then(check);

/* ---------- videos ---------- */
export async function uploadVideo(uid, file, meta) {
  const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const type = file.type || (ext === "mov" ? "video/quicktime" : "video/mp4");
  check(await sb.storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false }));
  try {
    return check(await sb.from("videos").insert({ client_id: uid, exercise: meta.exercise, note: meta.note, slot: meta.slot, storage_path: path }).select().single());
  } catch (e) {
    await sb.storage.from(BUCKET).remove([path]); // don't leave an orphan file behind
    throw e;
  }
}

// Coach's breakdown recording, stored in the client's folder so the client can play it back.
export async function uploadBreakdown(video, blob) {
  const type = (blob.type || "video/mp4").split(";")[0];
  const path = `${video.client_id}/review-${crypto.randomUUID()}.${type === "video/webm" ? "webm" : "mp4"}`;
  check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false }));
  try {
    const row = check(await sb.from("videos").update({ review_path: path }).eq("id", video.id).select().single());
    if (video.review_path) await sb.storage.from(BUCKET).remove([video.review_path]); // replaced an earlier take
    return row;
  } catch (e) {
    await sb.storage.from(BUCKET).remove([path]);
    throw e;
  }
}

// The breakdown tool draws video frames onto a canvas, so it needs a same-origin copy of the file.
export async function videoBlobUrl(path) {
  return URL.createObjectURL(check(await sb.storage.from(BUCKET).download(path)));
}

const urlCache = new Map();
export async function videoUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { signedUrl } = check(await sb.storage.from(BUCKET).createSignedUrl(path, 3600));
  urlCache.set(path, { url: signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return signedUrl;
}

/* ---------- coach reference clips (for side-by-side compare) ----------
   Kept in the coach's own folder as ref-<label>--<id>.<ext>. The label lives in the file name, so no table is needed. */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "reference";
const unslug = (s) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export async function listRefs(coachId) {
  const files = check(await sb.storage.from(BUCKET).list(coachId, { limit: 1000, sortBy: { column: "created_at", order: "desc" } }));
  return files.filter((f) => f.name.startsWith("ref-")).map((f) => ({ path: `${coachId}/${f.name}`, label: unslug(f.name.slice(4).split("--")[0]) }));
}
export async function uploadRef(coachId, file, label) {
  const type = (file.type || "video/mp4").split(";")[0];
  const ext = type === "video/webm" ? "webm" : type === "video/quicktime" ? "mov" : "mp4";
  const path = `${coachId}/ref-${slug(label)}--${crypto.randomUUID().slice(0, 8)}.${ext}`;
  check(await sb.storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false }));
  return { path, label: unslug(slug(label)) };
}
export const deleteRef = async (path) => check(await sb.storage.from(BUCKET).remove([path]));

/* ---------- chat ---------- */
export const loadMessages = () => sb.from("messages").select("*").order("created_at").then(check);
export const sendMessage = (m) =>
  sb.from("messages").insert({ client_id: m.client_id, body: m.body || "", video_id: m.video_id || null, clip_path: m.clip_path || null }).select().single().then(check);
export const markRead = (clientId) => sb.rpc("mark_read", { thread: clientId }).then(check);
// Calls fn with each new message this person is allowed to see, as it's posted.
export function onMessage(fn) {
  const ch = sb.channel("messages").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => fn(p.new)).subscribe();
  return () => sb.removeChannel(ch);
}
// A breakdown recorded from the library goes to the athlete's chat as a clip in their folder.
export async function uploadChatClip(clientId, blob) {
  const type = (blob.type || "video/mp4").split(";")[0];
  const path = `${clientId}/chat-${crypto.randomUUID()}.${type === "video/webm" ? "webm" : "mp4"}`;
  check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false }));
  return path;
}

/* ---------- phone notifications ---------- */
export const pushPublicKey = async () => check(await sb.from("settings").select("push_public_key").eq("id", 1).maybeSingle())?.push_public_key || null;
export const setPushKeys = (public_key, private_key) => sb.rpc("set_push_keys", { public_key, private_key }).then(check);
export const savePushSub = (sub_endpoint, sub_p256dh, sub_auth) => sb.rpc("save_push_sub", { sub_endpoint, sub_p256dh, sub_auth }).then(check);
export const deletePushSub = (sub_endpoint) => sb.rpc("delete_push_sub", { sub_endpoint }).then(check);

/* ---------- library ---------- */
// One labelled breakdown clip, added after any already on the video.
export async function addClip(video, blob, label) {
  const type = (blob.type || "video/mp4").split(";")[0];
  const path = `${video.client_id}/review-${crypto.randomUUID()}.${type === "video/webm" ? "webm" : "mp4"}`;
  check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false }));
  try {
    return check(await sb.from("videos").update({ clips: [...(video.clips || []), { path, label }] }).eq("id", video.id).select().single());
  } catch (e) {
    await sb.storage.from(BUCKET).remove([path]);
    throw e;
  }
}
export async function deleteClip(video, path) {
  const row = path === video.review_path
    ? check(await sb.from("videos").update({ review_path: null }).eq("id", video.id).select().single())
    : check(await sb.from("videos").update({ clips: (video.clips || []).filter((c) => c.path !== path) }).eq("id", video.id).select().single());
  await sb.storage.from(BUCKET).remove([path]);
  return row;
}

export const setLibrary = (id, patch) => sb.from("videos").update(patch).eq("id", id).select().single().then(check);

export const reviewVideo = (id, verdict, feedback) =>
  sb.from("videos").update({ verdict, feedback, status: "reviewed", reviewed_at: new Date().toISOString() }).eq("id", id).select().single().then(check);

// Free storage space: delete files (client video and breakdown) for videos reviewed more than `days` ago,
// except ones saved to an athlete's library. Written feedback stays.
export async function cleanupVideos(videos, days = 30) {
  const cutoff = Date.now() - days * 864e5;
  const files = (v) => [v.storage_path, v.review_path, ...(v.clips || []).map((c) => c.path)].filter(Boolean);
  const old = videos.filter((v) => v.status === "reviewed" && !v.keep && files(v).length && new Date(v.reviewed_at).getTime() < cutoff);
  if (!old.length) return 0;
  check(await sb.storage.from(BUCKET).remove(old.flatMap(files)));
  const cleared = { storage_path: null, review_path: null, ...(old.some((v) => "clips" in v) ? { clips: [] } : {}) };
  check(await sb.from("videos").update(cleared).in("id", old.map((v) => v.id)));
  return old.length;
}
