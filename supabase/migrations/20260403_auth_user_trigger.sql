-- Automatically create a public.users row when a Supabase Auth user is created.
-- This ensures auth and app users are always in sync, regardless of how the
-- auth user was created (webhook, admin dashboard, magic link, etc.).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.users (name, email, role, supabase_auth_id, needs_password_setup, created_at)
  values (
    coalesce(
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.email,
    'student',
    new.id::text,
    true,
    now()::text
  )
  on conflict (email) do update set
    supabase_auth_id = excluded.supabase_auth_id
  where public.users.supabase_auth_id is null;
  return new;
end;
$$;

-- Drop existing trigger if any, then create
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
