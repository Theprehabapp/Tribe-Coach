-- Chat and library check. Run after stub.sql and migrations 0001-0004 on a scratch Postgres
-- ("create extension pg_net" in 0003 errors on plain Postgres; that's expected). Stubs pg_net and Vault.
\set ON_ERROR_STOP 0
create schema if not exists net;
create table if not exists net.sent (url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, body jsonb, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language sql as $$ insert into net.sent values (url, headers, body); select 1::bigint $$;
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('resend_api_key', 're_test');
grant usage on schema net, vault to authenticated;
grant all on all tables in schema public, storage to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000b2','b@x','{"name":"Ben"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c'; update profiles set approved = true;
insert into videos (id, client_id, exercise, slot) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Squat', '2026-10-14');
insert into videos (id, client_id, exercise, slot) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b2', 'Bench', '2026-10-14');

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy posts in Ben''s thread, as Ben, with a clip: lands in her own thread, sender Amy, no clip'
insert into messages (client_id, sender_id, body, clip_path, video_id)
values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'Thanks!', 'x/y.mp4', '00000000-0000-0000-0000-0000000000f1')
returning client_id = auth.uid() as own_thread, sender_id = auth.uid() as sender_is_amy, clip_path, video_id is not null as has_video;
\echo '--- Amy pointing at Ben''s video: video_id dropped (expect f)'
insert into messages (body, video_id) values ('hm', '00000000-0000-0000-0000-0000000000f2') returning video_id is not null as has_video;
\echo '--- Second message within 30 min: still only one email to the coach (expect 1, to coach@x)'
reset role; select count(*) as sent, min(body->'to'->>0) as to_addr, min(body->>'subject') as subject from net.sent where body->>'subject' like '%message'; set role authenticated;
\echo '--- Amy cannot change her video''s library fields (expect 0 rows)'
update videos set keep = true, theme = 'x' returning id;

set request.jwt.uid = '00000000-0000-0000-0000-0000000000b2';
\echo '--- Ben sees none of Amy''s messages (expect 0)'
select count(*) from messages;
\echo '--- Ben cannot mark Amy''s thread read'
select mark_read('00000000-0000-0000-0000-0000000000a1');
reset role; select count(*) filter (where read_at is not null) as read from messages; set role authenticated;

set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
\echo '--- Coach sees Amy''s 2 messages, reads them, replies with a clip in her folder; email goes to Amy'
select count(*) from messages where client_id = '00000000-0000-0000-0000-0000000000a1';
select mark_read('00000000-0000-0000-0000-0000000000a1');
insert into messages (client_id, body, clip_path) values ('00000000-0000-0000-0000-0000000000a1', 'Watch this', '00000000-0000-0000-0000-0000000000a1/chat-1.mp4') returning clip_path is not null as has_clip;
reset role; select count(*) filter (where read_at is not null) as read_now, (select body->'to'->>0 from net.sent order by ctid desc limit 1) as last_email_to from messages; set role authenticated;
\echo '--- Coach clip pointing into Ben''s folder on Amy''s thread (expect error)'
insert into messages (client_id, body, clip_path) values ('00000000-0000-0000-0000-0000000000a1', 'x', '00000000-0000-0000-0000-0000000000b2/chat-2.mp4');
\echo '--- Coach saves Amy''s video to the library with a theme (expect t, Bracing)'
update videos set keep = true, theme = 'Bracing' where id = '00000000-0000-0000-0000-0000000000f1' returning keep, theme;

set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- Amy marks read: only the coach''s message (expect 3 read, Amy cannot mark her own)'
select mark_read(auth.uid());
reset role; select count(*) filter (where read_at is not null) as read from messages;
