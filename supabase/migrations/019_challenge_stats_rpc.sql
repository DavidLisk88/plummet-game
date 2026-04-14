-- ============================================================
-- PLUMMET — Dedicated challenge stats upsert RPC
-- Migration 019: SECURITY DEFINER function for safe challenge stats sync.
--
-- Root cause fix: upsertChallengeStats was failing silently on every
-- client call because profile_challenge_stats has no INSERT/UPDATE RLS
-- policies — only SELECT. This meant target_word_level was never
-- persisted mid-game, and the fallback record_game_and_sync_profile RPC
-- was the only path that worked (only at game end).
--
-- This migration adds a dedicated SECURITY DEFINER function
-- `upsert_challenge_stats` that any authenticated user can call to
-- safely write their own challenge progression, with GREATEST guarantees
-- so levels can never decrease.
-- ============================================================

CREATE OR REPLACE FUNCTION upsert_challenge_stats(
    p_profile_id       UUID,
    p_challenge_type   TEXT,
    p_high_score       INTEGER DEFAULT 0,
    p_games_played     INTEGER DEFAULT 0,
    p_total_words      INTEGER DEFAULT 0,
    p_target_word_level INTEGER DEFAULT 1,
    p_unique_words     TEXT[]  DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account_id UUID;
BEGIN
    -- Verify the caller owns this profile.
    SELECT account_id INTO v_account_id
    FROM profiles
    WHERE id = p_profile_id;

    IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'Profile not found: %', p_profile_id;
    END IF;

    IF auth.uid() IS DISTINCT FROM v_account_id THEN
        RAISE EXCEPTION 'Not authorized to update profile %', p_profile_id;
    END IF;

    -- Safe upsert: GREATEST on every monotonic column so progress can
    -- never go backwards regardless of call order.
    INSERT INTO profile_challenge_stats (
        profile_id,
        challenge_type,
        high_score,
        games_played,
        total_words,
        target_word_level,
        unique_words_found,
        updated_at
    )
    VALUES (
        p_profile_id,
        p_challenge_type,
        p_high_score,
        p_games_played,
        p_total_words,
        p_target_word_level,
        p_unique_words,
        NOW()
    )
    ON CONFLICT (profile_id, challenge_type)
    DO UPDATE SET
        high_score        = GREATEST(profile_challenge_stats.high_score,        EXCLUDED.high_score),
        games_played      = GREATEST(profile_challenge_stats.games_played,      EXCLUDED.games_played),
        total_words       = GREATEST(profile_challenge_stats.total_words,       EXCLUDED.total_words),
        target_word_level = GREATEST(profile_challenge_stats.target_word_level, EXCLUDED.target_word_level),
        unique_words_found = ARRAY(
            SELECT DISTINCT w
            FROM unnest(profile_challenge_stats.unique_words_found || EXCLUDED.unique_words_found) AS w
        ),
        updated_at = NOW();

    RETURN jsonb_build_object('ok', true, 'target_word_level', p_target_word_level);
END;
$$;

-- Restrict access: only authenticated users (callers proved ownership above).
REVOKE ALL ON FUNCTION upsert_challenge_stats(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION upsert_challenge_stats(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT[]) TO authenticated;
