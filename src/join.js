// The public /join page: plan cards from src/plans.js, a sign-up sheet, then Stripe checkout.
// Flow: pick a plan -> name, email, password (a normal Tribe account) -> Stripe -> back here with ?paid=1.
// Stripe tells worker/stripe.js, which records the plan and approves the account, so there's nothing for the coach to do.
import * as api from "./api.js";
import { PLANS, planById } from "./plans.js";

// Real quotes only, with permission. Leave empty and the block stays hidden.
// { quote: "...", name: "First name L.", detail: "Coaching, 8 months" }
const TESTIMONIALS = [];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const per = { week: "week", month: "month", year: "year" };
let session = null, chosen = null;

function renderPlans() {
  $("plan-list").innerHTML = PLANS.map((p) => `<article class="plan${p.featured ? " featured" : ""}">
      ${p.featured ? '<span class="badge">Most support</span>' : ""}
      <h3>${esc(p.name)}</h3>
      <p class="tagline">${esc(p.blurb)}</p>
      <div class="price"><b>$${p.price}</b><span>AUD / ${per[p.interval] || p.interval}</span></div>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <div class="stack-sm"><button class="btn primary" data-plan="${esc(p.id)}">Choose ${esc(p.name)}</button>
      <p class="trial">${p.trialDays ? `${p.trialDays} days free, then $${p.price} a ${per[p.interval]}` : "Cancel any time"}</p></div>
    </article>`).join("");
  const from = Math.min(...PLANS.map((p) => p.price));
  document.querySelectorAll("[data-from-price]").forEach((el) => (el.textContent = `$${from}`));
}

function renderQuotes() {
  if (!TESTIMONIALS.length) return;
  $("quotes").innerHTML = TESTIMONIALS.map((t) => `<blockquote><p>${esc(t.quote)}</p><cite>${esc(t.name)}${t.detail ? `, ${esc(t.detail)}` : ""}</cite></blockquote>`).join("");
  $("quotes").hidden = false;
}

// Back from Stripe.
function renderNotice() {
  const q = new URLSearchParams(location.search), n = $("notice");
  if (q.has("paid")) {
    n.innerHTML = `<div class="card"><div class="kicker">Payment done</div><h2>You're in</h2>
      <p class="lead">${session ? "Your plan is active. Open the app and your program is waiting." : "Check your inbox for an email from Tribe and tap the link to confirm your address. Then log in with the email and password you just chose."}</p>
      <div><a class="btn primary" href="/">${session ? "Open the app" : "Go to log in"}</a></div></div>`;
    n.hidden = false;
  } else if (q.has("cancelled")) {
    n.innerHTML = `<div class="card warn"><p>No payment was taken. Pick a plan whenever you're ready.</p></div>`;
    n.hidden = false;
  }
}

function openSheet(planId) {
  chosen = planById(planId);
  if (!chosen) return;
  $("su-plan").textContent = `${chosen.name} - $${chosen.price} AUD a ${per[chosen.interval]}`;
  $("su-msg").textContent = "";
  const signedIn = !!session;
  $("su-fields").hidden = signedIn;
  $("su-fields").querySelectorAll("input").forEach((i) => (i.required = !signedIn));
  $("su-title").textContent = signedIn ? "Confirm your plan" : "Set up your login";
  $("su-lead").innerHTML = signedIn
    ? `<span class="signed-in">Signed in as <strong>${esc(session.user.email)}</strong></span>`
    : "This is the email and password you'll use to log in to the app. Next, you'll pay on Stripe's secure page.";
  $("su-go").disabled = false;
  $("signup").showModal();
  if (!signedIn) $("su-name").focus();
}

const MESSAGES = {
  already_paid: "That account already has an active plan. Log in to the app to train, or tap Manage billing at the bottom of the app to change it.",
  existing_account: "There's already an account with that email. Log in to the app first, then come back to this page and pick your plan.",
  not_configured: "Sign-ups open soon. Email coach@tribeheadquarters.com.au and I'll set you up.",
};

async function submit(ev) {
  ev.preventDefault();
  const msg = $("su-msg"), btn = $("su-go");
  btn.disabled = true; msg.textContent = "One sec...";
  try {
    let email = session?.user?.email;
    if (!session) {
      email = $("su-email").value.trim();
      // Makes the Tribe account. With "Confirm email" on, there's no session yet; the worker matches it by email.
      // An email that's already registered comes back without an error (Supabase hides it), and the worker sorts that out.
      await api.signUp(email, $("su-pass").value, $("su-name").value.trim());
    }
    msg.textContent = "Opening secure payment...";
    location.href = await api.startCheckout(chosen.id, email);
  } catch (e) {
    msg.textContent = MESSAGES[e.code] || (/registered/i.test(e.message) ? MESSAGES.existing_account : e.message);
    btn.disabled = false;
  }
}

async function init() {
  renderPlans();
  renderQuotes();
  if (api.configured) { try { session = await api.getSession(); } catch { session = null; } }
  renderNotice();
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-plan]");
    if (b) openSheet(b.dataset.plan);
    if (ev.target.closest("[data-close]")) $("signup").close();
  });
  $("su-form").addEventListener("submit", submit);
  // Arrived from an Instagram link like /join?plan=coaching: open that plan straight away.
  const want = new URLSearchParams(location.search).get("plan");
  if (want && planById(want)) { document.getElementById("plans").scrollIntoView(); openSheet(want); }
}
init();
