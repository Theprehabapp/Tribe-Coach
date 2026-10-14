-- Chat between the coach and each athlete, and a video library on each athlete's profile.

-- ---------- library ----------
-- theme: the coach's own grouping ("Squat depth", "Bracing"). keep: saved to the library, so the
-- 30-day clean-up leaves the file alone.
alter table public.videos add column if not exists theme text not null default '';
alter table public.videos add column if not exists keep boolean not null default false;

-- ---------- chat ----------
-- One thread per athlete (client_id). Either side can post; a message can point at a video it's
-- about, and the coach can attach a clip (a breakdown recorded from the library).
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '' check (length(body) <= 4000),
  video_id uuid references public.videos (id) on delete set null,
  clip_path text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_thread on public.messages (client_id, created_at);

-- Whoever posts is the sender, now. Athletes can only post in their own thread and can't attach clips.
create or replace function public.guard_message_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sender_id := auth.uid(); new.created_at := now(); new.read_at := null;
  if not is_coach() then new.client_id := auth.uid(); new.clip_path := null; end if;
  if new.clip_path is not null and split_part(new.clip_path, '/', 1) <> new.client_id::text then
    raise exception 'clip must be in the athlete''s folder';
  end if;
  if new.video_id is not null and not exists (select 1 from videos where id = new.video_id and client_id = new.client_id) then
    new.video_id := null;
  end if;
  return new;
end $$;
drop trigger if exists guard_message on public.messages;
create trigger guard_message before insert on public.messages
  for each row execute function public.guard_message_insert();

alter table public.messages enable row level security;
drop policy if exists "messages: coach all" on public.messages;
create policy "messages: coach all" on public.messages for select using (is_coach());
drop policy if exists "messages: client reads own" on public.messages;
create policy "messages: client reads own" on public.messages for select using (client_id = auth.uid());
drop policy if exists "messages: send" on public.messages;
create policy "messages: send" on public.messages for insert
  with check (is_coach() or (client_id = auth.uid() and is_approved()));
drop policy if exists "messages: coach deletes" on public.messages;
create policy "messages: coach deletes" on public.messages for delete using (is_coach());

-- Marks the other side's messages in a thread as read. The only way read_at changes.
create or replace function public.mark_read(thread uuid) returns void
language sql security definer set search_path = public as $$
  update messages set read_at = now()
  where client_id = thread and read_at is null and sender_id <> auth.uid()
    and (is_coach() or thread = auth.uid());
$$;
grant execute on function public.mark_read(uuid) to authenticated;

-- Live updates in the app. Supabase creates this publication; skip quietly anywhere it doesn't exist.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ---------- email on a new message ----------
-- Same Resend setup as the new-video email. To avoid an email per line of a quick back-and-forth,
-- it only emails when the recipient has nothing unread from the sender in the last 30 minutes.
create or replace function public.alert_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  to_email text; who text; key text; s settings; from_coach boolean;
begin
  from_coach := exists (select 1 from profiles where id = new.sender_id and role = 'coach');
  if exists (select 1 from messages where client_id = new.client_id and sender_id = new.sender_id and id <> new.id
             and read_at is null and created_at > now() - interval '30 minutes') then
    return new;
  end if;
  if from_coach then
    select email into to_email from profiles where id = new.client_id;
    who := 'Your coach';
  else
    select email into to_email from profiles where role = 'coach' order by created_at limit 1;
    select coalesce(nullif(name, ''), email, 'An athlete') into who from profiles where id = new.client_id;
  end if;
  select * into s from settings where id = 1;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if to_email is null or key is null then return new; end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', s.alert_from,
      'to', jsonb_build_array(to_email),
      'subject', who || ' sent you a message',
      'text', case when new.body <> '' then '"' || left(new.body, 500) || '"' else who || ' sent you a video.' end
        || E'\n\nReply in the app: ' || s.app_url
    )
  );
  return new;
exception when others then
  raise warning 'message alert not sent: %', sqlerrm;
  return new;
end $$;

drop trigger if exists alert_message on public.messages;
create trigger alert_message after insert on public.messages
  for each row execute function public.alert_new_message();
