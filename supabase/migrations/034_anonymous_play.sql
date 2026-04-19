-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 034 — Anonymous play support                             ║
-- ║                                                                      ║
-- ║  Allow users to play without signing up. Uses Supabase anonymous     ║
-- ║  auth — anonymous users get a real auth.uid() so existing RLS        ║
-- ║  policies work unchanged. When they sign up later, their anonymous   ║
-- ║  account is promoted to a real account (same UUID, no data loss).    ║
-- ║                                                                      ║
-- ║  Changes:                                                            ║
-- ║    1. accounts.email becomes nullable (anon users have no email)     ║
-- ║    2. Drop unique index on email, recreate as partial unique         ║
-- ║       (unique only when email IS NOT NULL)                           ║
-- ║                                                                      ║
-- ║  REQUIRED Supabase Dashboard settings (Auth → Settings):            ║
-- ║    • "Allow anonymous sign-ins" → ON                                 ║
-- ║    • "Enable manual linking" → ON                                    ║
-- ║    • "Secure email change" → OFF                                     ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- 1. Make email nullable for anonymous accounts
ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;

-- 2. Replace the strict unique constraint with a partial unique index
--    (allows multiple rows with NULL email, but real emails stay unique)
DROP INDEX IF EXISTS idx_accounts_email;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_email_key;
CREATE UNIQUE INDEX idx_accounts_email_unique ON accounts(email) WHERE email IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- MAINTENANCE: Run this periodically to clean up abandoned anonymous users.
-- Anonymous users who never converted and haven't played in 30+ days.
-- DO NOT include in the migration — run manually or via a cron/pg_cron job.
-- ════════════════════════════════════════════════════════════════════════
-- DELETE FROM auth.users
-- WHERE is_anonymous IS TRUE
--   AND created_at < NOW() - INTERVAL '30 days';
