-- =====================================================================
-- iChat database schema
-- Run ONCE in Supabase Dashboard -> SQL Editor on a fresh project.
-- =====================================================================

-- ---------- Tables ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint display_name_len check (char_length(display_name) between 1 and 50),
  constraint bio_len check (char_length(bio) <= 200)
); 

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text check (content is null or char_length(content) <= 2000),
  media_path text,
  media_type text check (media_type in ('image','video')),
  created_at timestamptz not null default now(),
  constraint post_has_body check (content is not null or media_path is not null)
);
create index posts_created_idx on public.posts (created_at desc);

create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct','group')),
  name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index chat_members_user_idx on public.chat_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text','call_start','call_end')),
  content text check (content is null or char_length(content) <= 4000),
  media_path text,
  media_type text check (media_type in ('image','video')),
  call_id uuid,
  call_media text check (call_media in ('audio','video')),
  created_at timestamptz not null default now(),
  constraint msg_has_body check (kind <> 'text' or content is not null or media_path is not null)
);
create index messages_chat_idx on public.messages (chat_id, created_at desc);

-- ---------- Helper functions ----------
create or replace function public.is_chat_member(_chat_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_members
    where chat_id = _chat_id and user_id = auth.uid()
  );
$$;

-- Used by Realtime Authorization: only members of a chat may join its call room.
-- Topic format: call:<chat_uuid>:<call_uuid>
create or replace function public.can_access_call_topic(_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare cid uuid;
begin
  if _topic !~ '^call:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  cid := split_part(_topic, ':', 2)::uuid;
  return public.is_chat_member(cid);
end $$;

create or replace function public.username_available(u text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(u));
$$;

-- ---------- Auto-create a profile when a user signs up ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base_name text;
  final_name text;
begin
  base_name := lower(regexp_replace(
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)),
    '[^a-zA-Z0-9_]', '', 'g'));
  if length(base_name) < 3 then base_name := base_name || 'user'; end if;
  base_name := left(base_name, 20);
  final_name := base_name;
  while exists (select 1 from public.profiles where username = final_name) loop
    final_name := left(base_name, 14) || '_' || substr(md5(random()::text), 1, 5);
  end loop;
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    final_name,
    left(coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), final_name), 50)
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Chat RPCs ----------
create or replace function public.get_or_create_direct_chat(other_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cid uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if other_user = me then raise exception 'You cannot message yourself'; end if;
  if not exists (select 1 from public.profiles where id = other_user) then
    raise exception 'User not found';
  end if;

  perform pg_advisory_xact_lock(hashtext(least(me::text, other_user::text) || greatest(me::text, other_user::text)));

  select c.id into cid
  from public.chats c
  where c.type = 'direct'
    and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = me)
    and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = other_user)
  limit 1;

  if cid is null then
    insert into public.chats (type, created_by) values ('direct', me) returning id into cid;
    insert into public.chat_members (chat_id, user_id, role)
    values (cid, me, 'member'), (cid, other_user, 'member');
  end if;
  return cid;
end $$;

