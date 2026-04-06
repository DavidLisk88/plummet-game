-- ============================================================
-- PLUMMET — RLS Lockdown for Materialized Views & Refresh Log
-- Migration 009: Restrict direct access to materialized views
-- ============================================================
--
-- Materialized views don't support RLS natively, so we:
--   1. REVOKE direct SELECT on all MVs from public/anon/authenticated
--   2. Wrapper functions (008) with SECURITY DEFINER remain the only access path
--   3. Enable RLS on _mv_refresh_log and restrict to service_role
--

-- ─── REVOKE direct SELECT on materialized views ───
REVOKE SELECT ON mv_global_leaderboard FROM anon, authenticated, public;
REVOKE SELECT ON mv_challenge_rankings FROM anon, authenticated, public;
REVOKE SELECT ON mv_daily_active_stats FROM anon, authenticated, public;
REVOKE SELECT ON mv_player_summary FROM anon, authenticated, public;
REVOKE SELECT ON mv_word_frequency FROM anon, authenticated, public;

-- ─── Protect the refresh log table ───
ALTER TABLE _mv_refresh_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE _mv_refresh_log FORCE ROW LEVEL SECURITY;

-- No policies = no direct access from anon/authenticated.
-- Only SECURITY DEFINER functions (trigger_debounced_mv_refresh, refresh_materialized_views)
-- can read/write this table since they run as the owner.

-- ─── Revoke direct DML on refresh log ───
REVOKE ALL ON _mv_refresh_log FROM anon, authenticated, public;
