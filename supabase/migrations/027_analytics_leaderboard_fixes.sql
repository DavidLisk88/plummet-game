-- ════════════════════════════════════════════════════════════════════════
-- Migration 027: Analytics & Leaderboard Fixes (F1–F10 Threat Model)
--
-- F1  CRITICAL  get_player_analysis_data reads profiles.games_played (wrong)
-- F2  CRITICAL  get_my_rank() missing games_played field
-- F4  HIGH      Materialized views permanently stale — drop them
-- F6  MEDIUM    get_challenge_analysis_data reads archived game_scores_log
-- F9  LOW       Drop stale triggers if they survived
-- F10 LOW       Streak/delta calculations read archived game_scores_log
--
-- F3 (run migration 026) — separate manual step
-- F5 (client-side realtime handler fix) — in script.js
-- F7 (verified clean) — compute_profile_skill uses new tables already
-- F8 (add games_played to leaderboard display) — in get_leaderboard/get_my_rank
-- ════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  F9: Drop any surviving legacy triggers on game_scores_log          ║
-- ╚══════════════════════════════════════════════════════════════════════╝

DROP TRIGGER IF EXISTS trg_update_high_scores     ON game_scores_log;
DROP TRIGGER IF EXISTS trg_update_profile_stats   ON game_scores_log;
DROP TRIGGER IF EXISTS trg_update_challenge_stats  ON game_scores_log;
DROP TRIGGER IF EXISTS trg_update_category_stats   ON game_scores_log;
DROP TRIGGER IF EXISTS trg_update_ws_stats         ON game_scores_log;
DROP TRIGGER IF EXISTS trg_game_scores_refresh_mv  ON game_scores_log;
DROP TRIGGER IF EXISTS auto_ranking_trigger        ON game_scores_log;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  F4: Drop permanently stale materialized views                      ║
-- ║  These reference game_scores (renamed) and are never refreshed.     ║
-- ║  The live tables (leaderboard_rankings, profile_game_stats, etc)    ║
-- ║  are the authoritative source now.                                  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

DROP MATERIALIZED VIEW IF EXISTS mv_global_leaderboard CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_challenge_rankings CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_daily_active_stats CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_player_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_word_frequency CASCADE;

-- Drop the debounce table and function (no longer needed)
DROP TABLE IF EXISTS _mv_refresh_log CASCADE;
DROP FUNCTION IF EXISTS trigger_debounced_mv_refresh() CASCADE;
DROP FUNCTION IF EXISTS refresh_materialized_views() CASCADE;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  F2 + F8: Rewrite get_my_rank() to include games_played + high_score║
-- ║  Reads from profile_game_stats (authoritative).                     ║
-- ╚══════════════════════════════════════════════════════════════════════╝

DROP FUNCTION IF EXISTS get_my_rank();

