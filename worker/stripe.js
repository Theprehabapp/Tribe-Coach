// Stripe payments for the /join page. Three endpoints, no Stripe library (plain fetch + Web Crypto):
//   POST /api/checkout        opens a Stripe Checkout page for a plan in src/plans.js
//   POST /api/stripe-webhook  Stripe tells us a subscription started, changed or ended; we record it in Supabase
//   POST /api/billing-portal  a signed-in athlete gets Stripe's page to cancel, change card or see receipts
// Secrets (Cloudflare > Workers > tribe-coach > Settings > Variables and Secrets): STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY. SUPABASE_URL is a plain var in wrangler.jsonc.
import { CURRENCY, FOCUS, planById, payable } from "../src/plans.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fail = (status, code, error) => json({ code, error }, status);
const ready = (env) => env.STRIPE_SECRET_KEY && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_URL;
const PAID = ["active", "trialing"];

// Stripe wants nested form fields: { a: { b: 1 } } -> a[b]=1, arrays as a[0][b]=1.
export function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function stripe(env, method, path, params) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? form(params) : undefined,
  });
  const out = await r.json();
  if (!r.ok) throw new Error(`Stripe ${path}: ${out.error?.message || r.status}`);
  return out;
}
// Supabase REST with the service role key (bypasses row rules; only ever used here, never in the browser).
async function db(env, path, init = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...init.headers },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
// The signed-in person behind a browser's access token, or null.
async function userFrom(req, env) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth } });
  return r.ok ? r.json() : null;
}

// Stripe-Signature: t=<unix>,v1=<hex hmac of "t.payload">. Rejects anything older than 5 minutes.
export async function verifySignature(payload, header, secret, now = Date.now() / 1000, tolerance = 300) {
  const parts = Object.fromEntries((header || "").split(",").map((p) => p.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = (header || "").split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now - t) > tolerance) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

// What Stripe is sent for a plan. Uses a Price made in the Stripe dashboard if the plan names one (stripePrice),
// otherwise describes the price inline so nothing has to be set up in Stripe first.
export function checkoutParams(plan, { userId, email, origin }) {
  return {
    mode: "subscription",
    line_items: [plan.stripePrice ? { price: plan.stripePrice, quantity: 1 } : {
      quantity: 1,
      price_data: { currency: CURRENCY, unit_amount: Math.round(plan.price * 100), recurring: { interval: plan.interval }, product_data: { name: `Tribe ${plan.name}` } },
    }],
    customer_email: email,
    client_reference_id: userId,
    metadata: { user_id: userId, plan: plan.id },
    subscription_data: { metadata: { user_id: userId, plan: plan.id }, trial_period_days: plan.trialDays || undefined },
    allow_promotion_codes: "true",
    success_url: `${origin}/join?paid=1`,
    cancel_url: `${origin}/join?cancelled=1#plans`,
  };
}

async function checkout(req, env) {
  let body;
  try { body = await req.json(); } catch { return fail(400, "bad_request", "Bad request."); }
  const plan = planById(body?.plan);
  if (!payable(plan)) return fail(400, "bad_plan", "That plan doesn't exist.");
  // Who is paying: the signed-in person, or the account just made on /join (matched by email, not yet approved).
  const user = await userFrom(req, env);
  const email = String(user?.email || body.email || "").trim().toLowerCase();
  if (!email) return fail(400, "bad_request", "Enter your email.");
  const [profile] = await db(env, user ? `profiles?id=eq.${user.id}&select=id,email,approved,role` : `profiles?email=eq.${encodeURIComponent(email)}&select=id,email,approved,role`);
  if (!profile) return fail(400, "no_account", "We couldn't find that account. Try again in a few seconds.");
  if (profile.role === "coach") return fail(400, "coach", "That's the coach account.");
  const [sub] = await db(env, `subscriptions?user_id=eq.${profile.id}&select=status`);
  if (sub && PAID.includes(sub.status)) return fail(409, "already_paid", "That account already has an active plan.");
  // Without a session, an approved account must sign in first, so nobody can start a plan on someone else's account.
  if (!user && profile.approved) return fail(409, "existing_account", "There's already an account with that email.");
  // What they're training for, picked on /join, becomes their goal unless they've already written one.
  const focus = (Array.isArray(body.focus) ? body.focus : []).filter((f) => FOCUS.includes(f));
  if (focus.length) await db(env, `profiles?id=eq.${profile.id}&goal=eq.`, { method: "PATCH", body: JSON.stringify({ goal: focus.join(", ") }) });
  const origin = new URL(req.url).origin;
  const s = await stripe(env, "POST", "checkout/sessions", checkoutParams(plan, { userId: profile.id, email: profile.email || email, origin }));
  return json({ url: s.url });
}

// The subscription as one row for public.billing_sync().
export function syncArgs(sub, fallbackUser, fallbackEmail) {
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return {
    p_user: sub.metadata?.user_id || fallbackUser,
    p_email: fallbackEmail || "",
    p_plan: sub.metadata?.plan || "",
    p_status: sub.status,
    p_customer: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    p_subscription: sub.id,
    p_period_end: end ? new Date(end * 1000).toISOString() : null,
  };
}

async function webhook(req, env) {
  const payload = await req.text();
  if (!env.STRIPE_WEBHOOK_SECRET || !(await verifySignature(payload, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)))
    return new Response("bad signature", { status: 400 });
  const ev = JSON.parse(payload), o = ev.data?.object || {};
  let args = null;
  if (ev.type === "checkout.session.completed" && o.mode === "subscription" && o.subscription) {
    const sub = await stripe(env, "GET", `subscriptions/${o.subscription}`);
    args = syncArgs(sub, o.client_reference_id, o.customer_details?.email || o.customer_email);
  } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) {
    args = syncArgs(o);
  }
  // Not ours (no Tribe user on it) or an event we don't use: say thanks so Stripe stops sending it.
  if (!args?.p_user) return new Response("ignored");
  // An error here returns 500, and Stripe retries for up to three days.
  await db(env, "rpc/billing_sync", { method: "POST", body: JSON.stringify(args) });
  return new Response("ok");
}

async function portal(req, env) {
  const user = await userFrom(req, env);
  if (!user) return fail(401, "signed_out", "Sign in first.");
  const [sub] = await db(env, `subscriptions?user_id=eq.${user.id}&select=stripe_customer`);
  if (!sub?.stripe_customer) return fail(404, "no_plan", "There's no paid plan on this account.");
  const s = await stripe(env, "POST", "billing_portal/sessions", { customer: sub.stripe_customer, return_url: `${new URL(req.url).origin}/` });
  return json({ url: s.url });
}

const ROUTES = { "/api/checkout": checkout, "/api/stripe-webhook": webhook, "/api/billing-portal": portal };
export async function handleStripe(req, env) {
  const route = ROUTES[new URL(req.url).pathname];
  if (!route) return null;
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!ready(env)) return fail(503, "not_configured", "Payments aren't switched on yet.");
  try { return await route(req, env); }
  catch (e) { console.error(e); return fail(500, "server", "Something went wrong on our side. Try again in a minute."); }
}
