// The plans on the /join page. The worker reads this same list when it opens a Stripe checkout, so the price a
// person pays always matches the price on the page. To add a plan, copy a block and give it a new id.
// price: whole AUD per `interval` ("week", "month" or "year"). trialDays: free days before the first charge (0 = none).
// Changing a price only affects new sign-ups; people already paying stay on the price they signed up at.
export const CURRENCY = "aud";
export const PLANS = [
  {
    id: "programming",
    name: "Programming",
    price: 25,
    interval: "week",
    trialDays: 0,
    blurb: "Your program, written for your week, in the app.",
    features: [
      "A long-term program that moves with work, sleep and stress",
      "Every session in the app: sets, reps, loads, timer",
      "Daily check-in so I can see how you're tracking",
      "PR board, progress charts and team leaderboards",
    ],
  },
  {
    id: "coaching",
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
];
export const planById = (id) => PLANS.find((p) => p.id === id) || null;
