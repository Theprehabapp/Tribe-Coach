-- Phone notifications (Web Push) for chat messages, both ways.
--
-- Nothing to paste: the coach's phone creates the notification keys the first time the coach taps
-- "Turn on notifications", and they're stored here (private key in the Vault). The app's own
-- /api/push endpoint (worker/index.js) does the sending.

alter table public.settings add column if not exists push_public_key text;

-- One row per phone/browser that turned notifications on.
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "push_subs: own" on public.push_subs;
create policy "push_subs: own" on public.push_subs for select using (user_id = auth.uid());

-- Saves this phone for the signed-in person. A phone that was signed in as someone else moves over.
create or replace function public.save_push_sub(sub_endpoint text, sub_p256dh text, sub_auth text) returns void
language sql security definer set search_path = public as $$
  insert into push_subs (endpoint, user_id, p256dh, auth) values (sub_endpoint, auth.uid(), sub_p256dh, sub_auth)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
$$;
create or replace function public.delete_push_sub(sub_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subs where endpoint = sub_endpoint and user_id = auth.uid();
$$;

-- Coach only: stores the notification keys made on the coach's phone. New keys make every saved
-- phone invalid, so those are cleared and each person turns notifications on again.
create or replace function public.set_push_keys(public_key text, private_key text) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not is_coach() then raise exception 'coach only'; end if;
  select id into sid from vault.secrets where name = 'push_private_key';
  if sid is null then perform vault.create_secret(private_key, 'push_private_key');
  else perform vault.update_secret(sid, private_key); end if;
  update settings set push_public_key = public_key where id = 1;
  delete from push_subs;
end $$;

grant execute on function public.save_push_sub(text, text, text), public.delete_push_sub(text), public.set_push_keys(text, text) to authenticated;

-- Sends a notification to every phone a person has turned it on for. Failures are swallowed so a
-- message always saves.
create or replace function public.push_to(person uuid, title text, body text, link text) returns void
language plpgsql security definer set search_path = public as $$
declare s settings; priv text; sub record;
begin
  select * into s from settings where id = 1;
  select decrypted_secret into priv from vault.decrypted_secrets where name = 'push_private_key' limit 1;
  if s.push_public_key is null or priv is null then return; end if;
  for sub in select * from push_subs where user_id = person loop
    perform net.http_post(
      url := rtrim(s.app_url, '/') || '/api/push',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'subscription', jsonb_build_object('endpoint', sub.endpoint, 'keys', jsonb_build_object('p256dh', sub.p256dh, 'auth', sub.auth)),
        'payload', jsonb_build_object('title', title, 'body', body, 'url', link),
        'vapid', jsonb_build_object('publicKey', s.push_public_key, 'privateKey', priv)
      )
    );
  end loop;
exception when others then
  raise warning 'push not sent: %', sqlerrm;
end $$;
revoke execute on function public.push_to(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.push_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; preview text; coach record;
begin
  preview := case when new.body <> '' then left(new.body, 140) else 'Sent you a video' end;
  if exists (select 1 from profiles where id = new.sender_id and role = 'coach') then
    perform push_to(new.client_id, 'Your coach', preview, '/#chat');
  else
    select coalesce(nullif(name, ''), email, 'An athlete') into who from profiles where id = new.client_id;
    for coach in select id from profiles where role = 'coach' loop
      perform push_to(coach.id, who, preview, '/#chat-' || new.client_id);
    end loop;
  end if;
  return new;
exception when others then
  raise warning 'push not sent: %', sqlerrm;
  return new;
end $$;

drop trigger if exists push_message on public.messages;
create trigger push_message after insert on public.messages
  for each row execute function public.push_new_message();
