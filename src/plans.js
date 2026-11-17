// The plans on the /join page, grouped into streams. The worker reads this same list when it opens a Stripe
// checkout, so the price a person pays always matches the price on the page. To add a plan, copy a block.
// price: whole AUD per `interval` ("week", "month" or "year"), or null for "apply first" (button emails the coach,
// no payment). trialDays: free days before the first charge (0 = none). stripePrice: optional Stripe dashboard price id.
// Changing a price only affects new sign-ups; people already paying stay on the price they signed up at.
export const CURRENCY = "aud";
export const COACH_EMAIL = "coach@tribeheadquarters.com.au";

export const STREAMS = [
  { id: "everyday", name: "Everyday athlete", blurb: "CrossFit, Hyrox or strength programming that fits around work and life." },
  { id: "compete", name: "Competitor", blurb: "For elite and semi-elite athletes training for CrossFit or Hyrox competition." },
];

// Asked at sign-up and saved as the athlete's goal, so the coach knows which program to give them.
export const FOCUS = ["CrossFit", "Hyrox", "Strength", "General fitness"];

export const PLANS = [
  {
    id: "programming",
    stream: "everyday",
    name: "Programming",
    price: 25,
    interval: "week",
    trialDays: 0,
    blurb: "Your CrossFit, Hyrox or strength program in the app.",
    features: [
      "Periodised year round - no junk volume",
      "Every session in the app: sets, reps, loads, timer",
      "Daily check-in so I can see how you're tracking",
      "PR board, progress charts and team leaderboards",
    ],
  },
  {
    id: "coaching",
    stream: "everyday",
    name: "Coaching",
    price: 50,
    interval: "week",
    trialDays: 0,
    featured: true,
    blurb: "Everything in Programming, plus me watching your lifts.",
    features: [
      "Everything in Programming",
      "Film a lift, get a breakdown back within 24 hours",
      "Slow-motion breakdowns with drawing and my voice",
      "Chat with me in the app",
      "Monthly check-in call, booked in the first week of the month",
    ],
  },
  {
    id: "competitor",
    stream: "compete",
    name: "Competitor",
    price: null,
    interval: "week",
    trialDays: 0,
    featured: true,
    blurb: "Individual coaching built around your competition season.",
    features: [
      "Season plan built backwards from your competitions",
      "Testing to find where the points are, then programming for it",
      "Video breakdowns within 24 hours",
      "Chat with me in the app",
      "Monthly call to review the block and plan the next",
    ],
  },
];
export const planById = (id) => PLANS.find((p) => p.id === id) || null;
// A plan people can pay for straight away (has a price).
export const payable = (p) => !!p && Number.isFinite(p.price) && p.price > 0;
