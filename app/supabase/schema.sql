-- Anyflow database on Supabase. Applied with scripts/db.mjs; safe to run again.
-- Every table has row level security: the app's public key can only do what these policies allow,
-- whatever a modified client sends.

-- ---------------------------------------------------------------------------------------------
-- profiles: one per account, made by a trigger when the account is created

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9._-]{3,24}$'),
  display_name text check (char_length(display_name) <= 40),
  avatar_url text check (char_length(avatar_url) <= 500),
  banner_url text check (char_length(banner_url) <= 500),
  bio text check (char_length(bio) <= 500),
  accent text check (accent ~ '^#[0-9a-fA-F]{6}$'),
  favorites int[] not null default '{}' check (cardinality(favorites) <= 12),
  public boolean not null default true,
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  banned_until timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('moderator', 'admin'))
$$;

create or replace function public.can_post() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and (banned_until is null or banned_until < now()))
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  name text := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
begin
  name := regexp_replace(name, '[^a-z0-9._-]', '', 'g');
  if char_length(name) < 3 then name := 'user' || substr(new.id::text, 1, 8); end if;
  name := left(name, 24);
  if exists (select 1 from profiles where username = name) then name := left(name, 18) || substr(new.id::text, 1, 6); end if;
  insert into profiles (id, username) values (new.id, name);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (public or id = auth.uid() or public.is_staff());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- role and bans are not the user's to change: only staff, through the moderation functions
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.banned_until is distinct from old.banned_until or new.username is distinct from old.username)
     and coalesce(current_setting('anyflow.staff', true), '') <> 'on' then
    new.role := old.role;
    new.banned_until := old.banned_until;
    new.username := old.username;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles for each row execute function public.protect_profile();

-- ---------------------------------------------------------------------------------------------
-- private data synced between the user's devices: progress, list entries, manga, settings

create table if not exists public.user_docs (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  kind text not null check (kind in ('progress', 'title', 'manga', 'prefs')),
  key text not null check (char_length(key) <= 200),
  data jsonb not null check (pg_column_size(data) <= 65536),
  updated_at bigint not null,
  primary key (user_id, kind, key)
);
alter table public.user_docs enable row level security;
drop policy if exists "own docs" on public.user_docs;
create policy "own docs" on public.user_docs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.watch_stats (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  seconds integer not null default 0 check (seconds >= 0),
  primary key (user_id, day)
);
alter table public.watch_stats enable row level security;
drop policy if exists "own stats" on public.watch_stats;
create policy "own stats" on public.watch_stats for select using (user_id = auth.uid());

