-- Coach breakdown videos: a screen recording of the coach slowing the clip down, drawing on it and talking.
-- The file lives in the client's own folder (videos/<client id>/review-...), so the existing
-- "read own or coach" storage rule already lets the client play it back.

alter table public.videos add column if not exists review_path text;

-- Clients can't attach a breakdown to their own upload.
create or replace function public.guard_video_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_coach() then
    new.status := 'waiting'; new.verdict := ''; new.feedback := ''; new.reviewed_at := null;
    new.client_id := auth.uid(); new.uploaded_at := now(); new.review_path := null;
  end if;
  return new;
end $$;

drop policy if exists "videos bucket: coach uploads" on storage.objects;
create policy "videos bucket: coach uploads" on storage.objects for insert
  with check (bucket_id = 'videos' and public.is_coach());
