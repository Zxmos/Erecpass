-- Additive-only schema for native FCM device tokens and push event dispatch.
create extension if not exists pg_net with schema extensions;
-- Existing ERecPass tables and UI functions are not altered.
create table if not exists public.device_push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'android' check (platform in ('android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists device_push_tokens_user_id_idx
  on public.device_push_tokens(user_id);

alter table public.device_push_tokens enable row level security;

drop policy if exists "Users can view their own push tokens" on public.device_push_tokens;
create policy "Users can view their own push tokens"
  on public.device_push_tokens for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can register their own push tokens" on public.device_push_tokens;
create policy "Users can register their own push tokens"
  on public.device_push_tokens for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own push tokens" on public.device_push_tokens;
create policy "Users can update their own push tokens"
  on public.device_push_tokens for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own push tokens" on public.device_push_tokens;
create policy "Users can delete their own push tokens"
  on public.device_push_tokens for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.device_push_tokens to authenticated;

create or replace function public.erecpass_dispatch_push_event()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  event_type text := TG_OP;
  new_row jsonb := to_jsonb(NEW);
  old_row jsonb := case when TG_OP = 'INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  payload jsonb;
  webhook_secret text;
begin
  -- Never block or fail a clinical record/chat write because push delivery is unavailable.
  if TG_TABLE_NAME = 'patients' and TG_OP = 'UPDATE' then
    if old_row->'lab_results' is not distinct from new_row->'lab_results'
       and old_row->'prescriptions' is not distinct from new_row->'prescriptions' then
      return NEW;
    end if;
  end if;
  if TG_TABLE_NAME = 'appointments' and TG_OP = 'UPDATE'
     and old_row->>'status' is not distinct from new_row->>'status' then
    return NEW;
  end if;

  select decrypted_secret into webhook_secret
    from vault.decrypted_secrets
    where name = 'ERECPASS_PUSH_WEBHOOK_SECRET'
    limit 1;

  -- Secret is intentionally configured separately in Supabase Vault and Edge Function secrets.
  if webhook_secret is null or length(webhook_secret) < 32 then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'message_messages' then
    payload := jsonb_build_object(
      'table', TG_TABLE_NAME, 'type', event_type,
      'record', jsonb_build_object('id', new_row->>'id', 'conversation_id', new_row->>'conversation_id', 'sender_id', new_row->>'sender_id')
    );
  elsif TG_TABLE_NAME = 'appointments' then
    payload := jsonb_build_object(
      'table', TG_TABLE_NAME, 'type', event_type,
      'record', jsonb_build_object('id', new_row->>'id', 'patient_id', new_row->>'patient_id', 'status', new_row->>'status', 'created_by', new_row->>'created_by'),
      'old_record', jsonb_build_object('status', old_row->>'status')
    );
  elsif TG_TABLE_NAME = 'patients' then
    payload := jsonb_build_object(
      'table', TG_TABLE_NAME, 'type', event_type,
      'record', jsonb_build_object('id', new_row->>'id', 'user_id', new_row->>'user_id'),
      'changed_lab_results', old_row->'lab_results' is distinct from new_row->'lab_results',
      'changed_prescriptions', old_row->'prescriptions' is distinct from new_row->'prescriptions'
    );
  elsif TG_TABLE_NAME = 'medication_reminders' then
    payload := jsonb_build_object(
      'table', TG_TABLE_NAME, 'type', event_type,
      'record', jsonb_build_object('id', new_row->>'id', 'patient_user_id', new_row->>'patient_user_id')
    );
  else
    return NEW;
  end if;

  perform extensions.http_post(
    url := 'https://bfboehvgrivanmrfqquw.supabase.co/functions/v1/erecpass-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-erecpass-webhook-secret', webhook_secret
    ),
    body := payload,
    timeout_milliseconds := 3000
  );

  return NEW;
exception when others then
  -- Keep application writes independent from the optional notification transport.
  raise warning 'ERecPass push dispatch skipped: %', SQLERRM;
  return NEW;
end;
$$;

revoke all on function public.erecpass_dispatch_push_event() from public, anon, authenticated;

drop trigger if exists erecpass_push_messages on public.message_messages;
create trigger erecpass_push_messages
  after insert on public.message_messages
  for each row execute function public.erecpass_dispatch_push_event();

drop trigger if exists erecpass_push_appointments on public.appointments;
create trigger erecpass_push_appointments
  after insert or update of status on public.appointments
  for each row execute function public.erecpass_dispatch_push_event();

drop trigger if exists erecpass_push_patient_results on public.patients;
create trigger erecpass_push_patient_results
  after update of lab_results, prescriptions on public.patients
  for each row execute function public.erecpass_dispatch_push_event();

drop trigger if exists erecpass_push_medication_reminders on public.medication_reminders;
create trigger erecpass_push_medication_reminders
  after insert or update on public.medication_reminders
  for each row execute function public.erecpass_dispatch_push_event();