CREATE OR REPLACE FUNCTION get_my_rank()
RETURNS TABLE (
    global_rank INTEGER,
    skill_class TEXT,
    class_rank INTEGER,
    skill_rating REAL,
    username TEXT,
    profile_id UUID,
    games_played INTEGER,
    high_score INTEGER,
    raw_score_component REAL,
    grid_mastery_component REAL,
    difficulty_component REAL,
    time_pressure_component REAL,
    challenge_component REAL,
    consistency_component REAL,
    versatility_component REAL,
    progression_component REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT lr.global_rank, lr.skill_class, lr.class_rank, lr.skill_rating,
           lr.username, lr.profile_id,
           COALESCE(pgs.games_played, 0)::INTEGER,
           COALESCE(pgs.high_score, 0)::INTEGER,
           lr.raw_score_component, lr.grid_mastery_component,
           lr.difficulty_component, lr.time_pressure_component, lr.challenge_component,
           lr.consistency_component, lr.versatility_component, lr.progression_component
    FROM leaderboard_rankings lr
    LEFT JOIN profile_game_stats pgs ON pgs.profile_id = lr.profile_id
    WHERE lr.account_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_my_rank() TO authenticated;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  F8: Rewrite get_leaderboard() to include games_played             ║
-- ║  Lets other players see game counts in the leaderboard list.       ║
-- ╚══════════════════════════════════════════════════════════════════════╝

DROP FUNCTION IF EXISTS get_leaderboard(INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION get_leaderboard(
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
    skill_rating REAL,
    games_played INTEGER,
    raw_score_component REAL,
    grid_mastery_component REAL,
    difficulty_component REAL,
    time_pressure_component REAL,
    challenge_component REAL,
    consistency_component REAL,
    versatility_component REAL,
    progression_component REAL,
    analysis_text TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT lr.global_rank, lr.profile_id, lr.username, lr.skill_class, lr.class_rank,
           lr.skill_rating,
           COALESCE(pgs.games_played, 0)::INTEGER,
           lr.raw_score_component, lr.grid_mastery_component,
           lr.difficulty_component, lr.time_pressure_component, lr.challenge_component,
           lr.consistency_component, lr.versatility_component, lr.progression_component,
           lr.analysis_text
    FROM leaderboard_rankings lr
    LEFT JOIN profile_game_stats pgs ON pgs.profile_id = lr.profile_id
    WHERE (p_class_filter IS NULL OR lr.skill_class = p_class_filter)
    ORDER BY lr.global_rank ASC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_leaderboard(INTEGER, INTEGER, TEXT) TO authenticated;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  F1 + F10: Rewrite get_player_analysis_data()                       ║
-- ║  - Reads games_played, high_score, total_words from                 ║
-- ║    profile_game_stats (authoritative) instead of profiles           ║
-- ║  - Uses profile_game_stats.game_history + recent_scores for         ║
-- ║    delta/streak instead of archived game_scores_log                  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION get_player_analysis_data(p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_pgs RECORD;
    v_skill RECORD;
    v_class TEXT;
    v_total_in_class INTEGER;
    v_percentiles JSONB;
    v_class_avgs JSONB;
    v_delta JSONB;
    v_notables JSONB;
    v_recent_avg REAL;
    v_older_avg REAL;
    v_recent_high INTEGER;
    v_all_time_high INTEGER;
    v_streak INTEGER := 0;
    v_improving BOOLEAN := FALSE;
    v_new_pb BOOLEAN := FALSE;
    v_total_games INTEGER;
    v_next_milestone INTEGER;
    v_games_to_milestone INTEGER;
    v_recent_scores JSONB;
    v_score_arr JSONB;
BEGIN
    -- Access control
    IF NOT EXISTS (
        SELECT 1 FROM leaderboard_rankings lr WHERE lr.profile_id = p_profile_id
    ) AND NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = p_profile_id AND account_id = auth.uid()
    ) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_profile FROM profiles WHERE id = p_profile_id;
    IF v_profile IS NULL THEN RETURN NULL; END IF;

    -- ══ READ FROM AUTHORITATIVE profile_game_stats ══
    SELECT * INTO v_pgs FROM profile_game_stats WHERE profile_id = p_profile_id;

    SELECT * INTO v_skill FROM compute_profile_skill(p_profile_id);
    v_class := v_skill.skill_class;

    -- Percentiles and class averages (kept from original)
    WITH class_players AS (
        SELECT ps.*
        FROM leaderboard_rankings lr
        JOIN profiles p ON p.id = lr.profile_id
        CROSS JOIN LATERAL compute_profile_skill(p.id) ps
        WHERE lr.skill_class = v_class
    )
    SELECT
        COUNT(*),
        jsonb_build_object(
            'raw_score', ROUND((COUNT(*) FILTER (WHERE cp.raw_score_component <= v_skill.raw_score_component)::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'grid_mastery', ROUND((COUNT(*) FILTER (WHERE cp.grid_mastery_component <= v_skill.grid_mastery_component)::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'difficulty', ROUND((COUNT(*) FILTER (WHERE cp.difficulty_component <= v_skill.difficulty_component)::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'time_pressure', ROUND((COUNT(*) FILTER (WHERE cp.time_pressure_component <= v_skill.time_pressure_component)::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'challenge', ROUND((COUNT(*) FILTER (WHERE cp.challenge_component <= v_skill.challenge_component)::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'consistency', ROUND((COUNT(*) FILTER (WHERE cp.consistency_component <= v_skill.consistency_component)::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'versatility', ROUND((COUNT(*) FILTER (WHERE cp.versatility_component <= v_skill.versatility_component)::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'progression', ROUND((COUNT(*) FILTER (WHERE cp.progression_component <= v_skill.progression_component)::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC)
        ),
        jsonb_build_object(
            'raw_score', ROUND(AVG(cp.raw_score_component)::NUMERIC, 1),
            'grid_mastery', ROUND(AVG(cp.grid_mastery_component)::NUMERIC, 1),
            'difficulty', ROUND(AVG(cp.difficulty_component)::NUMERIC, 1),
            'time_pressure', ROUND(AVG(cp.time_pressure_component)::NUMERIC, 1),
            'challenge', ROUND(AVG(cp.challenge_component)::NUMERIC, 1),
            'consistency', ROUND(AVG(cp.consistency_component)::NUMERIC, 1),
            'versatility', ROUND(AVG(cp.versatility_component)::NUMERIC, 1),
            'progression', ROUND(AVG(cp.progression_component)::NUMERIC, 1)
        )
    INTO v_total_in_class, v_percentiles, v_class_avgs
    FROM class_players cp;

    -- ══ F1: Use profile_game_stats for authoritative counts ══
    v_total_games := COALESCE(v_pgs.games_played, v_profile.games_played);
    v_all_time_high := COALESCE(v_pgs.high_score, v_profile.high_score);

    -- ══ F10: Compute delta and streak from profile_game_stats.recent_scores ══
    -- recent_scores is a JSONB array of the last 30 scores [newest, ..., oldest]
    v_score_arr := COALESCE(v_pgs.recent_scores, '[]'::JSONB);

    -- Recent avg (first 10 scores)
    SELECT COALESCE(AVG(s::REAL), 0) INTO v_recent_avg
    FROM (SELECT jsonb_array_elements(v_score_arr) AS s LIMIT 10) sub;

    -- Older avg (scores 11-20)
    SELECT COALESCE(AVG(s::REAL), 0) INTO v_older_avg
    FROM (SELECT s FROM (
        SELECT s, idx FROM jsonb_array_elements(v_score_arr) WITH ORDINALITY AS t(s, idx)
    ) q WHERE q.idx > 10 AND q.idx <= 20) sub;

    v_delta := jsonb_build_object(
        'score_change_pct', CASE WHEN v_older_avg > 0 THEN ROUND(((v_recent_avg - v_older_avg) / v_older_avg * 100)::NUMERIC, 1) ELSE 0 END,
        'words_change_pct', 0,  -- words delta not tracked in recent_scores
        'recent_avg', ROUND(v_recent_avg::NUMERIC, 1),
        'older_avg', ROUND(v_older_avg::NUMERIC, 1)
    );

    -- Recent high (first 5 scores)
    SELECT COALESCE(MAX(s::INTEGER), 0) INTO v_recent_high
    FROM (SELECT jsonb_array_elements(v_score_arr) AS s LIMIT 5) sub;

    v_new_pb := (v_recent_high > 0 AND v_recent_high >= v_all_time_high AND v_total_games > 5);

    -- Improvement streak: count consecutive games where each >= previous
    -- recent_scores: [newest, ..., oldest] → iterate checking s[i] >= s[i+1]
    SELECT COUNT(*) INTO v_streak
    FROM (
        SELECT s::INTEGER AS score,
               LEAD(s::INTEGER) OVER (ORDER BY idx) AS prev_score
        FROM (
            SELECT s, idx FROM jsonb_array_elements(v_score_arr) WITH ORDINALITY AS t(s, idx)
        ) q
        WHERE q.idx <= 6
    ) sub
    WHERE sub.prev_score IS NOT NULL AND sub.score >= sub.prev_score;

    v_improving := (v_streak >= 3);

    -- Milestones
    v_next_milestone := CASE
        WHEN v_total_games < 10 THEN 10
        WHEN v_total_games < 25 THEN 25
        WHEN v_total_games < 50 THEN 50
        WHEN v_total_games < 100 THEN 100
        WHEN v_total_games < 250 THEN 250
        WHEN v_total_games < 500 THEN 500
        WHEN v_total_games < 1000 THEN 1000
        ELSE NULL
    END;
    v_games_to_milestone := CASE WHEN v_next_milestone IS NOT NULL THEN v_next_milestone - v_total_games ELSE NULL END;

    v_notables := jsonb_build_object(
        'new_personal_best', v_new_pb,
        'improvement_streak', v_improving,
        'streak_length', v_streak,
        'next_milestone', v_next_milestone,
        'games_to_milestone', v_games_to_milestone
    );

    result := jsonb_build_object(
        'username', v_profile.username,
        'level', v_profile.level,
        'games_played', v_total_games,                   -- F1: from profile_game_stats
        'high_score', v_all_time_high,                   -- F1: from profile_game_stats
        'total_words', COALESCE(v_pgs.total_words, v_profile.total_words),
        'play_streak', COALESCE(v_profile.play_streak, 0),
        'skill_class', v_skill.skill_class,
        'skill_rating', v_skill.skill_rating,
        'components', jsonb_build_object(
            'raw_score', v_skill.raw_score_component,
            'grid_mastery', v_skill.grid_mastery_component,
            'difficulty', v_skill.difficulty_component,
            'time_pressure', v_skill.time_pressure_component,
            'challenge', v_skill.challenge_component,
            'consistency', v_skill.consistency_component,
            'versatility', v_skill.versatility_component,
            'progression', v_skill.progression_component
        ),
        'percentiles', COALESCE(v_percentiles, '{}'::JSONB),
        'class_averages', COALESCE(v_class_avgs, '{}'::JSONB),
        'players_in_class', COALESCE(v_total_in_class, 0),
        'delta', v_delta,
        'notables', v_notables
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_player_analysis_data(UUID) TO authenticated;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  F6: Rewrite get_challenge_analysis_data()                          ║
-- ║  Reads from new aggregate tables instead of archived game_scores_log║
-- ╚══════════════════════════════════════════════════════════════════════╝

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

    -- ══ Read stats from the correct NEW aggregate table per challenge type ══
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

        -- Get recent_scores from the first (or largest) grid row
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
        -- Unknown challenge type
        v_total_games := 0; v_high_score := 0; v_total_words := 0;
        v_best_combo := 0; v_avg_score := 0; v_score_stddev := 0;
        v_score_arr := '[]'::JSONB;
    END IF;

    -- Default if null
    v_score_arr := COALESCE(v_score_arr, '[]'::JSONB);

    -- Recent trend: avg of first 5 − avg of 6–10
    SELECT COALESCE(
        (SELECT AVG(s::REAL) FROM (
            SELECT jsonb_array_elements(v_score_arr) AS s LIMIT 5
        ) r)
        -
        (SELECT AVG(s::REAL) FROM (
            SELECT s FROM (
                SELECT s, idx FROM jsonb_array_elements(v_score_arr) WITH ORDINALITY AS t(s, idx)
            ) q WHERE q.idx > 5 AND q.idx <= 10
        ) o)
    , 0) INTO v_recent_trend;

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
        'recent_trend', ROUND(COALESCE(v_recent_trend, 0)::NUMERIC, 1),
        'recent_scores', COALESCE(v_recent_scores, '[]'::JSONB)
    );

    -- Challenge-type-specific enrichments from new aggregate tables
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
        result := result || jsonb_build_object(
            'avg_words_per_minute', 0,  -- not easily derivable from aggregates
            'best_words_in_game', COALESCE((
                SELECT MAX(t.best_longest_word)
                FROM challenge_speed_round_stats t WHERE t.profile_id = p_profile_id
            ), 0)
        );
    END IF;

    IF p_challenge_type = 'word-category' THEN
        result := result || jsonb_build_object(
            'avg_category_words', CASE WHEN COALESCE(v_total_games, 0) > 0
                THEN ROUND((COALESCE(v_total_words, 0)::REAL / v_total_games)::NUMERIC, 1)
                ELSE 0 END,
            'best_category_words', COALESCE((
                SELECT MAX(t.best_longest_word)
                FROM challenge_word_category_stats t WHERE t.profile_id = p_profile_id
            ), 0)
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


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  ONE-TIME FIX: Sync profiles.games_played from profile_game_stats   ║
-- ║  This corrects the 99 vs 92 discrepancy on the profiles table.      ║
-- ╚══════════════════════════════════════════════════════════════════════╝

UPDATE profiles p SET
    games_played = GREATEST(p.games_played, COALESCE(pgs.games_played, p.games_played)),
    high_score   = GREATEST(p.high_score, COALESCE(pgs.high_score, p.high_score)),
    total_words  = GREATEST(p.total_words, COALESCE(pgs.total_words, p.total_words))
FROM profile_game_stats pgs
WHERE pgs.profile_id = p.id
  AND (pgs.games_played > p.games_played
    OR pgs.high_score > p.high_score
    OR pgs.total_words > p.total_words);
