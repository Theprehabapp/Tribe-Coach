// Serves the app (static files in dist/) and one endpoint: /api/push, which the database calls to
// deliver a phone notification. The database sends the subscription, the message and the VAPID keys;
// nothing is stored here. Only real browser push services are accepted as destinations.
import { sendPush } from "./push.js";

const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== "/api/push") return env.ASSETS.fetch(req);
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    let job;
    try { job = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
    const { subscription: s, payload, vapid } = job || {};
    let host = "";
    try { host = new URL(s.endpoint).hostname; } catch {}
    if (!s?.endpoint?.startsWith("https://") || !PUSH_HOSTS.some((r) => r.test(host)) || !s.keys?.p256dh || !s.keys?.auth || !vapid?.publicKey || !vapid?.privateKey)
      return new Response("bad request", { status: 400 });
    const r = await sendPush(s, JSON.stringify(payload ?? {}), { subject: "mailto:coach@tribeheadquarters.com.au", ...vapid });
    // Pass the push service's answer back (410 means the phone unsubscribed) so the database log shows it.
    return new Response(await r.text(), { status: r.status });
  },
};