-- adds watched seconds per day; at most a day's worth per call so nobody inflates their stats
create or replace function public.add_watch_time(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v numeric;
begin
  if auth.uid() is null then return; end if;
  for k, v in select key, value::numeric from jsonb_each_text(p) loop
    if k ~ '^\d{4}-\d{2}-\d{2}$' and v > 0 then
      insert into watch_stats (user_id, day, seconds) values (auth.uid(), k, least(v, 86400)::int)
      on conflict (user_id, day) do update set seconds = least(watch_stats.seconds + excluded.seconds, 86400);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- ratings: 1..10 per anime (Shikimori / MAL id), the average is public

create table if not exists public.ratings (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  anime_id integer not null check (anime_id > 0),
  score smallint not null check (score between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, anime_id)
);
create index if not exists ratings_anime on public.ratings (anime_id);
alter table public.ratings enable row level security;
drop policy if exists "ratings read" on public.ratings;
create policy "ratings read" on public.ratings for select using (true);
drop policy if exists "ratings write own" on public.ratings;
create policy "ratings write own" on public.ratings for insert with check (user_id = auth.uid() and public.can_post());
drop policy if exists "ratings update own" on public.ratings;
create policy "ratings update own" on public.ratings for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "ratings delete own" on public.ratings;
create policy "ratings delete own" on public.ratings for delete using (user_id = auth.uid());

create or replace view public.anime_scores with (security_invoker = on) as
  select anime_id, round(avg(score)::numeric, 2) as average, count(*)::int as votes from public.ratings group by anime_id;

-- ---------------------------------------------------------------------------------------------
-- comments under a title, with replies, likes, spoilers and reports

create table if not exists public.comments (
  id bigint generated always as identity primary key,
  anime_id integer not null check (anime_id > 0),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  parent_id bigint references public.comments on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  spoiler boolean not null default false,
  likes integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists comments_anime on public.comments (anime_id, created_at desc);
create index if not exists comments_user on public.comments (user_id, created_at desc);
alter table public.comments enable row level security;
drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select using (not hidden or user_id = auth.uid() or public.is_staff());
drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments for insert with check (user_id = auth.uid() and public.can_post());
drop policy if exists "comments edit own" on public.comments;
create policy "comments edit own" on public.comments for update using (user_id = auth.uid() or public.is_staff());
drop policy if exists "comments delete" on public.comments;
create policy "comments delete" on public.comments for delete using (user_id = auth.uid() or public.is_staff());

-- spam guard and the fields a client may not touch
create or replace function public.comment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from comments where user_id = new.user_id and created_at > now() - interval '1 minute') >= 5 then
      raise exception 'Слишком часто: подождите минуту' using errcode = 'P0001';
    end if;
    if (select count(*) from comments where user_id = new.user_id and created_at > now() - interval '1 day') >= 200 then
      raise exception 'Лимит комментариев на сегодня исчерпан' using errcode = 'P0001';
    end if;
    -- links are where spam lives
    if new.body ~* '(https?://|www\.|t\.me/|discord\.gg)' and not public.is_staff() then
      raise exception 'Ссылки в комментариях запрещены' using errcode = 'P0001';
    end if;
    new.likes := 0;
    new.hidden := false;
    new.created_at := now();
    new.edited_at := null;
  elsif coalesce(current_setting('anyflow.system', true), '') = 'on' then
    -- likes and auto-hiding: the database's own updates pass as they are
    return new;
  else
    new.anime_id := old.anime_id;
    new.user_id := old.user_id;
    new.parent_id := old.parent_id;
    new.created_at := old.created_at;
    new.likes := old.likes;
    if not public.is_staff() then new.hidden := old.hidden; end if;
    if new.body is distinct from old.body then new.edited_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists comment_guard on public.comments;
create trigger comment_guard before insert or update on public.comments for each row execute function public.comment_guard();

create table if not exists public.comment_likes (
  comment_id bigint not null references public.comments on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  primary key (comment_id, user_id)
);
alter table public.comment_likes enable row level security;
drop policy if exists "likes read own" on public.comment_likes;
create policy "likes read own" on public.comment_likes for select using (user_id = auth.uid());
drop policy if exists "likes add" on public.comment_likes;
create policy "likes add" on public.comment_likes for insert with check (user_id = auth.uid() and public.can_post());
drop policy if exists "likes remove" on public.comment_likes;
create policy "likes remove" on public.comment_likes for delete using (user_id = auth.uid());

create or replace function public.count_likes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('anyflow.system', 'on', true);
  if tg_op = 'INSERT' then update comments set likes = likes + 1 where id = new.comment_id;
  else update comments set likes = greatest(likes - 1, 0) where id = old.comment_id; end if;
  return null;
end $$;
drop trigger if exists count_likes on public.comment_likes;
create trigger count_likes after insert or delete on public.comment_likes for each row execute function public.count_likes();

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  comment_id bigint not null references public.comments on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  reason text not null check (char_length(reason) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);
alter table public.reports enable row level security;
drop policy if exists "report" on public.reports;
create policy "report" on public.reports for insert with check (user_id = auth.uid());
drop policy if exists "reports for staff" on public.reports;
create policy "reports for staff" on public.reports for select using (public.is_staff());
drop policy if exists "reports cleared by staff" on public.reports;
create policy "reports cleared by staff" on public.reports for delete using (public.is_staff());

-- a comment three people reported hides itself until a moderator looks at it
create or replace function public.auto_hide() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from reports where comment_id = new.comment_id) >= 3 then
    perform set_config('anyflow.system', 'on', true);
    update comments set hidden = true where id = new.comment_id;
  end if;
  return null;
end $$;
drop trigger if exists auto_hide on public.reports;
create trigger auto_hide after insert on public.reports for each row execute function public.auto_hide();

