-- When a video was actually filmed, set by the coach when comparing reps. Empty means the upload day.
alter table public.videos add column if not exists filmed_on date;
