-- Tells the athlete when their feedback is ready: an email (same Resend setup as the other alerts)
-- and a phone notification if they've turned notifications on (0005). Sent once, when a video
-- first goes from waiting to reviewed; editing feedback afterwards doesn't send it again.

create or replace function public.alert_feedback_ready() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  to_email text; key text; s settings; verdict text; clips int;
begin
  verdict := case new.verdict when 'good' then 'Good to go' when 'tweak' then 'Small fix' when 'refilm' then 'Re-film it' else '' end;
  clips := (case when new.review_path is not null then 1 else 0 end) + coalesce(jsonb_array_length(new.clips), 0);

  begin
    perform push_to(new.client_id, 'Your coach',
      'Feedback on your ' || new.exercise || ' is ready' || case when verdict <> '' then ': ' || verdict else '' end, '/#videos');
  exception when others then
    raise warning 'feedback push not sent: %', sqlerrm;
  end;

  select email into to_email from profiles where id = new.client_id;
  select * into s from settings where id = 1;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if to_email is null or key is null then return new; end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', s.alert_from,
      'to', jsonb_build_array(to_email),
      'subject', 'Your ' || new.exercise || ' feedback is ready',
      'text', 'Your coach has reviewed your ' || new.exercise || ' video.'
        || case when verdict <> '' then E'\n\nVerdict: ' || verdict else '' end
        || case when new.feedback <> '' then E'\n\n"' || left(new.feedback, 500) || '"' else '' end
        || case when clips = 1 then E'\n\nThere''s a video breakdown to watch, sound on.'
                when clips > 1 then E'\n\nThere are ' || clips || ' video breakdowns to watch, sound on.' else '' end
        || E'\n\nSee it in the app: ' || rtrim(s.app_url, '/') || '/#videos'
    )
  );
  return new;
exception when others then
  raise warning 'feedback alert not sent: %', sqlerrm;
  return new;
end $$;

drop trigger if exists alert_feedback on public.videos;
create trigger alert_feedback after update of status on public.videos
  for each row when (old.status is distinct from 'reviewed' and new.status = 'reviewed')
  execute function public.alert_feedback_ready();