-- moderation: ban for some days (0 lifts the ban)
create or replace function public.ban_user(target uuid, days integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Нет прав'; end if;
  perform set_config('anyflow.staff', 'on', true);
  update profiles set banned_until = case when days > 0 then now() + make_interval(days => days) else null end where id = target;
end $$;

-- the account and everything in it, at the user's own request
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Не выполнен вход'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------------------------
-- watch together: a room per code, events are reactions and chat

create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  data jsonb not null check (pg_column_size(data) <= 32768),
  host uuid not null references auth.users on delete cascade default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
-- the code is the invitation: whoever knows it may read and drive the room
drop policy if exists "rooms read" on public.rooms;
create policy "rooms read" on public.rooms for select using (auth.uid() is not null);
drop policy if exists "rooms create" on public.rooms;
create policy "rooms create" on public.rooms for insert with check (host = auth.uid());
drop policy if exists "rooms update" on public.rooms;
create policy "rooms update" on public.rooms for update using (auth.uid() is not null);
drop policy if exists "rooms delete" on public.rooms;
create policy "rooms delete" on public.rooms for delete using (host = auth.uid());

create table if not exists public.room_events (
  id bigint generated always as identity primary key,
  code text not null references public.rooms on delete cascade,
  kind text not null check (kind in ('emoji', 'chat')),
  text text not null check (char_length(text) between 1 and 300),
  name text not null check (char_length(name) <= 40),
  uid uuid not null default auth.uid(),
  at bigint not null
);
create index if not exists room_events_code on public.room_events (code, id desc);
alter table public.room_events enable row level security;
drop policy if exists "events read" on public.room_events;
create policy "events read" on public.room_events for select using (auth.uid() is not null);
drop policy if exists "events add" on public.room_events;
create policy "events add" on public.room_events for insert with check (uid = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- live updates for the tables the app listens to

do $$
declare t text;
begin
  foreach t in array array['user_docs', 'rooms', 'room_events', 'comments'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- registration by nickname: Supabase refuses the placeholder addresses nicknames sign in with
-- (no mail server behind them), so the account is made here. Passwords are bcrypt-hashed like
-- Supabase's own; a global throttle keeps bots from mass-creating accounts.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.signup_log (at timestamptz not null default now());
alter table public.signup_log enable row level security;

create or replace function public.register(login text, password text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  nick text := lower(btrim(login));
  mail text;
  uid uuid := gen_random_uuid();
begin
  if nick !~ '^[a-z0-9._-]{3,24}$' then raise exception 'bad-username' using errcode = 'P0001'; end if;
  if char_length(password) < 6 or char_length(password) > 72 then raise exception 'weak-password' using errcode = 'P0001'; end if;
  mail := nick || '@users.aniplayer.app';
  if exists (select 1 from auth.users where email = mail) or exists (select 1 from profiles where username = nick) then
    raise exception 'username-taken' using errcode = 'P0001';
  end if;
  if (select count(*) from signup_log where at > now() - interval '1 minute') >= 20 then
    raise exception 'too-many' using errcode = 'P0001';
  end if;
  insert into signup_log default values;
  delete from signup_log where at < now() - interval '1 hour';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
    crypt(password, gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('username', nick), now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true), 'email', now(), now(), now());
end $$;
revoke all on function public.register(text, text) from public;
grant execute on function public.register(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- avatars and banners: public pictures, each account writes only into its own folder (<uid>/...)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, '{image/png,image/jpeg,image/webp,image/gif}')
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = '{image/png,image/jpeg,image/webp,image/gif}';

drop policy if exists "avatars read" on storage.objects;
create policy "avatars read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars upload own" on storage.objects;
create policy "avatars upload own" on storage.objects for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars replace own" on storage.objects;
create policy "avatars replace own" on storage.objects for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- what a profile page shows about watching, without opening anyone's private rows
create or replace function public.profile_stats(target uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from profiles where id = target and (public or id = auth.uid())) then null else jsonb_build_object(
    'seconds', coalesce((select sum(seconds) from watch_stats where user_id = target), 0),
    'episodes', (select count(*) from user_docs where user_id = target and kind = 'progress' and (data ->> 'watched')::boolean),
    'completed', (select count(*) from user_docs where user_id = target and kind = 'title' and data ->> 'status' = 'completed'),
    'watching', (select count(*) from user_docs where user_id = target and kind = 'title' and data ->> 'status' = 'watching'),
    'comments', (select count(*) from comments where user_id = target and not hidden),
    'ratings', (select count(*) from ratings where user_id = target)
  ) end
$$;
