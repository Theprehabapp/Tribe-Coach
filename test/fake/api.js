// In-memory stand-in for src/api.js, used only by the UI smoke test (vite --mode fake).
import { exampleProgram } from "../../src/example.js";
export const configured = true;
export const MAX_VIDEO_MB = 50;
const role = new URLSearchParams(location.search).get("as") || "coach";
const coach = { id: "c", email: "coach@x", name: "Coach", role: "coach", approved: true, goal: "" };
const amy = { id: "a", email: "amy@x", name: "Amy", role: "client", approved: true, goal: "", program_id: null, start_date: "2026-09-28" };
const ben = { id: "b", email: "ben@x", name: "Ben", role: "client", approved: false, goal: "" };
const db = { profiles: [coach, amy, ben], programs: [], logs: [], videos: [] };
if (new URLSearchParams(location.search).get("seed")) { db.programs.push({ id: "p-seed", ...exampleProgram() }); amy.program_id = "p-seed"; }
const meRow = role === "coach" ? coach : amy;
export const getSession = async () => ({ user: { id: meRow.id } });
export const onAuth = () => {};
export const sendLink = async () => {};
export const signOut = async () => {};
export const myProfile = async () => meRow;
export const loadAll = async () => structuredClone(db);
export const updateProfile = async (id, patch) => Object.assign(db.profiles.find((p) => p.id === id), patch) && structuredClone(db.profiles.find((p) => p.id === id));
export const createProgram = async (p) => { const row = { id: "p" + db.programs.length, ...structuredClone(p) }; db.programs.push(row); return structuredClone(row); };
export const saveProgram = async () => {};
export const deleteProgram = async () => {};
export const saveLog = async (l) => l;
export const uploadVideo = async (uid, file, meta) => ({ id: "v" + Date.now(), client_id: uid, exercise: meta.exercise, note: meta.note, slot: meta.slot, status: "waiting", verdict: "", feedback: "", uploaded_at: new Date().toISOString(), storage_path: "a/x.mp4" });
export const videoUrl = async () => "data:video/mp4;base64,";
export const reviewVideo = async (id, verdict, feedback) => ({ id, client_id: "a", exercise: "Back Squat", status: "reviewed", verdict, feedback, slot: "2026-10-13", uploaded_at: new Date().toISOString(), reviewed_at: new Date().toISOString(), storage_path: "a/x.mp4" });
export const cleanupVideos = async () => 0;
