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
export const onAuth = (fn) => sb.auth.onAuthStateChange((_e, session) => fn(session));
export const sendLink = (email, name) =>
  sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, data: name ? { name } : undefined } }).then(check);
export const signOut = () => sb.auth.signOut();

/* ---------- loading ---------- */
export async function myProfile(uid) {
  return check(await sb.from("profiles").select("*").eq("id", uid).maybeSingle());
}

// RLS decides what comes back: the coach gets everyone, a client gets their own rows and assigned program.
export async function loadAll() {
  const [profiles, programs, logs, videos] = await Promise.all([
    sb.from("profiles").select("*").order("created_at").then(check),
    sb.from("programs").select("*").order("created_at", { ascending: false }).then(check),
    sb.from("logs").select("*").order("date", { ascending: false }).then(check),
    sb.from("videos").select("*").order("uploaded_at", { ascending: false }).then(check),
  ]);
  return { profiles, programs, logs, videos };
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

const urlCache = new Map();
export async function videoUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { signedUrl } = check(await sb.storage.from(BUCKET).createSignedUrl(path, 3600));
  urlCache.set(path, { url: signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return signedUrl;
}

export const reviewVideo = (id, verdict, feedback) =>
  sb.from("videos").update({ verdict, feedback, status: "reviewed", reviewed_at: new Date().toISOString() }).eq("id", id).select().single().then(check);

// Free storage space: delete files for videos reviewed more than `days` ago. The feedback stays.
export async function cleanupVideos(videos, days = 30) {
  const cutoff = Date.now() - days * 864e5;
  const old = videos.filter((v) => v.status === "reviewed" && v.storage_path && new Date(v.reviewed_at).getTime() < cutoff);
  if (!old.length) return 0;
  check(await sb.storage.from(BUCKET).remove(old.map((v) => v.storage_path)));
  check(await sb.from("videos").update({ storage_path: null }).in("id", old.map((v) => v.id)));
  return old.length;
}
