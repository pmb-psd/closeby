-- =============================================================
--  Closeby · base de datos (Supabase)
--  Pega TODO este archivo en Supabase → SQL Editor → Run.
--  Se puede volver a ejecutar sin romper nada.
-- =============================================================

-- ---------- Tablas ----------
create table if not exists public.couples (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  couple_id  uuid not null references public.couples(id) on delete cascade,
  slot       text not null check (slot in ('p1','p2')),
  joined_at  timestamptz not null default now(),
  unique (couple_id, slot)
);

create table if not exists public.invites (
  code        text primary key,
  couple_id   uuid not null references public.couples(id) on delete cascade,
  created_by  uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_by     uuid references auth.users(id) on delete set null,
  used_at     timestamptz
);

-- Todos los datos de la app viven aquí, como "documentos" con una ruta.
-- Ej.: app/config · viajes/<id> · movs/<usuario>/items/<id> · data/users/<usuario>/<id> (privado)
create table if not exists public.docs (
  couple_id   uuid not null references public.couples(id) on delete cascade,
  path        text not null check (char_length(path) between 1 and 300),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (couple_id, path)
);
alter table public.docs replica identity full;

-- ---------- Ayudantes ----------
create or replace function public.my_couple()
returns uuid language sql stable security definer set search_path = public as $$
  select couple_id from public.members where user_id = auth.uid()
$$;

-- ¿Puedo LEER esta ruta? Todo lo de la pareja, salvo lo privado de la otra persona.
create or replace function public.can_read_path(p text)
returns boolean language sql stable as $$
  select split_part(p,'/',1) <> 'data'
      or (split_part(p,'/',2) = 'users' and split_part(p,'/',3) = auth.uid()::text)
$$;

