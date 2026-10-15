// Phone notifications on this device. iPhones only allow them for the app opened from the Home Screen
// (iOS 16.4 or later), so outside that the button explains how to add it instead.
import * as api from "./api.js";

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const iPhone = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const fromHomeScreen = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// "on", "off", "blocked" (said no in settings), or "install" (iPhone, not opened from the Home Screen).
export async function state() {
  if (!supported()) return iPhone() && !fromHomeScreen() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

// The coach's first tap creates the notification keys on their phone; the private half goes
// straight to the database's Vault and never leaves Supabase again.
async function serverKey(isCoach) {
  const existing = await api.pushPublicKey();
  if (existing) return existing;
  if (!isCoach) throw Object.assign(new Error("Your coach hasn't switched notifications on yet."), { userFacing: true });
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey));
  await api.setPushKeys(pub, (await crypto.subtle.exportKey("jwk", kp.privateKey)).d);
  return pub;
}

export async function turnOn(isCoach) {
  const key = await serverKey(isCoach);
  if ((await Notification.requestPermission()) !== "granted")
    throw Object.assign(new Error("Notifications are blocked. Allow them for this app in your phone's settings, then try again."), { userFacing: true });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with old keys can't be used with new ones.
  if (sub && b64u(sub.options.applicationServerKey || new ArrayBuffer(0)) !== key) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) });
  const j = sub.toJSON();
  await api.savePushSub(j.endpoint, j.keys.p256dh, j.keys.auth);
}

export async function turnOff() {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!sub) return;
  await api.deletePushSub(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
