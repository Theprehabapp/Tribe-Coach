// Shrinks a client's video on their own phone before it's uploaded: 720p, a sensible bitrate, the
// index at the front of the file so it starts playing straight away, and a key frame every second so
// scrubbing and frame stepping in the breakdown tool stay quick. A minute of iPhone video drops from
// 100+ MB to roughly 20 MB.
//
// Uses the browser's own video encoder (WebCodecs). Where that's missing or the file can't be read,
// shrinkVideo returns null and the caller uploads the original instead.
import { Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat, WebMOutputFormat, canEncodeVideo } from "mediabunny";

const SHORT_SIDE = 720;
const VIDEO_BPS = 2_500_000;
const AUDIO_BPS = 96_000;

// `codec` is only overridden by tests: the test browser has no H.264 encoder, real phones do.
export async function shrinkVideo(file, onProgress = () => {}, { codec = "avc" } = {}) {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return null;
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const w = await track.getDisplayWidth(), h = await track.getDisplayHeight();
    const k = Math.min(1, SHORT_SIDE / Math.min(w, h));
    const size = w <= h ? { width: even(w * k) } : { height: even(h * k) };
    if (!(await canEncodeVideo(codec, { ...size, bitrate: VIDEO_BPS }))) return null;
    const mp4 = codec === "avc";

    const format = mp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat();
    const output = new Output({ format, target: new BufferTarget() });
    const conversion = await Conversion.init({
      input, output, tracks: "primary", showWarnings: false,
      video: { ...size, codec, bitrate: VIDEO_BPS, keyFrameInterval: 1, frameRate: Math.min(60, (await track.computePacketStats(60)).averagePacketRate || 30), forceTranscode: true },
      audio: { codec: mp4 ? "aac" : "opus", bitrate: AUDIO_BPS },
    });
    if (!conversion.isValid || conversion.discardedTracks.some((t) => t.track.type === "video")) return null;
    conversion.onProgress = (p) => onProgress(p);
    await conversion.execute();
    const blob = new Blob([output.target.buffer], { type: mp4 ? "video/mp4" : "video/webm" });
    return blob.size < file.size ? blob : null; // already small: keep the original
  } catch (e) {
    console.warn("Couldn't shrink video, uploading the original", e);
    return null;
  } finally {
    input.dispose?.();
  }
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
