# ERecPass Supabase Setup

## Repository wiring
- `index.html` is the existing app entry point and UI.
- `supabase-runtime.js` provides the cloud-backed storage adapter, Auth handling, and Realtime refresh.
- `supabase-client.js` contains only the public browser client configuration.
- Supabase project: `https://bfboehvgrivanmrfqquw.supabase.co`
- Tables: `profiles`, `patients`, `staff`, `appointments`, `announcements`, `help_center_messages`, `activity_logs`, `app_settings`
- RLS is enabled.

## Main Admin
The configured main Admin email is managed in Supabase. The database enforces at most one Admin profile.

Do not hard-code or store the Admin password in GitHub. Use Supabase Auth and Forgot Password for password recovery.

## Admin account management
The protected Edge Function `admin-manage-account` supports:
- create Staff Auth account + Staff database row
- change Patient/Staff password
- edit Patient/Staff name and email
- activate/deactivate Patient/Staff
- permanently delete the linked Patient/Staff Auth account and database records

The Edge Function validates the caller's current Supabase session and requires an active Admin profile before privileged actions.

## Password reset
The browser calls Supabase Auth `resetPasswordForEmail` and uses the current GitHub Pages path as the redirect. In Supabase Authentication URL Configuration, add the exact deployed GitHub Pages URL/path as an allowed redirect URL.

## Recent backend fixes
- Removed duplicate `legacy_id` indexes on appointments and announcements.
- Added indexes for foreign keys on activity logs, announcements, app settings, and appointments.
- Optimized the Staff availability RLS policy.
- Aligned the Admin bootstrap email to the configured account.
- Fixed the new-user patient-row trigger so it checks the actual `profiles.role` rather than trusting editable signup metadata.

## Security
- Never expose the Supabase secret/service-role key in HTML, JavaScript, GitHub, or screenshots.
- Use the publishable key for browser clients.
- Enable Supabase leaked-password protection.
- Use fake/test patient data until all account, appointment, Help Center, uploads, QR scanning, and multi-device workflows have been tested end-to-end.
