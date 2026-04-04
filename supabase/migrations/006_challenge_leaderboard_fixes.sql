-- ============================================================
-- MIGRATION 006: Fix Challenge Leaderboards
-- ============================================================
-- ROOT CAUSES ADDRESSED:
--   1. get_challenge_leaderboard() returned 'challenge_skill_rating' but
--      frontend reads 'skill_rating' → all ratings showed 0
--   2. get_challenge_leaderboard() didn't return games_played
--   3. No RPC to get my rank per challenge type (always showed main rank)
--   4. No per-challenge analysis data RPC (all analyses were identical)
-- ============================================================

-- ────────────────────────────────────────
-- 1. FIX get_challenge_leaderboard: alias field names + add games_played
-- ────────────────────────────────────────
DROP FUNCTION IF EXISTS get_challenge_leaderboard(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_challenge_leaderboard(TEXT, INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION get_challenge_leaderboard(
    p_challenge_type TEXT,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0,
    p_class_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
    global_rank INTEGER,
    profile_id UUID,
    username TEXT,
    skill_class TEXT,
    class_rank INTEGER,
    skill_rating REAL,          -- was: challenge_skill_rating → frontend expects this name
    high_score INTEGER,
    games_played INTEGER,       -- was: missing
    analysis_text TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT cl.global_rank, cl.profile_id, cl.username, cl.skill_class, cl.class_rank,
           cl.challenge_skill_rating AS skill_rating,
           cl.high_score,
           cl.games_played,
           cl.analysis_text
    FROM challenge_leaderboards cl
    WHERE cl.challenge_type = p_challenge_type
      AND (p_class_filter IS NULL OR cl.skill_class = p_class_filter)
    ORDER BY cl.global_rank ASC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 2. NEW RPC: get_my_challenge_rank(challenge_type)
--    Returns the caller's rank on a specific challenge leaderboard
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_challenge_rank(p_challenge_type TEXT)
RETURNS TABLE (
    global_rank INTEGER,
    skill_class TEXT,
    class_rank INTEGER,
    skill_rating REAL,
    username TEXT,
    high_score INTEGER,
    games_played INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT cl.global_rank, cl.skill_class, cl.class_rank,
           cl.challenge_skill_rating AS skill_rating,
           cl.username, cl.high_score, cl.games_played
    FROM challenge_leaderboards cl
    WHERE cl.account_id = auth.uid()
      AND cl.challenge_type = p_challenge_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 3. NEW RPC: get_challenge_analysis_data(profile_id, challenge_type)
--    Returns challenge-specific data for generating per-challenge analysis
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_challenge_analysis_data(
    p_profile_id UUID,
    p_challenge_type TEXT
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_cl RECORD;
    v_cs RECORD;
    v_recent_scores JSONB;
    v_avg_score REAL;
    v_score_stddev REAL;
    v_best_combo INTEGER;
    v_avg_words REAL;
    v_total_games INTEGER;
    v_recent_trend REAL;
BEGIN
    -- Access control: must be on a leaderboard or own profile
    IF NOT EXISTS (
        SELECT 1 FROM challenge_leaderboards WHERE profile_id = p_profile_id
        UNION ALL
        SELECT 1 FROM profiles WHERE id = p_profile_id AND account_id = auth.uid()
    ) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_profile FROM profiles WHERE id = p_profile_id;
    IF v_profile IS NULL THEN RETURN NULL; END IF;

    -- Get challenge leaderboard row
    SELECT * INTO v_cl
    FROM challenge_leaderboards
    WHERE profile_id = p_profile_id AND challenge_type = p_challenge_type;

    -- Get challenge stats
    SELECT * INTO v_cs
    FROM profile_challenge_stats
    WHERE profile_id = p_profile_id AND challenge_type = p_challenge_type;

    -- Compute stats from recent games for this challenge type
    SELECT
        COALESCE(AVG(gs.score), 0),
        COALESCE(STDDEV(gs.score), 0),
        COALESCE(MAX(gs.best_combo), 0),
        COALESCE(AVG(gs.words_found), 0),
        COUNT(*)::INTEGER
    INTO v_avg_score, v_score_stddev, v_best_combo, v_avg_words, v_total_games
    FROM game_scores gs
    WHERE gs.profile_id = p_profile_id
      AND gs.challenge_type = p_challenge_type
      AND gs.is_challenge = TRUE;

    -- Trend: compare last 5 games avg to the 5 before that
    SELECT COALESCE(
        (SELECT AVG(s) FROM (
            SELECT gs.score as s FROM game_scores gs
            WHERE gs.profile_id = p_profile_id AND gs.challenge_type = p_challenge_type AND gs.is_challenge = TRUE
            ORDER BY gs.played_at DESC LIMIT 5
        ) recent)
        -
        (SELECT AVG(s) FROM (
            SELECT gs.score as s FROM game_scores gs
            WHERE gs.profile_id = p_profile_id AND gs.challenge_type = p_challenge_type AND gs.is_challenge = TRUE
            ORDER BY gs.played_at DESC LIMIT 5 OFFSET 5
        ) older)
    , 0) INTO v_recent_trend;

    -- Recent scores for sparkline / analysis
    SELECT COALESCE(jsonb_agg(t.score ORDER BY t.played_at DESC), '[]'::JSONB)
    INTO v_recent_scores
    FROM (
        SELECT gs.score, gs.played_at
        FROM game_scores gs
        WHERE gs.profile_id = p_profile_id
          AND gs.challenge_type = p_challenge_type
          AND gs.is_challenge = TRUE
        ORDER BY gs.played_at DESC
        LIMIT 20
    ) t;

    -- Build challenge-type-specific fields
    result := jsonb_build_object(
        'username', v_profile.username,
        'level', v_profile.level,
        'challenge_type', p_challenge_type,
        'skill_rating', COALESCE(v_cl.challenge_skill_rating, 0),
        'skill_class', COALESCE(v_cl.skill_class, 'low'),
        'global_rank', COALESCE(v_cl.global_rank, 0),
        'high_score', COALESCE(v_cs.high_score, 0),
        'games_played', COALESCE(v_cs.games_played, 0),
        'total_words', COALESCE(v_cs.total_words, 0),
        'avg_score', ROUND(v_avg_score::NUMERIC, 1),
        'score_consistency', CASE
            WHEN v_avg_score > 0 THEN ROUND((1 - LEAST(1, v_score_stddev / GREATEST(v_avg_score, 1)))::NUMERIC, 2)
            ELSE 0
        END,
        'best_combo', v_best_combo,
        'avg_words_per_game', ROUND(v_avg_words::NUMERIC, 1),
        'recent_trend', ROUND(v_recent_trend::NUMERIC, 1),
        'recent_scores', v_recent_scores
    );

    -- Add target-word-specific fields
    IF p_challenge_type = 'target-word' THEN
        result := result || jsonb_build_object(
            'target_word_level', COALESCE(v_cs.target_word_level, 1),
            'avg_targets_per_game', (
                SELECT ROUND(COALESCE(AVG(gs.target_words_completed), 0)::NUMERIC, 1)
                FROM game_scores gs
                WHERE gs.profile_id = p_profile_id
                  AND gs.challenge_type = 'target-word' AND gs.is_challenge = TRUE
            ),
            'best_targets_in_game', (
                SELECT COALESCE(MAX(gs.target_words_completed), 0)
                FROM game_scores gs
                WHERE gs.profile_id = p_profile_id
                  AND gs.challenge_type = 'target-word' AND gs.is_challenge = TRUE
            )
        );
    END IF;

    -- Add speed-round-specific fields
    IF p_challenge_type = 'speed-round' THEN
        result := result || jsonb_build_object(
            'avg_words_per_minute', (
                SELECT ROUND(COALESCE(AVG(gs.words_found::REAL / GREATEST(1, (COALESCE(gs.time_limit_seconds, 180) - COALESCE(gs.time_remaining_seconds, 0))) * 60), 0)::NUMERIC, 2)
                FROM game_scores gs
                WHERE gs.profile_id = p_profile_id
                  AND gs.challenge_type = 'speed-round' AND gs.is_challenge = TRUE
            ),
            'best_words_in_game', (
                SELECT COALESCE(MAX(gs.words_found), 0)
                FROM game_scores gs
                WHERE gs.profile_id = p_profile_id
                  AND gs.challenge_type = 'speed-round' AND gs.is_challenge = TRUE
            )
        );
    END IF;

    -- Add word-category-specific fields
    IF p_challenge_type = 'word-category' THEN
        result := result || jsonb_build_object(
            'avg_category_words', (
                SELECT ROUND(COALESCE(AVG(gs.bonus_words_completed), 0)::NUMERIC, 1)
                FROM game_scores gs
                WHERE gs.profile_id = p_profile_id
                  AND gs.challenge_type = 'word-category' AND gs.is_challenge = TRUE
            ),
            'best_category_words', (
                SELECT COALESCE(MAX(gs.bonus_words_completed), 0)
                FROM game_scores gs
                WHERE gs.profile_id = p_profile_id
                  AND gs.challenge_type = 'word-category' AND gs.is_challenge = TRUE
            ),
            'category_breakdown', (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'category', cat.category_key,
                    'games', cat.games_played,
                    'high_score', cat.high_score,
                    'best_words', cat.best_category_words_per_game
                )), '[]'::JSONB)
                FROM profile_category_stats cat
                WHERE cat.profile_id = p_profile_id
            )
        );
    END IF;

    -- Add word-search-specific fields
    IF p_challenge_type = 'word-search' THEN
        result := result || COALESCE(get_ws_stats(p_profile_id), '{}'::JSONB);
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
