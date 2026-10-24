# ErecPass — Hospital Portal

ErecPass is a hospital portal with a Supabase-backed data layer. The existing UI remains in `index.html`; `supabase-runtime.js` handles Auth, cloud data synchronization, and Realtime refreshes.

## Backend
- Supabase project: `ERECPASS`
- Supabase URL: `https://bfboehvgrivanmrfqquw.supabase.co`
- Browser client uses the Supabase **publishable** key only.
- Tables: `profiles`, `patients`, `staff`, `appointments`, `announcements`, `help_center_messages`, `activity_logs`, `app_settings`
- RLS is enabled on all exposed public tables.
- Admin account operations use the protected `admin-manage-account` Edge Function.
- GitHub Pages workflow: `.github/workflows/pages.yml`

## Account limits (Supabase-enforced)
- Maximum **20 Patient** profiles.
- Maximum **15 Staff** profiles.
- Maximum **4 Admin** profiles.
- These are maximum account counts, not accounts automatically created.
- A database trigger enforces the caps on profile creation and role changes; existing accounts and unrelated app functions are preserved.
- Current Supabase profile counts at last verification: **4 Patient**, **2 Staff**, **1 Admin**.
- Migration source: `supabase/migrations/20261016_account_limits.sql`.

## Password reset
The app uses Supabase Auth password recovery. The reset link returns to the current GitHub Pages path and the app handles the `PASSWORD_RECOVERY` event before allowing the new password to be saved.

If a reset link shows a 404, make sure the GitHub Pages URL is registered in Supabase Authentication URL Configuration as an allowed redirect URL.

## Database/security maintenance
- Foreign-key indexes were added for common account/audit relationships.
- Duplicate legacy-id indexes were removed.
- Staff availability RLS was optimized to evaluate `auth.uid()` once per statement.
- The Admin email bootstrap trigger is aligned to `admin2@gmail.com`.
- New Auth users are assigned a patient row only when the resulting profile role is actually `patient`, preventing Admin/Staff accounts from accidentally receiving patient records.

## Important
Do not put a Supabase secret/service-role key in browser code or GitHub. The browser file must contain only the publishable key.

Supabase's leaked-password protection should also be enabled in Authentication security settings. This project can contain clinical-style records, so use test/fake patient data until full end-to-end testing and privacy review are complete.


<!-- ERecPass deployment refresh: 2026-10-07T16:45:35.740Z -->
