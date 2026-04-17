-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 030 — Fix challenge analytics across all leaderboards    ║
-- ║                                                                      ║
-- ║  FIXES:                                                              ║
-- ║  1. Speed-round column mismatch in record_game (028 vs 021)         ║
-- ║  2. Speed-round WPM hardcoded to 0 in get_challenge_analysis_data   ║
-- ║  3. Word-category missing category_breakdown in analysis data       ║
-- ║  4. recent_trend is raw diff but UI expects ratio (0.0–2.0)         ║
-- ╚══════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════════
-- PART 1: Fix speed-round table columns for record_game compatibility
-- ════════════════════════════════════════════════════════════════════════

-- 1a. Rename total_time_used_seconds → total_time_seconds (idempotent)
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'challenge_speed_round_stats'
          AND column_name = 'total_time_used_seconds'
    ) THEN
        ALTER TABLE challenge_speed_round_stats
            RENAME COLUMN total_time_used_seconds TO total_time_seconds;
    END IF;
END $$;

-- 1b. Add the missing avg_words_per_minute column (idempotent)
ALTER TABLE challenge_speed_round_stats
    ADD COLUMN IF NOT EXISTS avg_words_per_minute REAL NOT NULL DEFAULT 0;


-- ════════════════════════════════════════════════════════════════════════
-- PART 2: Replace get_challenge_analysis_data with fixed version
--   - Speed-round: read avg_words_per_minute from table (no longer 0)
--   - Word-category: add category_breakdown array
--   - recent_trend: compute as ratio (recent_avg / older_avg) not raw diff
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_challenge_analysis_data(
    p_profile_id UUID,
    p_challenge_type TEXT
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_cl RECORD;
    v_recent_scores JSONB;
    v_avg_score REAL;
    v_score_stddev REAL;
    v_best_combo INTEGER;
    v_total_games INTEGER;
    v_high_score INTEGER;
    v_total_words INTEGER;
    v_recent_trend REAL;
    v_score_arr JSONB;
    v_recent_avg REAL;
    v_older_avg REAL;
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

    SELECT * INTO v_cl
    FROM challenge_leaderboards
    WHERE profile_id = p_profile_id AND challenge_type = p_challenge_type;

    -- ══ Read stats from the correct aggregate table per challenge type ══
    IF p_challenge_type = 'target-word' THEN
        SELECT COALESCE(SUM(t.games_played), 0)::INTEGER,
               COALESCE(MAX(t.high_score), 0)::INTEGER,
               COALESCE(SUM(t.total_words), 0)::INTEGER,
               COALESCE(MAX(t.best_combo), 0)::INTEGER,
               CASE WHEN SUM(t.games_played) > 0
                    THEN (SUM(t.total_score)::REAL / SUM(t.games_played))
                    ELSE 0 END,
               CASE WHEN SUM(t.games_played) > 1
                    THEN SQRT(GREATEST(0,
                        SUM(t.sum_score_squared)::REAL / SUM(t.games_played)
                        - POWER(SUM(t.total_score)::REAL / SUM(t.games_played), 2)))
                    ELSE 0 END
        INTO v_total_games, v_high_score, v_total_words, v_best_combo, v_avg_score, v_score_stddev
        FROM challenge_target_word_stats t WHERE t.profile_id = p_profile_id;

        SELECT COALESCE(t.recent_scores, '[]'::JSONB) INTO v_score_arr
        FROM challenge_target_word_stats t
        WHERE t.profile_id = p_profile_id
        ORDER BY t.games_played DESC LIMIT 1;

    ELSIF p_challenge_type = 'speed-round' THEN
        SELECT COALESCE(SUM(t.games_played), 0)::INTEGER,
               COALESCE(MAX(t.high_score), 0)::INTEGER,
               COALESCE(SUM(t.total_words), 0)::INTEGER,
               COALESCE(MAX(t.best_combo), 0)::INTEGER,
               CASE WHEN SUM(t.games_played) > 0
                    THEN (SUM(t.total_score)::REAL / SUM(t.games_played))
                    ELSE 0 END,
               CASE WHEN SUM(t.games_played) > 1
                    THEN SQRT(GREATEST(0,
                        SUM(t.sum_score_squared)::REAL / SUM(t.games_played)
                        - POWER(SUM(t.total_score)::REAL / SUM(t.games_played), 2)))
                    ELSE 0 END
        INTO v_total_games, v_high_score, v_total_words, v_best_combo, v_avg_score, v_score_stddev
        FROM challenge_speed_round_stats t WHERE t.profile_id = p_profile_id;

        SELECT COALESCE(t.recent_scores, '[]'::JSONB) INTO v_score_arr
        FROM challenge_speed_round_stats t
        WHERE t.profile_id = p_profile_id
        ORDER BY t.games_played DESC LIMIT 1;

    ELSIF p_challenge_type = 'word-category' THEN
        SELECT COALESCE(SUM(t.games_played), 0)::INTEGER,
               COALESCE(MAX(t.high_score), 0)::INTEGER,
               COALESCE(SUM(t.total_words), 0)::INTEGER,
               COALESCE(MAX(t.best_combo), 0)::INTEGER,
               CASE WHEN SUM(t.games_played) > 0
                    THEN (SUM(t.total_score)::REAL / SUM(t.games_played))
                    ELSE 0 END,
               CASE WHEN SUM(t.games_played) > 1
                    THEN SQRT(GREATEST(0,
                        SUM(t.sum_score_squared)::REAL / SUM(t.games_played)
                        - POWER(SUM(t.total_score)::REAL / SUM(t.games_played), 2)))
                    ELSE 0 END
        INTO v_total_games, v_high_score, v_total_words, v_best_combo, v_avg_score, v_score_stddev
        FROM challenge_word_category_stats t WHERE t.profile_id = p_profile_id;

        SELECT COALESCE(t.recent_scores, '[]'::JSONB) INTO v_score_arr
        FROM challenge_word_category_stats t
        WHERE t.profile_id = p_profile_id
        ORDER BY t.games_played DESC LIMIT 1;

    ELSIF p_challenge_type = 'word-search' THEN
        SELECT COALESCE(t.games_played, 0)::INTEGER,
               COALESCE(t.high_score, 0)::INTEGER,
               COALESCE(t.total_words, 0)::INTEGER,
               COALESCE(t.best_combo, 0)::INTEGER,
               COALESCE(t.avg_score, 0),
               SQRT(GREATEST(0, COALESCE(t.score_variance, 0)))
        INTO v_total_games, v_high_score, v_total_words, v_best_combo, v_avg_score, v_score_stddev
        FROM challenge_word_search_stats t WHERE t.profile_id = p_profile_id;

        SELECT COALESCE(t.recent_scores, '[]'::JSONB) INTO v_score_arr
        FROM challenge_word_search_stats t WHERE t.profile_id = p_profile_id;

    ELSIF p_challenge_type = 'word-runner' THEN
        SELECT COALESCE(t.games_played, 0)::INTEGER,
               COALESCE(t.high_score, 0)::INTEGER,
               COALESCE(t.total_words, 0)::INTEGER,
               COALESCE(t.best_combo, 0)::INTEGER,
               COALESCE(t.avg_score, 0),
               SQRT(GREATEST(0, COALESCE(t.score_variance, 0)))
        INTO v_total_games, v_high_score, v_total_words, v_best_combo, v_avg_score, v_score_stddev
        FROM challenge_word_runner_stats t WHERE t.profile_id = p_profile_id;

        SELECT COALESCE(t.recent_scores, '[]'::JSONB) INTO v_score_arr
        FROM challenge_word_runner_stats t WHERE t.profile_id = p_profile_id;

    ELSE
        v_total_games := 0; v_high_score := 0; v_total_words := 0;
        v_best_combo := 0; v_avg_score := 0; v_score_stddev := 0;
        v_score_arr := '[]'::JSONB;
    END IF;

    v_score_arr := COALESCE(v_score_arr, '[]'::JSONB);

    -- ══ Recent trend as RATIO (recent_avg / older_avg) ══
    -- Returns ~1.0 for steady, >1.0 for improving, <1.0 for declining
    -- UI checks: > 1.1 (strong upward), >= 0.9 (steady), < 0.9 (dipping)
    SELECT COALESCE(AVG(s::REAL), 0) INTO v_recent_avg
    FROM (SELECT jsonb_array_elements(v_score_arr) AS s LIMIT 5) sub;

    SELECT COALESCE(AVG(s::REAL), 0) INTO v_older_avg
    FROM (SELECT s FROM (
        SELECT s, idx FROM jsonb_array_elements(v_score_arr) WITH ORDINALITY AS t(s, idx)
    ) q WHERE q.idx > 5 AND q.idx <= 10) sub;

    v_recent_trend := CASE
        WHEN v_older_avg > 0 THEN v_recent_avg / v_older_avg
        WHEN v_recent_avg > 0 THEN 1.1  -- has recent scores but no older ones → slight positive
        ELSE 1.0
    END;

    -- Recent scores for UI chart (up to 20)
    SELECT COALESCE(jsonb_agg(s), '[]'::JSONB) INTO v_recent_scores
    FROM (SELECT jsonb_array_elements(v_score_arr) AS s LIMIT 20) sub;

    result := jsonb_build_object(
        'username', v_profile.username,
        'level', v_profile.level,
        'challenge_type', p_challenge_type,
        'skill_rating', COALESCE(v_cl.challenge_skill_rating, 0),
        'skill_class', COALESCE(v_cl.skill_class, 'low'),
        'global_rank', COALESCE(v_cl.global_rank, 0),
        'high_score', COALESCE(v_high_score, 0),
        'games_played', COALESCE(v_total_games, 0),
        'total_words', COALESCE(v_total_words, 0),
        'avg_score', ROUND(COALESCE(v_avg_score, 0)::NUMERIC, 1),
        'score_consistency', CASE
            WHEN v_avg_score > 0 THEN ROUND((1 - LEAST(1, COALESCE(v_score_stddev, 0) / GREATEST(v_avg_score, 1)))::NUMERIC, 2)
            ELSE 0
        END,
        'best_combo', COALESCE(v_best_combo, 0),
        'avg_words_per_game', CASE WHEN COALESCE(v_total_games, 0) > 0
            THEN ROUND((COALESCE(v_total_words, 0)::REAL / v_total_games)::NUMERIC, 1) ELSE 0 END,
        'recent_trend', ROUND(COALESCE(v_recent_trend, 1.0)::NUMERIC, 2),
        'recent_scores', COALESCE(v_recent_scores, '[]'::JSONB)
    );

    -- ══ Challenge-type-specific enrichments ══

    IF p_challenge_type = 'target-word' THEN
        result := result || jsonb_build_object(
            'target_word_level', COALESCE((
                SELECT MAX(t.target_word_level)
                FROM challenge_target_word_stats t WHERE t.profile_id = p_profile_id
            ), 1),
            'avg_targets_per_game', COALESCE((
                SELECT ROUND((SUM(t.total_targets_completed)::REAL / GREATEST(SUM(t.games_played), 1))::NUMERIC, 1)
                FROM challenge_target_word_stats t WHERE t.profile_id = p_profile_id
            ), 0),
            'best_targets_in_game', COALESCE((
                SELECT MAX(t.best_targets_in_game)
                FROM challenge_target_word_stats t WHERE t.profile_id = p_profile_id
            ), 0)
        );
    END IF;

    IF p_challenge_type = 'speed-round' THEN
        -- FIX: Read actual avg_words_per_minute from table (populated by record_game)
        -- Weighted average across grid sizes: SUM(total_words) / SUM(total_time_seconds) * 60
        result := result || jsonb_build_object(
            'avg_words_per_minute', COALESCE((
                SELECT CASE WHEN SUM(t.total_time_seconds) > 0
                    THEN ROUND((SUM(t.total_words)::REAL / SUM(t.total_time_seconds) * 60)::NUMERIC, 1)
                    ELSE 0 END
                FROM challenge_speed_round_stats t WHERE t.profile_id = p_profile_id
            ), 0),
            'best_words_in_game', COALESCE((
                SELECT MAX(t.best_longest_word)
                FROM challenge_speed_round_stats t WHERE t.profile_id = p_profile_id
            ), 0)
        );
    END IF;

    IF p_challenge_type = 'word-category' THEN
        -- FIX: Add category_breakdown array for UI category grid
        result := result || jsonb_build_object(
            'avg_category_words', CASE WHEN COALESCE(v_total_games, 0) > 0
                THEN ROUND((COALESCE(v_total_words, 0)::REAL / v_total_games)::NUMERIC, 1)
                ELSE 0 END,
            'best_category_words', COALESCE((
                SELECT MAX(t.best_longest_word)
                FROM challenge_word_category_stats t WHERE t.profile_id = p_profile_id
            ), 0),
            'category_breakdown', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'category', t.category_key,
                    'games', t.total_games,
                    'high_score', t.max_high_score,
                    'best_words', t.max_category_words
                ) ORDER BY t.total_games DESC)
                FROM (
                    SELECT category_key,
                           SUM(games_played)::INTEGER AS total_games,
                           MAX(high_score)::INTEGER AS max_high_score,
                           MAX(best_category_words_per_game)::INTEGER AS max_category_words
                    FROM challenge_word_category_stats
                    WHERE profile_id = p_profile_id
                    GROUP BY category_key
                ) t
            ), '[]'::JSONB)
        );
    END IF;

    IF p_challenge_type = 'word-runner' THEN
        result := result || jsonb_build_object(
            'avg_distance', ROUND(COALESCE(v_avg_score, 0)::NUMERIC, 1),
            'best_distance', COALESCE(v_high_score, 0)
        );
    END IF;

    IF p_challenge_type = 'word-search' THEN
        result := result || jsonb_build_object(
            'word_search', (
                SELECT jsonb_build_object(
                    'games_played', COALESCE(ws.games_played, 0),
                    'avg_completion_rate', COALESCE(ws.avg_completion_rate, 0),
                    'perfect_clear_rate', CASE
                        WHEN COALESCE(ws.games_played, 0) > 0
                        THEN ROUND((COALESCE(ws.perfect_clears, 0)::REAL / ws.games_played)::NUMERIC, 3)
                        ELSE 0
                    END,
                    'avg_time_efficiency', COALESCE(ws.avg_time_efficiency, 0),
                    'highest_level', COALESCE(ws.highest_level_reached, 1),
                    'total_bonus_words', COALESCE(ws.total_bonus_words, 0)
                )
                FROM challenge_word_search_stats ws
                WHERE ws.profile_id = p_profile_id
            )
        );
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_challenge_analysis_data(UUID, TEXT) TO authenticated;
