import test from "node:test";
import assert from "node:assert/strict";
import { verifySignature, form, checkoutParams, syncArgs } from "../worker/stripe.js";
import { PLANS, planById } from "../src/plans.js";

async function sign(payload, secret, t) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("accepts a genuine Stripe signature and rejects tampered, wrong-key and stale ones", async () => {
  const body = '{"id":"evt_1","type":"checkout.session.completed"}', t = 1_800_000_000;
  const v1 = await sign(body, "whsec_test", t);
  assert.equal(await verifySignature(body, `t=${t},v1=${v1}`, "whsec_test", t + 10), true);
  // Stripe may send several v1 signatures while a secret is being rolled.
  assert.equal(await verifySignature(body, `t=${t},v1=${"0".repeat(64)},v1=${v1}`, "whsec_test", t), true);
  assert.equal(await verifySignature(body + " ", `t=${t},v1=${v1}`, "whsec_test", t), false);
  assert.equal(await verifySignature(body, `t=${t},v1=${v1}`, "whsec_other", t), false);
  assert.equal(await verifySignature(body, `t=${t},v1=${v1}`, "whsec_test", t + 301), false);
  assert.equal(await verifySignature(body, "", "whsec_test", t), false);
  assert.equal(await verifySignature(body, null, "whsec_test", t), false);
});

test("encodes nested fields the way Stripe expects", () => {
  const f = form({ mode: "subscription", line_items: [{ quantity: 1, price_data: { recurring: { interval: "week" } } }], skip: undefined });
  assert.equal(decodeURIComponent(f.toString()), "mode=subscription&line_items[0][quantity]=1&line_items[0][price_data][recurring][interval]=week");
});

test("checkout charges the plan's price weekly in AUD, tied to the Tribe account", () => {
  const p = checkoutParams(planById("coaching"), { userId: "u1", email: "amy@x", origin: "https://tribe.example" });
  assert.equal(p.mode, "subscription");
  assert.deepEqual(p.line_items[0].price_data, { currency: "aud", unit_amount: 5000, recurring: { interval: "week" }, product_data: { name: "Tribe Coaching" } });
  assert.equal(p.client_reference_id, "u1");
  assert.deepEqual(p.subscription_data.metadata, { user_id: "u1", plan: "coaching" });
  assert.equal(p.subscription_data.trial_period_days, undefined);
  assert.equal(p.success_url, "https://tribe.example/join?paid=1");
  // A plan that names a Stripe dashboard price uses it instead.
  assert.deepEqual(checkoutParams({ ...planById("coaching"), stripePrice: "price_123" }, { userId: "u1", email: "a", origin: "o" }).line_items[0], { price: "price_123", quantity: 1 });
  assert.equal(checkoutParams({ ...planById("coaching"), trialDays: 7 }, { userId: "u1", email: "a", origin: "o" }).subscription_data.trial_period_days, 7);
});

test("reads the subscription from old and new Stripe API shapes", () => {
  const a = syncArgs({ id: "sub_1", status: "active", customer: "cus_1", metadata: { user_id: "u1", plan: "coaching" }, current_period_end: 1_800_000_000 });
  assert.deepEqual(a, { p_user: "u1", p_email: "", p_plan: "coaching", p_status: "active", p_customer: "cus_1", p_subscription: "sub_1", p_period_end: new Date(1_800_000_000_000).toISOString() });
  const b = syncArgs({ id: "sub_2", status: "past_due", customer: { id: "cus_2" }, metadata: {}, items: { data: [{ current_period_end: 1_800_000_000 }] } }, "u2", "ben@x");
  assert.equal(b.p_user, "u2"); assert.equal(b.p_customer, "cus_2"); assert.equal(b.p_email, "ben@x"); assert.ok(b.p_period_end);
  assert.equal(syncArgs({ id: "sub_3", status: "active", customer: "c" }).p_user, undefined);
});

test("every plan is something Stripe will accept", () => {
  assert.ok(PLANS.length >= 1);
  assert.equal(new Set(PLANS.map((p) => p.id)).size, PLANS.length);
  for (const p of PLANS) {
    assert.match(p.id, /^[a-z0-9-]+$/);
    assert.ok(p.price > 0 && Number.isFinite(p.price), p.id);
    assert.ok(["day", "week", "month", "year"].includes(p.interval), p.id);
    assert.ok(Array.isArray(p.features) && p.features.length, p.id);
    for (const s of [p.name, p.blurb, ...p.features]) assert.doesNotMatch(s, /[–—]/, "no long dashes");
  }
});
