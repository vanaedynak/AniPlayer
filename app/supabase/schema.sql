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

-- looks: a status line, an avatar frame, how the name is drawn, a banner gradient when there is no picture,
-- and links to the user's other pages (their own profile, so links are allowed here, unlike in comments)
alter table public.profiles add column if not exists status text check (char_length(status) <= 80);
alter table public.profiles add column if not exists frame text not null default 'none'
  check (frame in ('none', 'accent', 'gradient', 'glow', 'gold', 'neon', 'rainbow', 'sakura', 'ice', 'fire'));
alter table public.profiles add column if not exists name_style text not null default 'plain'
  check (name_style in ('plain', 'gradient', 'glow', 'rainbow'));
alter table public.profiles add column if not exists banner_style text not null default 'accent'
  check (banner_style in ('accent', 'sunset', 'ocean', 'aurora', 'sakura', 'night', 'fire', 'mint', 'cyber', 'gold'));
alter table public.profiles add column if not exists links jsonb not null default '{}'
  check (jsonb_typeof(links) = 'object' and pg_column_size(links) <= 1024);

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
  kind text not null,
  key text not null check (char_length(key) <= 200),
  data jsonb not null check (pg_column_size(data) <= 65536),
  updated_at bigint not null,
  primary key (user_id, kind, key)
);
-- 'episodes' is one row per title holding every episode's position ({ordinal: [time, duration, watched, updatedAt]}):
-- a row costs ~100 bytes before its data, so a row per episode ('progress', what 1.0.34 and older write) is 4x bigger
alter table public.user_docs drop constraint if exists user_docs_kind_check;
alter table public.user_docs add constraint user_docs_kind_check check (kind in ('progress', 'episodes', 'title', 'manga', 'prefs'));
-- room on each page for the frequent position updates to happen in place
alter table public.user_docs set (fillfactor = 90);
alter table public.user_docs enable row level security;
drop policy if exists "own docs" on public.user_docs;
create policy "own docs" on public.user_docs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- merges episode positions into the title's row, each episode keeping whichever side changed it last
create or replace function public.put_episodes(p jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare k text; v jsonb;
begin
  if auth.uid() is null or jsonb_typeof(p) <> 'object' then return; end if;
  for k, v in select key, value from jsonb_each(p) loop
    continue when jsonb_typeof(v) <> 'object' or v = '{}';
    insert into user_docs as u (user_id, kind, key, data, updated_at)
    values (auth.uid(), 'episodes', k, v, (select coalesce(max((e.value ->> 3)::bigint), 0) from jsonb_each(v) e))
    on conflict (user_id, kind, key) do update set
      data = u.data || (select coalesce(jsonb_object_agg(n.key, n.value), '{}') from jsonb_each(excluded.data) n
                        where not (u.data ? n.key) or (n.value ->> 3)::bigint >= (u.data -> n.key ->> 3)::bigint),
      updated_at = greatest(u.updated_at, excluded.updated_at);
  end loop;
end $$;

-- one-time move of the per-episode rows into per-title rows (the client also moves any an old version writes later)
do $$
begin
  if exists (select 1 from public.user_docs where kind = 'progress') then
    insert into public.user_docs as u (user_id, kind, key, data, updated_at)
    select user_id, 'episodes', data ->> 'releaseId',
      jsonb_object_agg(data ->> 'ordinal', jsonb_build_array(round((data ->> 'time')::numeric), round((data ->> 'duration')::numeric),
        case when (data ->> 'watched')::boolean then 1 else 0 end, updated_at)),
      max(updated_at)
    from public.user_docs where kind = 'progress' and data ? 'releaseId' and data ? 'ordinal'
    group by user_id, data ->> 'releaseId'
    on conflict (user_id, kind, key) do update set data = excluded.data || u.data, updated_at = greatest(u.updated_at, excluded.updated_at);
    delete from public.user_docs where kind = 'progress';
  end if;
end $$;

create table if not exists public.watch_stats (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  seconds integer not null default 0 check (seconds >= 0),
  primary key (user_id, day)
);
alter table public.watch_stats enable row level security;
drop policy if exists "own stats" on public.watch_stats;
create policy "own stats" on public.watch_stats for select using (user_id = auth.uid());

-- what leaderboards count, per day: reading time, finished episodes, manga and ranobe chapters;
-- legacy_seconds is history brought over from the old Firebase account (shown in stats, not ranked)
alter table public.watch_stats add column if not exists read_seconds integer not null default 0 check (read_seconds >= 0);
alter table public.watch_stats add column if not exists episodes integer not null default 0 check (episodes >= 0);
alter table public.watch_stats add column if not exists chapters integer not null default 0 check (chapters >= 0);
alter table public.watch_stats add column if not exists ln_chapters integer not null default 0 check (ln_chapters >= 0);
alter table public.watch_stats add column if not exists legacy_seconds integer not null default 0 check (legacy_seconds >= 0);
create index if not exists watch_stats_day on public.watch_stats (day);

-- running totals for the all-time boards, and the clock that keeps reports honest
create table if not exists public.user_totals (
  user_id uuid primary key references auth.users on delete cascade,
  watch_seconds bigint not null default 0,
  read_seconds bigint not null default 0,
  episodes integer not null default 0,
  chapters integer not null default 0,
  ln_chapters integer not null default 0,
  streak integer not null default 0,
  best_streak integer not null default 0,
  last_day date,
  credit numeric not null default 3600,
  reported_at timestamptz not null default now(),
  imported boolean not null default false
);
alter table public.user_totals enable row level security;
drop policy if exists "own totals" on public.user_totals;
create policy "own totals" on public.user_totals for select using (user_id = auth.uid());

-- what the accounts had before the counters existed
insert into public.user_totals (user_id, watch_seconds, episodes)
select s.user_id, sum(s.seconds),
  least((select count(*) from public.user_docs d, jsonb_each(d.data) e where d.user_id = s.user_id and d.kind = 'episodes' and (e.value ->> 2) = '1'),
        sum(s.seconds) / 480)
from public.watch_stats s group by s.user_id
on conflict (user_id) do nothing;
update public.user_totals set credit = least(credit, 21600);
-- streaks from the days already recorded (once, for accounts that have none yet)
with days as (select user_id, day::date as d from public.watch_stats where seconds + legacy_seconds >= 600),
runs as (
  select user_id, count(*)::int as n, max(d) as last
  from (select user_id, d, d - (row_number() over (partition by user_id order by d))::int as g from days) x
  group by user_id, g
)
update public.user_totals t set
  best_streak = (select max(n) from runs where runs.user_id = t.user_id),
  streak = (select n from runs where runs.user_id = t.user_id order by last desc limit 1),
  last_day = (select max(last) from runs where runs.user_id = t.user_id)
where t.last_day is null and exists (select 1 from runs where runs.user_id = t.user_id);

-- Adds a report {day: {w, r, e, c, l}}: seconds watched and read, episodes, manga and ranobe chapters finished.
-- Honest by construction, whatever a modified client sends:
--  * time can't run faster than the clock: every second reported is paid from a credit that refills
--    one second per real second (at most 6 hours banked, for offline viewing);
--  * only the last two days and tomorrow (time zones) can be reported, at most 16 hours a day;
--  * a finished episode needs 8 minutes of watching that day, a manga chapter 15 s and a ranobe chapter 45 s of reading.
create or replace function public.add_activity(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  t user_totals;
  s watch_stats;
  k text; v jsonb; d date;
  w int; r int; e int; c int; l int; used int;
begin
  if me is null or jsonb_typeof(p) <> 'object' then return; end if;
  insert into user_totals (user_id) values (me) on conflict do nothing;
  select * into t from user_totals where user_id = me for update;
  t.credit := least(t.credit + extract(epoch from now() - t.reported_at), 21600);
  for k, v in select key, value from jsonb_each(p) order by key loop
    continue when k !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(v) <> 'object';
    begin d := k::date; exception when others then continue; end;
    continue when d < current_date - 2 or d > current_date + 1;
    insert into watch_stats (user_id, day) values (me, k) on conflict do nothing;
    select * into s from watch_stats where user_id = me and day = k for update;
    used := s.seconds + s.read_seconds;
    w := least(greatest(coalesce((v ->> 'w')::numeric, 0), 0), t.credit, greatest(57600 - used, 0))::int;
    r := least(greatest(coalesce((v ->> 'r')::numeric, 0), 0), t.credit - w, greatest(57600 - used - w, 0))::int;
    t.credit := t.credit - w - r;
    e := least(greatest(coalesce((v ->> 'e')::int, 0), 0),
               greatest(case when s.seconds + w >= 60 then (s.seconds + w) / 480 + 1 else 0 end - s.episodes, 0));
    c := least(greatest(coalesce((v ->> 'c')::int, 0), 0),
               greatest((s.read_seconds + r + 30 - s.ln_chapters * 45) / 15 - s.chapters, 0));
    l := least(greatest(coalesce((v ->> 'l')::int, 0), 0),
               greatest((s.read_seconds + r + 30 - (s.chapters + c) * 15) / 45 - s.ln_chapters, 0));
    continue when w + r + e + c + l = 0;
    update watch_stats set seconds = seconds + w, read_seconds = read_seconds + r,
      episodes = episodes + e, chapters = chapters + c, ln_chapters = ln_chapters + l
    where user_id = me and day = k;
    t.watch_seconds := t.watch_seconds + w;
    t.read_seconds := t.read_seconds + r;
    t.episodes := t.episodes + e;
    t.chapters := t.chapters + c;
    t.ln_chapters := t.ln_chapters + l;
    -- a streak day is one with at least 10 minutes of watching or reading
    if used + w + r >= 600 and (t.last_day is null or d > t.last_day) then
      t.streak := case when t.last_day = d - 1 then t.streak + 1 else 1 end;
      t.best_streak := greatest(t.best_streak, t.streak);
      t.last_day := d;
    end if;
  end loop;
  update user_totals set watch_seconds = t.watch_seconds, read_seconds = t.read_seconds, episodes = t.episodes,
    chapters = t.chapters, ln_chapters = t.ln_chapters, streak = t.streak, best_streak = t.best_streak,
    last_day = t.last_day, credit = t.credit, reported_at = now()
  where user_id = me;
end $$;

-- what 1.0.34 and older call: watch time only
create or replace function public.add_watch_time(p jsonb) returns void
language sql security definer set search_path = public as $$
  select public.add_activity((select jsonb_object_agg(key, jsonb_build_object('w', value)) from jsonb_each(p)))
$$;

-- the watch history of an account moved from Firebase: once, into legacy_seconds, never ranked
create or replace function public.import_watch_history(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v numeric;
begin
  if auth.uid() is null or jsonb_typeof(p) <> 'object' then return; end if;
  insert into user_totals (user_id) values (auth.uid()) on conflict do nothing;
  update user_totals set imported = true where user_id = auth.uid() and not imported;
  if not found then return; end if;
  for k, v in select key, value::numeric from jsonb_each_text(p) loop
    continue when k !~ '^\d{4}-\d{2}-\d{2}$' or v <= 0;
    insert into watch_stats (user_id, day, legacy_seconds) values (auth.uid(), k, least(v, 57600)::int)
    on conflict (user_id, day) do update set legacy_seconds = least(watch_stats.legacy_seconds + excluded.legacy_seconds, 57600);
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
  if char_length(password) < 6 or char_length(password) > 72 then raise exception 'weak-password' using errcode = 'P0001'; end if;
  if nick like '%@%' then
    -- a real address: made confirmed right away, no letters are sent; the nickname comes from its first part
    if nick !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid-email' using errcode = 'P0001'; end if;
    mail := nick;
    nick := split_part(nick, '@', 1);
    if exists (select 1 from auth.users where email = mail) then raise exception 'username-taken' using errcode = 'P0001'; end if;
  else
    if nick !~ '^[a-z0-9._-]{3,24}$' then raise exception 'bad-username' using errcode = 'P0001'; end if;
    mail := nick || '@users.aniplayer.app';
    if exists (select 1 from auth.users where email = mail) or exists (select 1 from profiles where username = nick) then
      raise exception 'username-taken' using errcode = 'P0001';
    end if;
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

-- the app shrinks pictures to WebP before upload (avatar ~20 KB, banner ~80 KB) and keeps one of each per account,
-- so 1 GB of free file storage holds about 10 000 profiles; the limit stops anything bigger getting in
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 307200, '{image/webp,image/jpeg}')
on conflict (id) do update set public = true, file_size_limit = 307200, allowed_mime_types = '{image/webp,image/jpeg}';

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
    'seconds', coalesce((select sum(seconds + legacy_seconds) from watch_stats where user_id = target), 0),
    'episodes', (select count(*) from user_docs d, jsonb_each(d.data) e where d.user_id = target and d.kind = 'episodes' and (e.value ->> 2) = '1'),
    'read_seconds', coalesce((select read_seconds from user_totals where user_id = target), 0),
    'chapters', coalesce((select chapters from user_totals where user_id = target), 0),
    'ln_chapters', coalesce((select ln_chapters from user_totals where user_id = target), 0),
    'streak', coalesce((select case when last_day >= current_date - 1 then streak else 0 end from user_totals where user_id = target), 0),
    'best_streak', coalesce((select best_streak from user_totals where user_id = target), 0),
    'xp', coalesce((select watch_seconds / 60 + read_seconds / 60 + episodes * 5 + chapters * 2 + ln_chapters * 4 from user_totals where user_id = target), 0),
    'completed', (select count(*) from user_docs where user_id = target and kind = 'title' and data ->> 'status' = 'completed'),
    'watching', (select count(*) from user_docs where user_id = target and kind = 'title' and data ->> 'status' = 'watching'),
    -- MAL ids of the finished titles, for the per-series achievements
    'completed_ids', (select coalesce(jsonb_agg(distinct (data ->> 'malId')::int), '[]') from user_docs
                      where user_id = target and kind = 'title' and data ->> 'status' = 'completed' and data ->> 'malId' ~ '^\d{1,9}$'),
    -- per anime (MAL id): [episodes watched, furthest episode watched], for the themed achievements
    'mal_eps', (select coalesce(jsonb_object_agg(m.mal, m.v), '{}') from (
                  select (t.data ->> 'malId')::int as mal, jsonb_build_array(sum(x.n), coalesce(max(x.top), 0)) as v
                  from user_docs t cross join lateral (
                    select count(*) as n, max(floor(e.key::numeric)) filter (where e.key ~ '^\d{1,5}(\.\d+)?$') as top
                    from user_docs d, jsonb_each(d.data) e
                    where d.user_id = target and d.kind = 'episodes' and d.key = t.key and (e.value ->> 2) = '1') x
                  where t.user_id = target and t.kind = 'title' and t.data ->> 'malId' ~ '^\d{1,9}$'
                  group by 1 having sum(x.n) > 0) m),
    'comments', (select count(*) from comments where user_id = target and not hidden),
    'ratings', (select count(*) from ratings where user_id = target)
  ) end
$$;

-- ---------------------------------------------------------------------------------------------
-- leaderboards: board = xp | watch | episodes | read | chapters | ln | streak | best_streak | likes | critic,
-- period = week | month | all. Only public, unbanned profiles are ranked; the caller always gets their own row too.

drop function if exists public.leaderboard(text, text, integer);
create function public.leaderboard(board text, period text default 'all', lim integer default 50)
returns table (place integer, user_id uuid, username text, display_name text, avatar_url text, accent text, frame text, role text, value bigint, me boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  since date := case period when 'week' then current_date - 6 when 'month' then current_date - 29 end;
  daily boolean := since is not null and board in ('xp', 'watch', 'episodes', 'read', 'chapters', 'ln');
begin
  return query
  with v as (
    select ws.user_id as uid, (case board
      when 'xp' then sum(ws.seconds / 60 + ws.read_seconds / 60 + ws.episodes * 5 + ws.chapters * 2 + ws.ln_chapters * 4)
      when 'watch' then sum(ws.seconds) when 'episodes' then sum(ws.episodes) when 'read' then sum(ws.read_seconds)
      when 'chapters' then sum(ws.chapters) when 'ln' then sum(ws.ln_chapters) end)::bigint as val
    from watch_stats ws where daily and ws.day >= since::text group by ws.user_id
    union all
    select t.user_id, (case board
      when 'xp' then t.watch_seconds / 60 + t.read_seconds / 60 + t.episodes * 5 + t.chapters * 2 + t.ln_chapters * 4
      when 'watch' then t.watch_seconds when 'episodes' then t.episodes when 'read' then t.read_seconds
      when 'chapters' then t.chapters when 'ln' then t.ln_chapters
      when 'streak' then case when t.last_day >= current_date - 1 then t.streak else 0 end
      when 'best_streak' then t.best_streak end)::bigint
    from user_totals t where not daily and board in ('xp', 'watch', 'episodes', 'read', 'chapters', 'ln', 'streak', 'best_streak')
    union all
    select c.user_id, sum(c.likes)::bigint from comments c
    where board = 'likes' and not c.hidden and (since is null or c.created_at >= since) group by c.user_id
    union all
    select r.user_id, count(*)::bigint from ratings r
    where board = 'critic' and (since is null or r.updated_at >= since) group by r.user_id
  ), ranked as (
    select v.uid, v.val, (rank() over (order by v.val desc))::int as pos
    from v join profiles p on p.id = v.uid
    where v.val > 0 and ((p.public and (p.banned_until is null or p.banned_until < now())) or v.uid = auth.uid())
  )
  select r.pos, p.id, p.username, p.display_name, p.avatar_url, p.accent, p.frame, p.role, r.val, p.id = auth.uid()
  from ranked r join profiles p on p.id = r.uid
  where r.pos <= least(greatest(lim, 1), 100) or r.uid = auth.uid()
  order by r.pos, p.username;
end $$;

-- ---------------------------------------------------------------------------------------------
-- housekeeping, so old rows don't eat the free 500 MB: rooms idle for 3 days go (with their events),
-- a room keeps its last 200 chat messages and reactions

create or replace function public.room_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'rooms' then
    delete from rooms where updated_at < now() - interval '3 days';
  else
    delete from room_events where code = new.code
      and id <= (select id from room_events where code = new.code order by id desc offset 200 limit 1);
  end if;
  return null;
end $$;
drop trigger if exists room_cleanup on public.rooms;
create trigger room_cleanup after insert on public.rooms for each statement execute function public.room_cleanup();
drop trigger if exists room_cleanup on public.room_events;
create trigger room_cleanup after insert on public.room_events for each row execute function public.room_cleanup();
