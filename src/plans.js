// The streams and plans on the /join page. The worker reads this same list when it opens a Stripe checkout, so the
// price a person pays always matches the price on the page. To add a plan, copy a block.
//
// Stream fields:
//   join: "rolling" = a new athlete joins the stream's team and trains the live week with everyone else.
//         "week1"   = a new athlete gets their own copy of the team's program, starting at week 1 this Monday.
//   comingSoon: shows a "join the list" button (emails the coach) instead of plans.
//   The coach links each stream to a team on the team page ("Website sign-ups join this team").
// Plan fields:
//   price: whole AUD per `interval` ("week", "month" or "year"), or null for "enquire" (button emails the coach,
//   no payment). trialDays: free days before the first charge (0 = none). stripePrice: optional Stripe price id.
// Changing a price only affects new sign-ups; people already paying stay on the price they signed up at.
export const CURRENCY = "aud";
export const COACH_EMAIL = "coach@tribeheadquarters.com.au";

export const STREAMS = [
  {
    id: "crossfit", name: "CrossFit Tribe", join: "rolling",
    blurb: "Year-round CrossFit programming: an off-season to build, then a build into the Open and beyond.",
    detail: "For everyday CrossFitters and competitors. Competitors, take Coaching and I'll plan around your season.",
  },
  {
    id: "transformation", name: "Body Transformation", join: "week1",
    blurb: "Build muscle or lose fat with a structured block that starts at week 1, the day you join.",
    detail: "Built on my 12-week muscle building challenge. Everyone starts at the beginning, not halfway through.",
  },
  {
    id: "hyrox", name: "Hyrox", join: "rolling", comingSoon: true,
    blurb: "A 12-week build for your next Hyrox race.",
    detail: "Being written now. Join the list and you'll hear first when it opens.",
  },
  {
    id: "affiliate", name: "Tribe Affiliate", join: "rolling",
    blurb: "The Tribe class program, for home gyms, open gym members and other gyms.",
    detail: "The same sessions my classes do each day. Train it on your own, or run it in your gym.",
  },
];

export const PLANS = [
  { id: "crossfit-programming", stream: "crossfit", name: "Programming", price: 25, interval: "week", trialDays: 0,
    blurb: "The CrossFit Tribe program in the app.",
    features: ["Periodised year round - no junk volume", "Every session in the app: sets, reps, loads, timer", "Daily check-in, PR board and team leaderboards"] },
  { id: "crossfit-coaching", stream: "crossfit", name: "Coaching", price: 50, interval: "week", trialDays: 0, featured: true,
    blurb: "Everything in Programming, plus me in your corner.",
    features: ["Everything in Programming", "Video breakdowns within 24 hours", "Chat with me in the app", "Monthly check-in call", "Competing? I plan around your season"] },
  { id: "transformation-programming", stream: "transformation", name: "Programming", price: 25, interval: "week", trialDays: 0,
    blurb: "Your own copy of the program, from week 1.",
    features: ["Starts at week 1 the day you join", "Every session in the app: sets, reps, loads, timer", "Daily check-in and progress charts"] },
  { id: "transformation-coaching", stream: "transformation", name: "Coaching", price: 50, interval: "week", trialDays: 0, featured: true,
    blurb: "Everything in Programming, plus me checking your progress.",
    features: ["Everything in Programming", "Video breakdowns within 24 hours", "Chat with me in the app", "Monthly check-in call"] },
  { id: "affiliate-individual", stream: "affiliate", name: "Individual", price: 25, interval: "week", trialDays: 0,
    blurb: "For your home gym or open gym sessions.",
    features: ["The Tribe class program every day", "Every session in the app: sets, reps, loads, timer", "Log scores and see the leaderboard"] },
  { id: "affiliate-gym", stream: "affiliate", name: "For gyms", price: null, interval: "month", trialDays: 0,
    blurb: "Run the Tribe class program in your gym.",
    features: ["Daily class programming, ready to write on the board", "Priced per gym - get in touch"] },
];

export const planById = (id) => PLANS.find((p) => p.id === id) || null;
export const streamById = (id) => STREAMS.find((s) => s.id === id) || null;
// A plan people can pay for straight away (has a price, and its stream is open).
export const payable = (p) => !!p && Number.isFinite(p.price) && p.price > 0 && !streamById(p.stream)?.comingSoon;
// "CrossFit Tribe Coaching": what Stripe receipts and the coach's Clients list call a plan.
export const planLabel = (p) => (p ? `${streamById(p.stream)?.name || ""} ${p.name}`.trim() : "");
