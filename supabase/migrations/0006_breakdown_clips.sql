-- Several breakdown clips per video, each with a label ("Bar path", "Bracing"), sent together.
-- clips: [{path, label}] in recording order. Files live in the client's folder like review_path,
-- so the existing storage rules already let the client play them back. review_path stays for
-- breakdowns saved before this update.

alter table public.videos add column if not exists clips jsonb not null default '[]'::jsonb;

-- Clients can't attach breakdowns to their own upload.
create or replace function public.guard_video_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_coach() then
    new.status := 'waiting'; new.verdict := ''; new.feedback := ''; new.reviewed_at := null;
    new.client_id := auth.uid(); new.uploaded_at := now(); new.review_path := null; new.clips := '[]'::jsonb;
  end if;
  return new;
end $$;
