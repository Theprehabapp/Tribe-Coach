# Tribe Coach

A phone web app for Tribe HQ coaching. The coach builds programs, clients log their sessions, and clients drop technique videos into a queue that the coach reviews on Tuesdays and Thursdays.

- **Coach:** review queue with a 24-hour countdown on each video, reviewed one at a time with **Send and next video**, a breakdown tool (slow motion, frame stepping, drawing lines, circles and joint angles, side-by-side compare, recorded with your voice), program builder in Tribe notation, client roster with approvals.
- **Client:** this week's sessions with set-by-set logging (reps, kg, RPE), video upload, feedback history including the coach's breakdown videos.
- **24-hour feedback:** clients can send a video any day and are promised feedback within 24 hours. The coach gets an email for each new video, and the queue shows the oldest first with the time left (`FEEDBACK_HOURS` in `src/schedule.js`).

Built with plain JavaScript and Vite. Supabase handles sign-in (email and password), the database and video storage.

## Set up

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). Pick the Sydney region.
2. Open **SQL Editor** and run each file in `supabase/migrations/` in order (`0001_init.sql` to `0005_push.sql`). This creates the tables, the access rules and the private `videos` storage bucket (50 MB per file).
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

The sender and the app link in the email are in the `settings` table (`alert_from`, `app_url`). Its `review_days` column is no longer used. If the key is missing or Resend is down, the upload still goes through, just without the email.

## Reviewing

**Start reviewing** on the queue opens the oldest video. Pick a verdict, add notes and tap **Send and next video**; the next one is already downloading while you work. **Skip for now** leaves a video in the queue.

**Breakdowns:** tap **Record breakdown**, then play, slow down (½x, ¼x), step frame by frame, scrub and draw while you talk. The screen and your voice are saved as one video (up to 3 minutes) in the client's folder, and they watch it under their feedback. It needs a recent Safari or Chrome and microphone access.

**Compare** puts a second clip beside the one you're reviewing: one of the athlete's earlier videos (same exercise first) or one of your reference reps. Pick **Left** or **Right** to line the reps up, then **Both** to play and step them together. Reference reps are stored in your own folder in the `videos` bucket as `ref-<name>--<id>.mp4`; add and delete them from the compare panel.

## Chat and library

Each athlete has a **Chat** with you: on your side under Clients, then their name; on theirs, the **Coach** tab. They can tap **Ask your coach about this** on a reviewed video to start a message about it. Messages show up live, unread counts appear on the tabs, and the other person gets an email (through the same Resend key as the new-video email) unless they already have an unread message from you in the last 30 minutes.

Each athlete's **Library** lists all their videos grouped by movement or by your own themes. Open one to slow it down, draw on it or compare it, and a breakdown you record there is sent to their chat. Giving a video a theme (or tapping Save) keeps it: the 30-day clean-up skips saved videos.

Run `supabase/migrations/0004_chat_and_library.sql` in the SQL Editor to switch these on. Until then the app works as before and the chat shows a note.

## Phone notifications

A new chat message also sends a phone notification to the other person, if they've switched it on with **Turn on notifications** in the chat. Tapping the notification opens that chat.

- Run `supabase/migrations/0005_push.sql` in the SQL Editor first.
- The coach turns it on first. That tap creates the notification keys on the coach's phone and stores the private one in the Supabase Vault; athletes can turn it on after that. Turning it on again on a new phone reuses the same keys.
- iPhone (iOS 16.4 or later) only allows notifications for apps opened from the Home Screen: in Safari tap **Share**, **Add to Home Screen**, then open Tribe from the Home Screen icon. The app explains this when it's opened in Safari. Android and computers work straight from the browser.
- Sending goes through this app's own `/api/push` endpoint (`worker/push.js`, Web Push with VAPID), so there's no extra service or key to sign up for.

## Video size

Videos are shrunk on the uploader's phone before they're sent: 720p, about 2.5 Mbps, a key frame every second, and the index at the front of the file so playback starts straight away. That's roughly 20 MB a minute instead of 100+ MB. It uses the browser's built-in encoder (WebCodecs, `src/shrink.js`); if a phone can't do it, the original is sent as before and the 50 MB limit applies.

## Storage

Video files are the only thing that grows. The coach view has a **Clear video files reviewed 30+ days ago** button. It deletes the client videos and breakdown recordings and keeps the written feedback.

## Tests

```sh
npm test                       # review-day and program maths, push encryption
npx vite build --mode fake     # UI build against an in-memory backend, for offline smoke tests
```
