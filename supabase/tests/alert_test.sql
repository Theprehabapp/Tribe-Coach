-- New-video alert and review-mode check. Run after stub.sql and migrations 0001-0003 on a scratch
-- Postgres; this file stubs Supabase's pg_net and Vault first. ("create extension pg_net" in 0003
-- errors on plain Postgres; that's expected.)
\set ON_ERROR_STOP 0
create schema if not exists net;
create table net.sent (url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, body jsonb, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language sql as $$ insert into net.sent values (url, headers, body); select 1::bigint $$;
create schema if not exists vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
grant usage on schema net, vault to authenticated;
grant all on all tables in schema public, storage to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-00000000000c','coach@x','{"name":"Coach"}');
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x','{"name":"Amy"}');
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update profiles set approved = true;

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-0000000000a1';
\echo '--- No key stored yet: upload still works, no email (expect 1 row, then 0 sent)'
insert into videos (client_id, exercise, slot) values (auth.uid(), 'Squat', '2026-10-11') returning exercise;
reset role; select count(*) as sent from net.sent;

insert into vault.decrypted_secrets values ('resend_api_key', 're_test');
set role authenticated;
\echo '--- With key: upload sends one email to the coach'
insert into videos (client_id, exercise, slot, note) values (auth.uid(), 'Deadlift', '2026-10-11', 'Back ok?') returning exercise;
reset role;
select body->'to' as to, body->>'subject' as subject, body->>'text' as text, headers->>'Authorization' as auth from net.sent;

\echo '--- Alert failure never blocks the upload (expect 1 row)'
drop function net.http_post(text, jsonb, jsonb, jsonb, int);
set role authenticated;
insert into videos (client_id, exercise, slot) values (auth.uid(), 'Bench', '2026-10-11') returning exercise;

\echo '--- Settings: client reads, cannot change; coach can (expect f, 0 rows, t)'
select review_days from settings;
update settings set review_days = true returning review_days;
set request.jwt.uid = '00000000-0000-0000-0000-00000000000c';
update settings set review_days = true returning review_days;
