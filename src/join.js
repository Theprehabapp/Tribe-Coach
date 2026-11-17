// The public /join page: plan cards from src/plans.js, a sign-up sheet, then Stripe checkout.
// Flow: pick a plan -> name, email, password (a normal Tribe account) -> Stripe -> back here with ?paid=1.
// Stripe tells worker/stripe.js, which records the plan and approves the account, so there's nothing for the coach to do.
import * as api from "./api.js";
import { PLANS, STREAMS, FOCUS, COACH_EMAIL, planById, payable } from "./plans.js";

// Real quotes only, with permission. Leave empty and the block stays hidden.
// { quote: "...", name: "First name L.", detail: "Coaching, 8 months" }
const TESTIMONIALS = [];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const per = { week: "week", month: "month", year: "year" };
let session = null, chosen = null;

// A plan without a price is "apply first": the button opens an email to the coach instead of Stripe.
const applyLink = (p) => `mailto:${COACH_EMAIL}?subject=${encodeURIComponent(`Tribe ${p.name} application`)}&body=${encodeURIComponent("Name:\nCrossFit or Hyrox (or both):\nNext competition and date:\nBest recent results:\nInstagram:\n")}`;
function planCard(p) {
  const pay = payable(p);
  return `<article class="plan${p.featured ? " featured" : ""}">
      ${p.featured ? `<span class="badge">${pay ? "Most support" : "Limited spots"}</span>` : ""}
      <h3>${esc(p.name)}</h3>
      <p class="tagline">${esc(p.blurb)}</p>
      <div class="price">${pay ? `<b>$${p.price}</b><span>AUD / ${per[p.interval] || p.interval}</span>` : "<b>Apply</b><span>by application</span>"}</div>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <div class="stack-sm">${pay ? `<button class="btn primary" data-plan="${esc(p.id)}">Choose ${esc(p.name)}</button>` : `<a class="btn primary" href="${applyLink(p)}">Apply for ${esc(p.name)}</a>`}
      <p class="trial">${!pay ? "Tell me about your season and I'll get back to you within 24 hours" : p.trialDays ? `${p.trialDays} days free, then $${p.price} a ${per[p.interval]}` : "Cancel any time"}</p></div>
    </article>`;
}
function renderPlans() {
  $("plan-list").innerHTML = STREAMS.map((st, i) => {
    const plans = PLANS.filter((p) => p.stream === st.id);
    return plans.length ? `<div class="stream" id="plans-${st.id}"><div class="stream-head"><span class="kicker">Stream 0${i + 1}</span><h3>${esc(st.name)}</h3><p>${esc(st.blurb)}</p></div>
      <div class="plans">${plans.map(planCard).join("")}</div></div>` : "";
  }).join("");
  const from = Math.min(...PLANS.filter(payable).map((p) => p.price));
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
  if (!payable(chosen)) return;
  $("su-plan").textContent = `${chosen.name} - $${chosen.price} AUD a ${per[chosen.interval]}`;
  $("su-msg").textContent = "";
  const signedIn = !!session;
  $("su-fields").hidden = signedIn;
  $("su-fields").querySelectorAll("input").forEach((i) => (i.required = !signedIn));
  $("su-title").textContent = signedIn ? "Confirm your plan" : "Set up your login";
  $("su-lead").innerHTML = signedIn
    ? `<span class="signed-in">Signed in as <strong>${esc(session.user.email)}</strong></span>`
    : "This is the email and password you'll use to log in to the app. Next, you'll pay on Stripe's secure page.";
  // What they're training for; tick as many as fit. Saved as their goal so the coach knows which program to give.
  $("su-focus-list").innerHTML = FOCUS.map((f) => `<label class="chip"><input type="checkbox" value="${esc(f)}"><span>${esc(f)}</span></label>`).join("");
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
    const focus = [...document.querySelectorAll("#su-focus-list input:checked")].map((i) => i.value);
    location.href = await api.startCheckout(chosen.id, email, focus);
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
  if (want && payable(planById(want))) { document.getElementById("plans").scrollIntoView(); openSheet(want); }
}
init();
