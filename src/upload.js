// Gets a picked video ready to upload: shrinks it on the phone when the browser can, and checks the
// result fits the storage limit. The shrinking code is only downloaded when someone uploads.
import { MAX_VIDEO_MB } from "./api.js";

export const MAX_PICK_MB = 1024; // bigger than this is almost certainly not just one set
const canShrink = () => typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined";
const mb = (n) => (n / 1048576).toFixed(0);
const userError = (msg) => Object.assign(new Error(msg), { userFacing: true });

// Start downloading the shrinking code as soon as a video is picked, so it's ready by the time they tap Send.
export const warmUp = () => { if (canShrink()) import("./shrink.js").catch(() => {}); };

// Returns a message to show if the file can't be used, otherwise "".
export function checkVideo(f) {
  if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm)$/i.test(f.name)) return "That isn't a video file.";
  if (f.size > MAX_PICK_MB * 1048576) return `That video is ${mb(f.size)} MB. Trim it to just the set and try again.`;
  if (!canShrink() && f.size > MAX_VIDEO_MB * 1048576) return `That video is ${mb(f.size)} MB. Trim it to just the set (under ${MAX_VIDEO_MB} MB) and try again.`;
  return "";
}

// Resolves to the file to upload. Throws an error with userFacing set when the video can't be sent.
export async function prepareVideo(file, onText = () => {}) {
  const bad = checkVideo(file);
  if (bad) throw userError(bad);
  let out = null;
  if (canShrink()) {
    onText("Shrinking video...");
    const { shrinkVideo } = await import("./shrink.js");
    out = await shrinkVideo(file, (p) => onText(`Shrinking video ${Math.round(p * 100)}%`));
  }
  const f = out ? new File([out], `video.${out.type === "video/webm" ? "webm" : "mp4"}`, { type: out.type }) : file;
  if (f.size > MAX_VIDEO_MB * 1048576)
    throw userError(`${out ? "Even shrunk, that" : "That"} video is ${mb(f.size)} MB. Trim it to just the set (under ${MAX_VIDEO_MB} MB) and try again.`);
  return f;
}