-- ¿Puedo ESCRIBIR esta ruta?
--   app/* y viajes/*            → las dos
--   movs|acts|horarios|people/<yo>/… → solo yo
--   data/users/<yo>/…           → solo yo (privado)
create or replace function public.can_write_path(p text)
returns boolean language sql stable as $$
  select case split_part(p,'/',1)
    when 'app'      then true
    when 'viajes'   then true
    when 'movs'     then split_part(p,'/',2) = auth.uid()::text
    when 'acts'     then split_part(p,'/',2) = auth.uid()::text
    when 'horarios' then split_part(p,'/',2) = auth.uid()::text
    when 'people'   then split_part(p,'/',2) = auth.uid()::text
    when 'data'     then split_part(p,'/',2) = 'users' and split_part(p,'/',3) = auth.uid()::text
    else false end
$$;

-- ---------- Reglas de seguridad (RLS) ----------
alter table public.couples enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.docs    enable row level security;

drop policy if exists couples_read on public.couples;
create policy couples_read on public.couples for select to authenticated
  using (id = public.my_couple());

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (couple_id = public.my_couple());

drop policy if exists invites_read on public.invites;
create policy invites_read on public.invites for select to authenticated
  using (couple_id = public.my_couple());

drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_read on public.docs for select to authenticated
  using (couple_id = public.my_couple() and public.can_read_path(path));
create policy docs_insert on public.docs for insert to authenticated
  with check (couple_id = public.my_couple() and public.can_write_path(path));
create policy docs_update on public.docs for update to authenticated
  using (couple_id = public.my_couple() and public.can_write_path(path))
  with check (couple_id = public.my_couple() and public.can_write_path(path));
create policy docs_delete on public.docs for delete to authenticated
  using (couple_id = public.my_couple() and public.can_write_path(path));

-- Nadie escribe parejas, miembros ni códigos directamente: solo con las funciones de abajo.
revoke insert, update, delete on public.couples, public.members, public.invites from anon, authenticated;
revoke all on public.couples, public.members, public.invites, public.docs from anon;
grant select on public.couples, public.members, public.invites to authenticated;
grant select, insert, update, delete on public.docs to authenticated;

-- ---------- Código de pareja ----------
create or replace function public._new_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   -- sin 0/O, 1/I/L para que no se confundan
  c text;
begin
  loop
    c := 'CB-';
    for i in 1..4 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.invites where code = c);
  end loop;
  return c;
end $$;

-- Mi pareja: { couple_id, slot, partner_joined, code, code_expires }
create or replace function public.my_membership()
returns json language plpgsql stable security definer set search_path = public as $$
declare m public.members; inv public.invites; partner boolean;
begin
  if auth.uid() is null then return null; end if;
  select * into m from public.members where user_id = auth.uid();
  if not found then return null; end if;
  select exists(select 1 from public.members where couple_id = m.couple_id and user_id <> auth.uid()) into partner;
  select * into inv from public.invites
    where couple_id = m.couple_id and used_by is null and expires_at > now()
    order by expires_at desc limit 1;
  return json_build_object('couple_id', m.couple_id, 'slot', m.slot, 'partner_joined', partner,
                           'code', inv.code, 'code_expires', inv.expires_at);
end $$;

-- Crear nuestro espacio (quien lo crea es la persona 1) y su primer código.
create or replace function public.create_couple()
returns json language plpgsql volatile security definer set search_path = public as $$
declare cid uuid; c text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero.'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'Ya tienes una pareja conectada.';
  end if;
  insert into public.couples (created_by) values (auth.uid()) returning id into cid;
  insert into public.members (user_id, couple_id, slot) values (auth.uid(), cid, 'p1');
  c := public._new_code();
  insert into public.invites (code, couple_id, created_by, expires_at)
    values (c, cid, auth.uid(), now() + interval '24 hours');
  return json_build_object('couple_id', cid, 'slot', 'p1', 'code', c);
end $$;

-- Generar un código nuevo (si el anterior venció). Solo mientras falte la otra persona.
create or replace function public.new_invite()
returns json language plpgsql volatile security definer set search_path = public as $$
declare m public.members; c text;
begin
  select * into m from public.members where user_id = auth.uid();
  if not found then raise exception 'Primero crea tu espacio.'; end if;
  if (select count(*) from public.members where couple_id = m.couple_id) >= 2 then
    raise exception 'Ya están conectadas las dos.';
  end if;
  delete from public.invites where couple_id = m.couple_id and used_by is null;
  c := public._new_code();
  insert into public.invites (code, couple_id, created_by, expires_at)
    values (c, m.couple_id, auth.uid(), now() + interval '24 hours');
  return json_build_object('code', c, 'code_expires', now() + interval '24 hours');
end $$;

-- Unirme con el código de mi pareja (entro como persona 2).
create or replace function public.join_couple(p_code text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare inv public.invites; norm text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero.'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'Ya tienes una pareja conectada.';
  end if;
  norm := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
  if norm like 'CB%' then norm := substr(norm, 3); end if;
  select * into inv from public.invites where code = 'CB-' || norm for update;
  if not found then raise exception 'Ese código no existe. Revísalo con tu pareja.'; end if;
  if inv.used_by is not null then raise exception 'Ese código ya se usó.'; end if;
  if inv.expires_at < now() then raise exception 'Ese código venció. Pídele a tu pareja uno nuevo.'; end if;
  if (select count(*) from public.members where couple_id = inv.couple_id) >= 2 then
    raise exception 'Ese espacio ya tiene a las dos personas.';
  end if;
  insert into public.members (user_id, couple_id, slot) values (auth.uid(), inv.couple_id, 'p2');
  update public.invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return json_build_object('couple_id', inv.couple_id, 'slot', 'p2');
end $$;

revoke execute on function public.my_membership(), public.create_couple(), public.new_invite(), public.join_couple(text), public._new_code() from public, anon;
grant execute on function public.my_membership(), public.create_couple(), public.new_invite(), public.join_couple(text) to authenticated;
grant execute on function public.my_couple(), public.can_read_path(text), public.can_write_path(text) to authenticated;

-- ---------- Tiempo real (para que los cambios lleguen al instante al otro celular) ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
exception when undefined_object then
  raise notice 'No se encontró la publicación supabase_realtime (normal fuera de Supabase).';
end $$;
