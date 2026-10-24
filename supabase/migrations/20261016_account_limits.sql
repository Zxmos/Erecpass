-- ERecPass account caps: 20 Patient, 15 Staff, 4 Admin.
-- Safe to re-run; does not create/delete any accounts or alter app UI.
insert into public.app_settings (setting_key, setting_value)
values ('account_limits', '{"patient":20,"staff":15,"admin":4}'::jsonb)
on conflict (setting_key) do update
set setting_value = coalesce(public.app_settings.setting_value, '{}'::jsonb) || excluded.setting_value,
    updated_at = now();

create or replace function public.enforce_erecpass_account_limits()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_limit integer;
  v_count integer;
  v_setting_key text;
begin
  if new.role not in ('patient', 'staff', 'admin') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.role is not distinct from new.role then
    return new;
  end if;

  v_setting_key := new.role;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('erecpass_' || v_setting_key || '_account_limit')
  );

  select coalesce((s.setting_value ->> v_setting_key)::integer,
                  case v_setting_key
                    when 'patient' then 20
                    when 'staff' then 15
                    when 'admin' then 4
                  end)
    into v_limit
  from public.app_settings s
  where s.setting_key = 'account_limits';

  if v_limit is null then
    v_limit := case v_setting_key
      when 'patient' then 20
      when 'staff' then 15
      when 'admin' then 4
    end;
  end if;

  select count(*)::integer into v_count
  from public.profiles p
  where p.role = new.role
    and (tg_op = 'INSERT' or p.id <> new.id);

  if v_count >= v_limit then
    raise exception 'ERecPass account limit reached: maximum % % accounts.', v_limit, new.role
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_erecpass_account_limits on public.profiles;
create trigger enforce_erecpass_account_limits
before insert or update of role on public.profiles
for each row execute function public.enforce_erecpass_account_limits();
