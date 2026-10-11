# Tribe Coach

A phone web app for Tribe HQ coaching. The coach builds programs, clients log their sessions, and clients drop technique videos into a queue that the coach reviews on Tuesdays and Thursdays.

- **Coach:** review queue (batched by review day), a breakdown tool for each video (slow motion, frame stepping, drawing lines, circles and joint angles, recorded with your voice), program builder in Tribe notation, client roster with approvals.
- **Client:** this week's sessions with set-by-set logging (reps, kg, RPE), video upload, feedback history including the coach's breakdown videos.
- **Review schedule:** the coach picks it at the bottom of the Review tab. **Any time** (default): videos are reviewed as they arrive and the coach gets an email for each one. **Tuesdays & Thursdays**: a video joins the batch for the day it's uploaded if that's a Tuesday or Thursday, otherwise the next one (`src/schedule.js`).

Built with plain JavaScript and Vite. Supabase handles sign-in (email and password), the database and video storage.

## Set up

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). Pick the Sydney region.
2. Open **SQL Editor** and run each file in `supabase/migrations/` in order (`0001_init.sql`, `0002_breakdowns.sql`, `0003_review_mode_and_alerts.sql`). This creates the tables, the access rules and the private `videos` storage bucket (50 MB per file).
3. Go to **Authentication > URL Configuration**. Set **Site URL** to wherever the app is hosted (step 3 below) and add the same address under **Redirect URLs**.
4. Copy the **Project URL** and the **anon public** key from **Project Settings > API**. Never put the `service_role` key in this app.

### 2. Run locally

```sh
cp .env.example .env.local   # then fill in the two values
npm install
npm run dev
```

### 3. Host it

Any static host works. Build command `npm run build`, output folder `dist`. The live project's URL and anon key are in `.env.production`, so no environment variables are needed. The anon key is public by design: what each person can do is enforced by the database rules below. Cloudflare and Netlify can both deploy straight from this GitHub repo.

On Cloudflare (Workers & Pages > Create > import the repo): build command `npm run build`, deploy command `npx wrangler deploy`. `wrangler.jsonc` tells it to serve `dist`.

### 4. First sign-in

**The first account created becomes the coach.** Create yours before sending the link to anyone. New accounts get one email to confirm the address (Supabase's "Confirm email" setting); after that it's email and password. **Forgot password?** on the sign-in screen sends a reset link, and **Change password** at the bottom of the app sets a new one. After that, every sign-up is a client who waits in **Clients > Waiting for approval** until you approve them.

To make a different account the coach later, run this in the SQL Editor:

```sql
update profiles set role = 'coach', approved = true where email = 'you@example.com';
```

## Who can see what

Access is enforced in the database (row level security), not just hidden in the app:

| | Coach | Approved client | Unapproved client |
|---|---|---|---|
| Programs | all, edit | only their assigned one | none |
| Session logs | read all | read and write their own | none |
| Videos | all, review, record breakdowns, delete | upload and read their own, watch their breakdowns | none |
| Profiles | all, approve, assign | own name and goal | own |

Clients can't mark their own videos as reviewed, change their program, or approve themselves. `supabase/tests/` has scripts that check these rules against a plain Postgres database.

## New video emails

`0003_review_mode_and_alerts.sql` emails the coach through [Resend](https://resend.com) whenever a client sends a video. It reads the Resend API key from the Supabase Vault, so store it once in the SQL Editor (never in this repo):

```sql
select vault.create_secret('re_your_key_here', 'resend_api_key');
```

The sender and the app link in the email are in the `settings` table (`alert_from`, `app_url`). If the key is missing or Resend is down, the upload still goes through, just without the email.

## Breakdowns

On a review card, **Break it down** opens the clip full size. Tap **Record breakdown**, then play, slow down (½x, ¼x), step frame by frame, scrub and draw while you talk. The screen and your voice are saved as one video (up to 3 minutes) in the client's folder, and they watch it under their feedback. It needs a recent Safari or Chrome and microphone access.

## Storage

Video files are the only thing that grows. The coach view has a **Clear video files reviewed 30+ days ago** button. It deletes the client videos and breakdown recordings and keeps the written feedback.

## Tests

```sh
npm test                       # review-day and program maths
npx vite build --mode fake     # UI build against an in-memory backend, for offline smoke tests
```
