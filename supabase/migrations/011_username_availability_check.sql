-- ============================================================
-- Migration 011: Username availability check (bypasses RLS)
-- ============================================================
-- RLS on profiles restricts SELECT to account_id = auth.uid(),
-- so a normal client query can only see the current user's profiles.
-- This SECURITY DEFINER function sees ALL profiles to enforce
-- global username uniqueness.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_username_available(
    p_username TEXT,
    p_exclude_profile_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
    -- Reject empty, too long, or non-alphanumeric names at the DB level too
    IF p_username IS NULL OR LENGTH(TRIM(p_username)) = 0 THEN
        RETURN FALSE;
    END IF;
    IF LENGTH(p_username) > 20 THEN
        RETURN FALSE;
    END IF;
    IF p_username !~ '^[A-Za-z0-9_]+$' THEN
        RETURN FALSE;
    END IF;

    RETURN NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE LOWER(username) = LOWER(p_username)
          AND (p_exclude_profile_id IS NULL OR id != p_exclude_profile_id)
    );
END;
$func$;

-- Grant execute to authenticated users only
GRANT EXECUTE ON FUNCTION check_username_available(TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION check_username_available(TEXT, UUID) FROM anon;

-- ============================================================
-- Cascade username changes to leaderboard tables + refresh MVs
-- ============================================================
-- leaderboard_rankings and challenge_leaderboards store a denormalized
-- copy of username. This trigger keeps them in sync when a profile is renamed.

CREATE OR REPLACE FUNCTION public.cascade_username_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
    IF NEW.username IS DISTINCT FROM OLD.username THEN
        -- Update denormalized username in leaderboard tables
        UPDATE leaderboard_rankings
           SET username = NEW.username
         WHERE profile_id = NEW.id;

        UPDATE challenge_leaderboards
           SET username = NEW.username
         WHERE profile_id = NEW.id;

        -- Refresh materialized views (they also cache usernames)
        PERFORM refresh_materialized_views();
    END IF;
    RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_profile_username_cascade ON profiles;
CREATE TRIGGER trg_profile_username_cascade
    AFTER UPDATE OF username ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION cascade_username_change();