create or replace function public.create_group(group_name text, member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cid uuid;
  clean_ids uuid[];
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if group_name is null or char_length(trim(group_name)) < 1 or char_length(trim(group_name)) > 60 then
    raise exception 'Group name must be 1 to 60 characters';
  end if;
  select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into clean_ids
  from public.profiles p where p.id = any(member_ids) and p.id <> me;
  if coalesce(array_length(clean_ids, 1), 0) < 1 then
    raise exception 'Add at least one other member';
  end if;
  if array_length(clean_ids, 1) > 99 then
    raise exception 'Groups are limited to 100 members';
  end if;
  insert into public.chats (type, name, created_by) values ('group', trim(group_name), me) returning id into cid;
  insert into public.chat_members (chat_id, user_id, role) values (cid, me, 'admin');
  insert into public.chat_members (chat_id, user_id, role)
  select cid, unnest(clean_ids), 'member';
  return cid;
end $$;

create or replace function public.add_group_members(_chat_id uuid, member_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.chats c
    join public.chat_members m on m.chat_id = c.id and m.user_id = me and m.role = 'admin'
    where c.id = _chat_id and c.type = 'group'
  ) then
    raise exception 'Only group admins can add members';
  end if;
  if (select count(*) from public.chat_members where chat_id = _chat_id) + coalesce(array_length(member_ids, 1), 0) > 100 then
    raise exception 'Groups are limited to 100 members';
  end if;
  insert into public.chat_members (chat_id, user_id, role)
  select _chat_id, p.id, 'member' from public.profiles p where p.id = any(member_ids)
  on conflict do nothing;
end $$;

create or replace function public.mark_chat_read(_chat_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ts timestamptz := now();
begin
  update public.chat_members set last_read_at = ts
  where chat_id = _chat_id and user_id = auth.uid();
  return ts;
end $$;

-- Latest message of every chat the caller belongs to (RLS applies: security invoker).
create or replace function public.my_chat_previews()
returns setof public.messages language sql stable security invoker set search_path = public as $$
  select distinct on (chat_id) * from public.messages order by chat_id, created_at desc;
$$;

-- ---------- Row Level Security ----------
alter table public.profiles     enable row level security;
alter table public.posts        enable row level security;
alter table public.post_likes   enable row level security;
alter table public.chats        enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages     enable row level security;

create policy "profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "users insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "posts readable by signed-in users" on public.posts for select to authenticated using (true);
create policy "users create own posts" on public.posts for insert to authenticated with check (user_id = auth.uid());
create policy "users delete own posts" on public.posts for delete to authenticated using (user_id = auth.uid());

create policy "likes readable by signed-in users" on public.post_likes for select to authenticated using (true);
create policy "users like as themselves" on public.post_likes for insert to authenticated with check (user_id = auth.uid());
create policy "users remove own likes" on public.post_likes for delete to authenticated using (user_id = auth.uid());

create policy "members read their chats" on public.chats for select to authenticated using (public.is_chat_member(id));

create policy "members read chat membership" on public.chat_members for select to authenticated using (public.is_chat_member(chat_id));
create policy "members can leave" on public.chat_members for delete to authenticated using (user_id = auth.uid());

create policy "members read messages" on public.messages for select to authenticated using (public.is_chat_member(chat_id));
create policy "members send messages" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_chat_member(chat_id));
create policy "senders delete own messages" on public.messages for delete to authenticated using (sender_id = auth.uid());

-- ---------- Grants ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.posts, public.post_likes to authenticated;
grant select on public.chats to authenticated;
grant select, delete on public.chat_members to authenticated;
grant select, insert, delete on public.messages to authenticated;

revoke execute on function public.get_or_create_direct_chat(uuid) from public, anon;
revoke execute on function public.create_group(text, uuid[]) from public, anon;
revoke execute on function public.add_group_members(uuid, uuid[]) from public, anon;
revoke execute on function public.mark_chat_read(uuid) from public, anon;
revoke execute on function public.my_chat_previews() from public, anon;
grant execute on function public.get_or_create_direct_chat(uuid) to authenticated;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.my_chat_previews() to authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.can_access_call_topic(text) to authenticated;

-- ---------- Storage ----------
-- public-media: post media + avatars (anyone with the URL can view)
-- chat-media:   private; only members of the chat can read/write (path: <chat_id>/<file>)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('public-media', 'public-media', true, 52428800,
    array['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/webm','video/quicktime']),
  ('chat-media', 'chat-media', false, 52428800,
    array['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "public-media is readable" on storage.objects for select
  using (bucket_id = 'public-media');
create policy "public-media upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "public-media delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "chat-media members read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and public.is_chat_member(((storage.foldername(name))[1])::uuid));
create policy "chat-media members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and public.is_chat_member(((storage.foldername(name))[1])::uuid));

-- ---------- Realtime ----------
do $$
declare t text;
begin
  foreach t in array array['messages','chat_members','posts','post_likes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Private call-room channels: only members of the chat can join the room.
create policy "call rooms: members receive" on realtime.messages for select to authenticated
  using (public.can_access_call_topic(realtime.topic()));
create policy "call rooms: members send" on realtime.messages for insert to authenticated
  with check (public.can_access_call_topic(realtime.topic()));
