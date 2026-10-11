-- Review schedule switch, and an email to the coach whenever a client sends a video.
--
-- Before running: store your Resend API key (the same re_... key used for sign-in emails) in the
-- Vault by running this once on its own, with your key in place of the placeholder:
--   select vault.create_secret('re_your_key_here', 'resend_api_key');

-- ---------- settings (one row) ----------

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  review_days boolean not null default false,   -- false: review any time. true: batch for Tuesday and Thursday.
  alert_from text not null default 'Tribe Coach <coach@tribeheadquarters.com.au>',
  app_url text not null default 'https://tribe-coach.alessio1angelucci.workers.dev'
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

alter table public.settings enable row level security;
drop policy if exists "settings: signed in reads" on public.settings;
create policy "settings: signed in reads" on public.settings for select using (auth.uid() is not null);
drop policy if exists "settings: coach updates" on public.settings;
create policy "settings: coach updates" on public.settings for update using (is_coach()) with check (is_coach());

-- ---------- new video alert ----------

create extension if not exists pg_net with schema extensions;

-- Sends through Resend's API. Runs after the upload is saved; pg_net sends the request in the
-- background, and any failure here is swallowed so it can never block a client's upload.
create or replace function public.alert_coach_new_video() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  coach_email text; who text; key text; s settings;
begin
  select email into coach_email from profiles where role = 'coach' order by created_at limit 1;
  select coalesce(nullif(name, ''), email, 'A client') into who from profiles where id = new.client_id;
  select * into s from settings where id = 1;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if coach_email is null or key is null then return new; end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', s.alert_from,
      'to', jsonb_build_array(coach_email),
      'subject', 'New video from ' || who || ': ' || new.exercise,
      'text', who || ' sent a ' || new.exercise || ' video for review.'
        || case when new.note <> '' then E'\n\nTheir note: "' || new.note || '"' else '' end
        || E'\n\nReview it: ' || s.app_url
    )
  );
  return new;
exception when others then
  raise warning 'new video alert not sent: %', sqlerrm;
  return new;
end $$;

drop trigger if exists alert_coach on public.videos;
create trigger alert_coach after insert on public.videos
  for each row execute function public.alert_coach_new_video();
