-- Tribe Coach schema: one coach, many clients.
-- The first account ever created becomes the coach. Every later sign-up is a client
-- who waits for the coach to approve them before they can see or upload anything.

create extension if not exists pgcrypto;

-- ---------- tables ----------

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'New program',
  note text not null default '',
  weeks jsonb not null default '[]'::jsonb,   -- [{days:[{id,name,dow,coachNote,exercises:[{id,name,sets,reps,target,cue,rest,note}]}]}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text not null default '',
  role text not null default 'client' check (role in ('coach', 'client')),
  approved boolean not null default false,
  goal text not null default '',
  program_id uuid references public.programs (id) on delete set null,
  start_date date,
  created_at timestamptz not null default now()
);

create table public.logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  program_id uuid references public.programs (id) on delete set null,
  week int not null,
  day_id text not null,
  date date not null,
  done boolean not null default false,
  note text not null default '',
  entries jsonb not null default '[]'::jsonb,  -- [{exId, sets:[{reps,kg,rpe,done}]}]
  updated_at timestamptz not null default now(),
  unique (client_id, program_id, week, day_id)
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  exercise text not null,
  note text not null default '',
  uploaded_at timestamptz not null default now(),
  slot date not null,                          -- the Tuesday or Thursday review it belongs to
  status text not null default 'waiting' check (status in ('waiting', 'reviewed')),
  verdict text not null default '' check (verdict in ('', 'good', 'tweak', 'refilm')),
  feedback text not null default '',
  reviewed_at timestamptz,
  storage_path text                            -- null once the file is cleaned up
);
create index videos_status_slot on public.videos (status, slot);

-- ---------- helpers ----------

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'coach');
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved);
$$;

-- New auth user -> profile. First one is the coach.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from profiles) into first_user;
  insert into profiles (id, email, name, role, approved)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''),
          case when first_user then 'coach' else 'client' end, first_user);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Clients may edit their name and goal, nothing that changes access or programming.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_coach() then
    new.role := old.role; new.approved := old.approved;
    new.program_id := old.program_id; new.start_date := old.start_date; new.email := old.email;
  end if;
  return new;
end $$;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Clients can't edit a video after sending it, or mark their own as reviewed.
create or replace function public.guard_video_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_coach() then
    new.status := 'waiting'; new.verdict := ''; new.feedback := ''; new.reviewed_at := null;
    new.client_id := auth.uid(); new.uploaded_at := now();
  end if;
  return new;
end $$;
create trigger guard_video before insert on public.videos
  for each row execute function public.guard_video_insert();

-- ---------- row level security ----------

alter table public.profiles enable row level security;
alter table public.programs enable row level security;
alter table public.logs enable row level security;
alter table public.videos enable row level security;

create policy "profiles: read own or coach" on public.profiles for select
  using (id = auth.uid() or is_coach());
create policy "profiles: update own or coach" on public.profiles for update
  using (id = auth.uid() or is_coach());
create policy "profiles: coach deletes" on public.profiles for delete
  using (is_coach());

create policy "programs: coach all" on public.programs for all
  using (is_coach()) with check (is_coach());
create policy "programs: client reads assigned" on public.programs for select
  using (is_approved() and id = (select program_id from public.profiles where id = auth.uid()));

create policy "logs: coach reads" on public.logs for select using (is_coach());
create policy "logs: client owns" on public.logs for all
  using (client_id = auth.uid() and is_approved())
  with check (client_id = auth.uid() and is_approved());

create policy "videos: coach all" on public.videos for all
  using (is_coach()) with check (is_coach());
create policy "videos: client reads own" on public.videos for select
  using (client_id = auth.uid());
create policy "videos: client sends" on public.videos for insert
  with check (client_id = auth.uid() and is_approved());

-- ---------- video storage ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 52428800, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
on conflict (id) do nothing;

-- Files live at videos/<client id>/<file>. Clients write and read their own folder; the coach reads and deletes all.
create policy "videos bucket: client uploads own" on storage.objects for insert
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved());
create policy "videos bucket: read own or coach" on storage.objects for select
  using (bucket_id = 'videos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_coach()));
create policy "videos bucket: coach deletes" on storage.objects for delete
  using (bucket_id = 'videos' and public.is_coach());
