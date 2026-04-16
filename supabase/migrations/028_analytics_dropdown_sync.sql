-- ════════════════════════════════════════════════════════════════════════
-- Migration 028: Analytics Dropdown Sync Fixes (T1–T6 Threat Model)
--
-- T1 CRITICAL  Rating in dropdown ≠ leaderboard rating (formula vs ratcheted)
-- T2 HIGH      Level stale in DB (client-authoritative, record_game ignores it)
-- T3 HIGH      skill_class mismatch (dropdown live compute vs stored in LR)
-- T4 MEDIUM    "X in Class" shows count not rank
-- T5 MEDIUM    Percentile CTE calls compute_profile_skill N times (slow + wrong class)
-- T6 LOW       Client analysis cache (5 min) — fixed client-side
--
-- FIX: Rewrite get_player_analysis_data() to read authoritative values
--      from leaderboard_rankings (rating, class, rank, components) instead
--      of recomputing them.  Add p_level/p_total_xp to record_game()
--      so the server can write profiles.level.
-- ════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  T1 + T3 + T4 + T5: Rewrite get_player_analysis_data()             ║
-- ║  Read rating, class, rank, components from leaderboard_rankings     ║
-- ║  (the same source as the leaderboard entry row).                    ║
-- ║  Percentiles computed from stored LR components — no N+1 queries.   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION get_player_analysis_data(p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_pgs RECORD;
    v_lr RECORD;         -- leaderboard_rankings row (authoritative)
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

    -- ══ READ FROM AUTHORITATIVE SOURCES ══
    SELECT * INTO v_pgs FROM profile_game_stats WHERE profile_id = p_profile_id;

    -- T1+T3: Read rating, class, rank, components from leaderboard_rankings
    -- This is the SAME source that populates the leaderboard entry row.
    SELECT * INTO v_lr FROM leaderboard_rankings WHERE profile_id = p_profile_id;

    -- Use stored class from leaderboard_rankings (matches what the entry row shows)
    v_class := COALESCE(v_lr.skill_class, 'low');

    -- ══ T5: Percentiles from STORED component values (no N+1 compute calls) ══
    WITH class_players AS (
        SELECT lr.raw_score_component, lr.grid_mastery_component,
               lr.difficulty_component, lr.time_pressure_component,
               lr.challenge_component, lr.consistency_component,
               lr.versatility_component, lr.progression_component
        FROM leaderboard_rankings lr
        WHERE lr.skill_class = v_class
    )
    SELECT
        COUNT(*),
        jsonb_build_object(
            'raw_score',     ROUND((COUNT(*) FILTER (WHERE cp.raw_score_component     <= COALESCE(v_lr.raw_score_component, 0))::REAL     / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'grid_mastery',  ROUND((COUNT(*) FILTER (WHERE cp.grid_mastery_component  <= COALESCE(v_lr.grid_mastery_component, 0))::REAL  / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'difficulty',    ROUND((COUNT(*) FILTER (WHERE cp.difficulty_component    <= COALESCE(v_lr.difficulty_component, 0))::REAL    / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'time_pressure', ROUND((COUNT(*) FILTER (WHERE cp.time_pressure_component <= COALESCE(v_lr.time_pressure_component, 0))::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'challenge',     ROUND((COUNT(*) FILTER (WHERE cp.challenge_component     <= COALESCE(v_lr.challenge_component, 0))::REAL     / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'consistency',   ROUND((COUNT(*) FILTER (WHERE cp.consistency_component   <= COALESCE(v_lr.consistency_component, 0))::REAL   / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'versatility',   ROUND((COUNT(*) FILTER (WHERE cp.versatility_component   <= COALESCE(v_lr.versatility_component, 0))::REAL   / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'progression',   ROUND((COUNT(*) FILTER (WHERE cp.progression_component   <= COALESCE(v_lr.progression_component, 0))::REAL   / GREATEST(COUNT(*), 1) * 100)::NUMERIC)
        ),
        jsonb_build_object(
            'raw_score',     ROUND(AVG(cp.raw_score_component)::NUMERIC, 1),
            'grid_mastery',  ROUND(AVG(cp.grid_mastery_component)::NUMERIC, 1),
            'difficulty',    ROUND(AVG(cp.difficulty_component)::NUMERIC, 1),
            'time_pressure', ROUND(AVG(cp.time_pressure_component)::NUMERIC, 1),
            'challenge',     ROUND(AVG(cp.challenge_component)::NUMERIC, 1),
            'consistency',   ROUND(AVG(cp.consistency_component)::NUMERIC, 1),
            'versatility',   ROUND(AVG(cp.versatility_component)::NUMERIC, 1),
            'progression',   ROUND(AVG(cp.progression_component)::NUMERIC, 1)
        )
    INTO v_total_in_class, v_percentiles, v_class_avgs
    FROM class_players cp;

    -- ══ Games + high score from profile_game_stats (authoritative) ══
    v_total_games := COALESCE(v_pgs.games_played, v_profile.games_played);
    v_all_time_high := COALESCE(v_pgs.high_score, v_profile.high_score);

    -- ══ Delta and streak from profile_game_stats.recent_scores ══
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
        'words_change_pct', 0,
        'recent_avg', ROUND(v_recent_avg::NUMERIC, 1),
        'older_avg', ROUND(v_older_avg::NUMERIC, 1)
    );

    -- Recent high (first 5 scores)
    SELECT COALESCE(MAX(s::INTEGER), 0) INTO v_recent_high
    FROM (SELECT jsonb_array_elements(v_score_arr) AS s LIMIT 5) sub;

    v_new_pb := (v_recent_high > 0 AND v_recent_high >= v_all_time_high AND v_total_games > 5);

    -- Improvement streak
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
        'games_played', v_total_games,
        'high_score', v_all_time_high,
        'total_words', COALESCE(v_pgs.total_words, v_profile.total_words),
        'play_streak', COALESCE(v_profile.play_streak, 0),
        -- T1: Use stored leaderboard rating (matches entry row)
        'skill_class', v_class,
        'skill_rating', COALESCE(v_lr.skill_rating, COALESCE(v_pgs.skill_rating, 0)),
        -- T4: Include class_rank so client can show "#X of Y in Class"
        'class_rank', COALESCE(v_lr.class_rank, 0),
        -- T1: Use stored components from leaderboard_rankings
        'components', jsonb_build_object(
            'raw_score',     COALESCE(v_lr.raw_score_component, 0),
            'grid_mastery',  COALESCE(v_lr.grid_mastery_component, 0),
            'difficulty',    COALESCE(v_lr.difficulty_component, 0),
            'time_pressure', COALESCE(v_lr.time_pressure_component, 0),
            'challenge',     COALESCE(v_lr.challenge_component, 0),
            'consistency',   COALESCE(v_lr.consistency_component, 0),
            'versatility',   COALESCE(v_lr.versatility_component, 0),
            'progression',   COALESCE(v_lr.progression_component, 0)
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
-- ║  T2: Add level + total_xp to record_game() so server keeps         ║
-- ║  profiles.level in sync. The client already computes level from XP  ║
-- ║  and sends it; the server just writes it to profiles.               ║
-- ║                                                                     ║
-- ║  We need to DROP first because we're adding new parameters.         ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Drop the old signature (all 24 params from migration 026)
DROP FUNCTION IF EXISTS record_game(
    UUID, TEXT, BOOLEAN, TEXT, TEXT,
    INTEGER, TEXT, INTEGER, INTEGER, INTEGER,
    INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
    INTEGER, INTEGER, REAL, REAL, REAL,
    INTEGER, INTEGER, BOOLEAN, REAL
);

CREATE OR REPLACE FUNCTION record_game(
    p_profile_id             UUID,
    p_game_mode              TEXT,
    p_is_challenge           BOOLEAN,
    p_challenge_type         TEXT,
    p_category_key           TEXT,
    p_grid_size              INTEGER,
    p_difficulty             TEXT,
    p_time_limit_seconds     INTEGER,
    p_score                  INTEGER,
    p_words_found            INTEGER,
    p_longest_word_length    INTEGER,
    p_best_combo             INTEGER,
    p_target_words_completed INTEGER DEFAULT 0,
    p_bonus_words_completed  INTEGER DEFAULT 0,
    p_time_remaining_seconds INTEGER DEFAULT NULL,
    p_xp_earned              INTEGER DEFAULT 0,
    p_coins_earned           INTEGER DEFAULT 0,
    p_grid_factor            REAL DEFAULT 1.0,
    p_difficulty_multiplier  REAL DEFAULT 1.0,
    p_mode_multiplier        REAL DEFAULT 1.0,
    p_ws_placed_words        INTEGER DEFAULT NULL,
    p_ws_level               INTEGER DEFAULT NULL,
    p_ws_is_perfect_clear    BOOLEAN DEFAULT FALSE,
    p_ws_clear_seconds       REAL DEFAULT NULL,
    -- T2: New params for server-side level sync
    p_level                  INTEGER DEFAULT NULL,
    p_total_xp               INTEGER DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_account_id UUID;
    v_is_new_high BOOLEAN := FALSE;
    v_time_limit_min INTEGER;
    v_time_used INTEGER;
    v_completion_rate REAL;
    v_game_entry JSONB;
    v_new_profile_skill REAL;
    v_min_bump REAL;
    v_max_bump REAL;
    v_perf_score REAL;
BEGIN
    -- Verify ownership
    SELECT account_id INTO v_account_id
    FROM profiles WHERE id = p_profile_id;
    IF v_account_id IS NULL OR v_account_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
    END IF;

    -- ════════════════════════════════════════════════════════════════
    -- SECURITY: Clamp all numeric inputs to sane ranges
    -- ════════════════════════════════════════════════════════════════
    p_score                  := LEAST(GREATEST(p_score, 0), 100000);
    p_words_found            := LEAST(GREATEST(p_words_found, 0), 5000);
    p_longest_word_length    := LEAST(GREATEST(p_longest_word_length, 0), 50);
    p_best_combo             := LEAST(GREATEST(p_best_combo, 0), 500);
    p_target_words_completed := LEAST(GREATEST(COALESCE(p_target_words_completed, 0), 0), 500);
    p_bonus_words_completed  := LEAST(GREATEST(COALESCE(p_bonus_words_completed, 0), 0), 500);
    p_xp_earned              := LEAST(GREATEST(COALESCE(p_xp_earned, 0), 0), 50000);
    p_coins_earned           := LEAST(GREATEST(COALESCE(p_coins_earned, 0), 0), 10000);
    p_grid_factor            := LEAST(GREATEST(COALESCE(p_grid_factor, 1.0), 0.1), 10.0);
    p_difficulty_multiplier  := LEAST(GREATEST(COALESCE(p_difficulty_multiplier, 1.0), 0.1), 10.0);
    p_mode_multiplier        := LEAST(GREATEST(COALESCE(p_mode_multiplier, 1.0), 0.1), 10.0);
    IF p_time_remaining_seconds IS NOT NULL THEN
        p_time_remaining_seconds := LEAST(GREATEST(p_time_remaining_seconds, 0), 7200);
    END IF;
    -- T2: Clamp level and xp
    IF p_level IS NOT NULL THEN
        p_level := LEAST(GREATEST(p_level, 1), 500);
    END IF;
    IF p_total_xp IS NOT NULL THEN
        p_total_xp := LEAST(GREATEST(p_total_xp, 0), 100000000);
    END IF;

    -- Build game_history entry (compact keys)
    v_game_entry := jsonb_build_object(
        't', EXTRACT(EPOCH FROM NOW())::BIGINT,
        's', p_score,
        'w', p_words_found,
        'c', p_best_combo,
        'x', p_xp_earned
    );
    IF p_is_challenge AND p_challenge_type = 'target-word' THEN
        v_game_entry := v_game_entry || jsonb_build_object('tw', COALESCE(p_target_words_completed, 0));
    ELSIF p_is_challenge AND p_challenge_type = 'word-category' THEN
        v_game_entry := v_game_entry || jsonb_build_object('bw', COALESCE(p_bonus_words_completed, 0));
    ELSIF p_is_challenge AND p_challenge_type = 'word-search' THEN
        v_game_entry := v_game_entry || jsonb_build_object('lv', COALESCE(p_ws_level, 1), 'pc', p_ws_is_perfect_clear);
    ELSIF NOT p_is_challenge THEN
        v_game_entry := v_game_entry || jsonb_build_object('lwl', p_longest_word_length);
    END IF;

    -- ════════════════════════════════════════════════════════════════
    -- A. UPSERT dimension-specific aggregate table + game_history
    -- ════════════════════════════════════════════════════════════════

    IF p_is_challenge AND p_challenge_type = 'target-word' THEN
        INSERT INTO challenge_target_word_stats (
            profile_id, grid_size, games_played, high_score, total_score,
            total_words, avg_score, best_combo, best_longest_word,
            sum_score_squared, score_variance, recent_scores,
            target_word_level, total_targets_completed, best_targets_in_game,
            total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 6), 1, p_score, p_score,
            p_words_found, p_score, p_best_combo, p_longest_word_length,
            p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
            1 + COALESCE(p_target_words_completed, 0), COALESCE(p_target_words_completed, 0),
            COALESCE(p_target_words_completed, 0),
            p_xp_earned, p_coins_earned, jsonb_build_array(v_game_entry), NOW()
        )
        ON CONFLICT (profile_id, grid_size) DO UPDATE SET
            games_played    = challenge_target_word_stats.games_played + 1,
            high_score      = GREATEST(challenge_target_word_stats.high_score, p_score),
            total_score     = challenge_target_word_stats.total_score + p_score,
            total_words     = challenge_target_word_stats.total_words + p_words_found,
            avg_score       = (challenge_target_word_stats.total_score + p_score)::REAL / (challenge_target_word_stats.games_played + 1),
            best_combo      = GREATEST(challenge_target_word_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(challenge_target_word_stats.best_longest_word, p_longest_word_length),
            sum_score_squared = challenge_target_word_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_target_word_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_target_word_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_target_word_stats.games_played + 1))
                     - POWER((challenge_target_word_stats.total_score + p_score)::REAL / (challenge_target_word_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_target_word_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            target_word_level = 1 + challenge_target_word_stats.total_targets_completed + COALESCE(p_target_words_completed, 0),
            total_targets_completed = challenge_target_word_stats.total_targets_completed + COALESCE(p_target_words_completed, 0),
            best_targets_in_game = GREATEST(challenge_target_word_stats.best_targets_in_game, COALESCE(p_target_words_completed, 0)),
            total_xp_earned = challenge_target_word_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_target_word_stats.total_coins_earned + p_coins_earned,
            game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || challenge_target_word_stats.game_history) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 50) sub),
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'speed-round' THEN
        v_time_used := COALESCE(p_time_limit_seconds, 0) - COALESCE(p_time_remaining_seconds, 0);
        INSERT INTO challenge_speed_round_stats (
            profile_id, grid_size, games_played, high_score, total_score,
            total_words, avg_score, best_combo, best_longest_word,
            sum_score_squared, score_variance, recent_scores,
            total_time_seconds, avg_words_per_minute,
            total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 5), 1, p_score, p_score,
            p_words_found, p_score, p_best_combo, p_longest_word_length,
            p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
            v_time_used,
            CASE WHEN v_time_used > 0 THEN (p_words_found::REAL / v_time_used * 60) ELSE 0 END,
            p_xp_earned, p_coins_earned, jsonb_build_array(v_game_entry), NOW()
        )
        ON CONFLICT (profile_id, grid_size) DO UPDATE SET
            games_played    = challenge_speed_round_stats.games_played + 1,
            high_score      = GREATEST(challenge_speed_round_stats.high_score, p_score),
            total_score     = challenge_speed_round_stats.total_score + p_score,
            total_words     = challenge_speed_round_stats.total_words + p_words_found,
            avg_score       = (challenge_speed_round_stats.total_score + p_score)::REAL / (challenge_speed_round_stats.games_played + 1),
            best_combo      = GREATEST(challenge_speed_round_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(challenge_speed_round_stats.best_longest_word, p_longest_word_length),
            sum_score_squared = challenge_speed_round_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_speed_round_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_speed_round_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_speed_round_stats.games_played + 1))
                     - POWER((challenge_speed_round_stats.total_score + p_score)::REAL / (challenge_speed_round_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_speed_round_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            total_time_seconds = challenge_speed_round_stats.total_time_seconds + v_time_used,
            avg_words_per_minute = CASE WHEN (challenge_speed_round_stats.total_time_seconds + v_time_used) > 0
                THEN ((challenge_speed_round_stats.total_words + p_words_found)::REAL / (challenge_speed_round_stats.total_time_seconds + v_time_used) * 60)
                ELSE 0 END,
            total_xp_earned = challenge_speed_round_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_speed_round_stats.total_coins_earned + p_coins_earned,
            game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || challenge_speed_round_stats.game_history) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 50) sub),
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'word-category' THEN
        INSERT INTO challenge_word_category_stats (
            profile_id, category_key, games_played, high_score, total_score,
            total_words, avg_score, best_combo, best_longest_word,
            sum_score_squared, score_variance, recent_scores,
            total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_category_key, 'unknown'), 1, p_score, p_score,
            p_words_found, p_score, p_best_combo, p_longest_word_length,
            p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
            p_xp_earned, p_coins_earned, jsonb_build_array(v_game_entry), NOW()
        )
        ON CONFLICT (profile_id, category_key) DO UPDATE SET
            games_played    = challenge_word_category_stats.games_played + 1,
            high_score      = GREATEST(challenge_word_category_stats.high_score, p_score),
            total_score     = challenge_word_category_stats.total_score + p_score,
            total_words     = challenge_word_category_stats.total_words + p_words_found,
            avg_score       = (challenge_word_category_stats.total_score + p_score)::REAL / (challenge_word_category_stats.games_played + 1),
            best_combo      = GREATEST(challenge_word_category_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(challenge_word_category_stats.best_longest_word, p_longest_word_length),
            sum_score_squared = challenge_word_category_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_word_category_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_word_category_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_word_category_stats.games_played + 1))
                     - POWER((challenge_word_category_stats.total_score + p_score)::REAL / (challenge_word_category_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_word_category_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            total_xp_earned = challenge_word_category_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_word_category_stats.total_coins_earned + p_coins_earned,
            game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || challenge_word_category_stats.game_history) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 50) sub),
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'word-search' THEN
        v_completion_rate := CASE WHEN COALESCE(p_ws_placed_words, 0) > 0
            THEN LEAST(1.0, p_words_found::REAL / p_ws_placed_words)
            ELSE 0 END;
        INSERT INTO challenge_word_search_stats (
            profile_id, games_played, high_score, total_score, total_words,
            avg_score, best_combo, sum_score_squared, score_variance,
            recent_scores, highest_level_reached,
            avg_completion_rate, perfect_clears, avg_time_efficiency,
            total_bonus_words, best_bonus_words_single,
            total_placed_words, fastest_clear_seconds,
            total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, 1, p_score, p_score, p_words_found,
            p_score, COALESCE(p_best_combo, 0), p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score), COALESCE(p_ws_level, 1),
            v_completion_rate,
            CASE WHEN p_ws_is_perfect_clear THEN 1 ELSE 0 END,
            CASE WHEN COALESCE(p_time_limit_seconds, 0) > 0
                THEN (COALESCE(p_time_limit_seconds, 0) - COALESCE(p_time_remaining_seconds, 0))::REAL / p_time_limit_seconds
                ELSE 0 END,
            COALESCE(p_bonus_words_completed, 0),
            COALESCE(p_bonus_words_completed, 0),
            COALESCE(p_ws_placed_words, 0),
            CASE WHEN p_ws_is_perfect_clear THEN p_ws_clear_seconds ELSE NULL END,
            p_xp_earned, p_coins_earned, jsonb_build_array(v_game_entry), NOW()
        )
        ON CONFLICT (profile_id) DO UPDATE SET
            games_played    = challenge_word_search_stats.games_played + 1,
            high_score      = GREATEST(challenge_word_search_stats.high_score, p_score),
            total_score     = challenge_word_search_stats.total_score + p_score,
            total_words     = challenge_word_search_stats.total_words + p_words_found,
            avg_score       = (challenge_word_search_stats.total_score + p_score)::REAL / (challenge_word_search_stats.games_played + 1),
            best_combo      = GREATEST(challenge_word_search_stats.best_combo, COALESCE(p_best_combo, 0)),
            sum_score_squared = challenge_word_search_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_word_search_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_word_search_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_word_search_stats.games_played + 1))
                     - POWER((challenge_word_search_stats.total_score + p_score)::REAL / (challenge_word_search_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_word_search_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            highest_level_reached = GREATEST(challenge_word_search_stats.highest_level_reached, COALESCE(p_ws_level, 1)),
            avg_completion_rate = (challenge_word_search_stats.avg_completion_rate * challenge_word_search_stats.games_played + v_completion_rate) / (challenge_word_search_stats.games_played + 1),
            perfect_clears  = challenge_word_search_stats.perfect_clears + CASE WHEN p_ws_is_perfect_clear THEN 1 ELSE 0 END,
            avg_time_efficiency = CASE WHEN COALESCE(p_time_limit_seconds, 0) > 0
                THEN (challenge_word_search_stats.avg_time_efficiency * challenge_word_search_stats.games_played
                      + (COALESCE(p_time_limit_seconds, 0) - COALESCE(p_time_remaining_seconds, 0))::REAL / p_time_limit_seconds)
                     / (challenge_word_search_stats.games_played + 1)
                ELSE challenge_word_search_stats.avg_time_efficiency END,
            total_bonus_words = challenge_word_search_stats.total_bonus_words + COALESCE(p_bonus_words_completed, 0),
            best_bonus_words_single = GREATEST(challenge_word_search_stats.best_bonus_words_single, COALESCE(p_bonus_words_completed, 0)),
            total_placed_words = challenge_word_search_stats.total_placed_words + COALESCE(p_ws_placed_words, 0),
            fastest_clear_seconds = CASE
                WHEN p_ws_is_perfect_clear AND p_ws_clear_seconds IS NOT NULL
                THEN LEAST(COALESCE(challenge_word_search_stats.fastest_clear_seconds, p_ws_clear_seconds), p_ws_clear_seconds)
                ELSE challenge_word_search_stats.fastest_clear_seconds END,
            total_xp_earned = challenge_word_search_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_word_search_stats.total_coins_earned + p_coins_earned,
            game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || challenge_word_search_stats.game_history) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 50) sub),
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'word-runner' THEN
        INSERT INTO challenge_word_runner_stats (
            profile_id, games_played, high_score, total_score, total_words,
            avg_score, best_combo, sum_score_squared, score_variance,
            recent_scores, best_distance,
            total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, 1, p_score, p_score, p_words_found,
            p_score, p_best_combo, p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score), p_score,
            p_xp_earned, p_coins_earned, jsonb_build_array(v_game_entry), NOW()
        )
        ON CONFLICT (profile_id) DO UPDATE SET
            games_played    = challenge_word_runner_stats.games_played + 1,
            high_score      = GREATEST(challenge_word_runner_stats.high_score, p_score),
            total_score     = challenge_word_runner_stats.total_score + p_score,
            total_words     = challenge_word_runner_stats.total_words + p_words_found,
            avg_score       = (challenge_word_runner_stats.total_score + p_score)::REAL / (challenge_word_runner_stats.games_played + 1),
            best_combo      = GREATEST(challenge_word_runner_stats.best_combo, p_best_combo),
            sum_score_squared = challenge_word_runner_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_word_runner_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_word_runner_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_word_runner_stats.games_played + 1))
                     - POWER((challenge_word_runner_stats.total_score + p_score)::REAL / (challenge_word_runner_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_word_runner_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            best_distance   = GREATEST(challenge_word_runner_stats.best_distance, p_score),
            total_xp_earned = challenge_word_runner_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_word_runner_stats.total_coins_earned + p_coins_earned,
            game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || challenge_word_runner_stats.game_history) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 50) sub),
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF NOT p_is_challenge AND (p_time_limit_seconds IS NULL OR p_time_limit_seconds <= 0) THEN
        -- SANDBOX (untimed)
        INSERT INTO sandbox_grid_stats (
            profile_id, grid_size, difficulty, games_played,
            high_score, total_score, total_words, avg_score,
            best_combo, best_longest_word, sum_score_squared, score_variance,
            recent_scores, total_xp_earned, total_coins_earned,
            game_history, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 5), COALESCE(p_difficulty, 'casual'),
            1, p_score, p_score, p_words_found, p_score, p_best_combo,
            p_longest_word_length, p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score),
            p_xp_earned, p_coins_earned, jsonb_build_array(v_game_entry), NOW()
        )
        ON CONFLICT (profile_id, grid_size, difficulty) DO UPDATE SET
            games_played    = sandbox_grid_stats.games_played + 1,
            high_score      = GREATEST(sandbox_grid_stats.high_score, p_score),
            total_score     = sandbox_grid_stats.total_score + p_score,
            total_words     = sandbox_grid_stats.total_words + p_words_found,
            avg_score       = (sandbox_grid_stats.total_score + p_score)::REAL / (sandbox_grid_stats.games_played + 1),
            best_combo      = GREATEST(sandbox_grid_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(sandbox_grid_stats.best_longest_word, p_longest_word_length),
            sum_score_squared = sandbox_grid_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN sandbox_grid_stats.games_played + 1 > 1
                THEN GREATEST(0, ((sandbox_grid_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (sandbox_grid_stats.games_played + 1))
                     - POWER((sandbox_grid_stats.total_score + p_score)::REAL / (sandbox_grid_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || sandbox_grid_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            total_xp_earned = sandbox_grid_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = sandbox_grid_stats.total_coins_earned + p_coins_earned,
            game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || sandbox_grid_stats.game_history) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 50) sub),
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF NOT p_is_challenge AND p_time_limit_seconds IS NOT NULL AND p_time_limit_seconds > 0 THEN
        -- TIMED
        v_time_limit_min := ROUND(p_time_limit_seconds / 60.0)::INTEGER;
        INSERT INTO timed_grid_stats (
            profile_id, time_limit_minutes, grid_size, difficulty,
            games_played, high_score, total_score, total_words, avg_score,
            best_combo, best_longest_word, best_time_remaining,
            sum_score_squared, score_variance, recent_scores,
            total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, v_time_limit_min, COALESCE(p_grid_size, 5),
            COALESCE(p_difficulty, 'casual'),
            1, p_score, p_score, p_words_found, p_score, p_best_combo,
            p_longest_word_length, COALESCE(p_time_remaining_seconds, 0),
            p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
            p_xp_earned, p_coins_earned, jsonb_build_array(v_game_entry), NOW()
        )
        ON CONFLICT (profile_id, time_limit_minutes, grid_size, difficulty) DO UPDATE SET
            games_played    = timed_grid_stats.games_played + 1,
            high_score      = GREATEST(timed_grid_stats.high_score, p_score),
            total_score     = timed_grid_stats.total_score + p_score,
            total_words     = timed_grid_stats.total_words + p_words_found,
            avg_score       = (timed_grid_stats.total_score + p_score)::REAL / (timed_grid_stats.games_played + 1),
            best_combo      = GREATEST(timed_grid_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(timed_grid_stats.best_longest_word, p_longest_word_length),
            best_time_remaining = GREATEST(timed_grid_stats.best_time_remaining, COALESCE(p_time_remaining_seconds, 0)),
            sum_score_squared = timed_grid_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN timed_grid_stats.games_played + 1 > 1
                THEN GREATEST(0, ((timed_grid_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (timed_grid_stats.games_played + 1))
                     - POWER((timed_grid_stats.total_score + p_score)::REAL / (timed_grid_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || timed_grid_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            total_xp_earned = timed_grid_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = timed_grid_stats.total_coins_earned + p_coins_earned,
            game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || timed_grid_stats.game_history) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 50) sub),
            last_played_at  = NOW(),
            updated_at      = NOW();
    END IF;

    -- ════════════════════════════════════════════════════════════════
    -- B. UPSERT profile_game_stats (global per-profile aggregate)
    -- ════════════════════════════════════════════════════════════════
    INSERT INTO profile_game_stats (
        profile_id, games_played, high_score, total_score, total_words,
        avg_score, best_combo, best_longest_word, sum_score_squared,
        score_variance, recent_scores, total_xp_earned, total_coins_earned,
        game_history, last_played_at
    ) VALUES (
        p_profile_id, 1, p_score, p_score, p_words_found,
        p_score, p_best_combo, p_longest_word_length,
        p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
        p_xp_earned, p_coins_earned, jsonb_build_array(v_game_entry), NOW()
    )
    ON CONFLICT (profile_id) DO UPDATE SET
        games_played    = profile_game_stats.games_played + 1,
        high_score      = GREATEST(profile_game_stats.high_score, p_score),
        total_score     = profile_game_stats.total_score + p_score,
        total_words     = profile_game_stats.total_words + p_words_found,
        avg_score       = (profile_game_stats.total_score + p_score)::REAL / (profile_game_stats.games_played + 1),
        best_combo      = GREATEST(profile_game_stats.best_combo, p_best_combo),
        best_longest_word = GREATEST(profile_game_stats.best_longest_word, p_longest_word_length),
        sum_score_squared = profile_game_stats.sum_score_squared + p_score::BIGINT * p_score,
        score_variance  = CASE WHEN profile_game_stats.games_played + 1 > 1
            THEN GREATEST(0, ((profile_game_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (profile_game_stats.games_played + 1))
                 - POWER((profile_game_stats.total_score + p_score)::REAL / (profile_game_stats.games_played + 1), 2))
            ELSE 0 END,
        recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
            SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || profile_game_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
            WHERE idx <= 30) sub),
        total_xp_earned = profile_game_stats.total_xp_earned + p_xp_earned,
        total_coins_earned = profile_game_stats.total_coins_earned + p_coins_earned,
        game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
            SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || profile_game_stats.game_history) WITH ORDINALITY AS t(elem, idx)
            WHERE idx <= 50) sub),
        last_played_at  = NOW(),
        updated_at      = NOW();

    -- Check if new high score
    SELECT (p_score >= pgs.high_score) INTO v_is_new_high
    FROM profile_game_stats pgs WHERE pgs.profile_id = p_profile_id;

    -- ════════════════════════════════════════════════════════════════
    -- C. Keep profiles in sync (for MVs + general compat)
    -- ════════════════════════════════════════════════════════════════
    UPDATE profiles SET
        games_played = profiles.games_played + 1,
        high_score = GREATEST(profiles.high_score, p_score),
        total_words = profiles.total_words + p_words_found,
        -- T2: Update level + total_xp if client sends them (monotonic — only goes up)
        level = CASE WHEN p_level IS NOT NULL THEN GREATEST(profiles.level, p_level) ELSE profiles.level END,
        total_xp = CASE WHEN p_total_xp IS NOT NULL THEN GREATEST(profiles.total_xp, p_total_xp) ELSE profiles.total_xp END,
        updated_at = NOW()
    WHERE id = p_profile_id;

    -- ════════════════════════════════════════════════════════════════
    -- D. Compute + store monotonic skill_rating on profile_game_stats
    --    with PERFORMANCE-SCALED bump per game mode
    -- ════════════════════════════════════════════════════════════════
    BEGIN
        v_min_bump := CASE
            WHEN p_is_challenge AND p_challenge_type = 'speed-round'    THEN 1.5
            WHEN p_is_challenge AND p_challenge_type = 'target-word'    THEN 1.0
            WHEN p_is_challenge AND p_challenge_type = 'word-search'    THEN 1.0
            WHEN p_is_challenge AND p_challenge_type = 'word-runner'    THEN 1.0
            WHEN p_is_challenge AND p_challenge_type = 'word-category'  THEN 0.8
            WHEN p_game_mode = 'timed'                                  THEN 0.5
            ELSE 0.1
        END;

        v_max_bump := CASE
            WHEN p_is_challenge AND p_challenge_type = 'speed-round'    THEN 30.0
            WHEN p_is_challenge AND p_challenge_type = 'target-word'    THEN 25.0
            WHEN p_is_challenge AND p_challenge_type = 'word-search'    THEN 25.0
            WHEN p_is_challenge AND p_challenge_type = 'word-runner'    THEN 25.0
            WHEN p_is_challenge AND p_challenge_type = 'word-category'  THEN 20.0
            WHEN p_game_mode = 'timed'                                  THEN 15.0
            ELSE 10.0
        END;

        v_perf_score := LEAST(1.0, GREATEST(0.0,
            (COALESCE(p_score, 0)::REAL / GREATEST(5000, 1)
             + COALESCE(p_xp_earned, 0)::REAL / GREATEST(500, 1)
             + COALESCE(p_coins_earned, 0)::REAL / GREATEST(200, 1)
            ) / 3.0
        ));

        v_min_bump := v_min_bump + v_perf_score * (v_max_bump - v_min_bump);

        SELECT ps.skill_rating INTO v_new_profile_skill
        FROM compute_profile_skill(p_profile_id) ps;

        UPDATE profile_game_stats SET
            skill_rating = GREATEST(
                profile_game_stats.skill_rating + v_min_bump,
                COALESCE(v_new_profile_skill, 0)
            ),
            updated_at = NOW()
        WHERE profile_id = p_profile_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'record_game: profile skill update failed for %: %', p_profile_id, SQLERRM;
    END;

    -- ════════════════════════════════════════════════════════════════
    -- E. Recompute leaderboard rankings (monotonic via ratchet)
    -- ════════════════════════════════════════════════════════════════
    BEGIN
        PERFORM update_ranking_for_account(v_account_id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'record_game: ranking update failed for %: %', v_account_id, SQLERRM;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'games_played', (SELECT pgs.games_played FROM profile_game_stats pgs WHERE pgs.profile_id = p_profile_id),
        'high_score', (SELECT pgs.high_score FROM profile_game_stats pgs WHERE pgs.profile_id = p_profile_id),
        'total_words', (SELECT pgs.total_words FROM profile_game_stats pgs WHERE pgs.profile_id = p_profile_id),
        'skill_rating', (SELECT pgs.skill_rating FROM profile_game_stats pgs WHERE pgs.profile_id = p_profile_id),
        'is_new_high_score', COALESCE(v_is_new_high, false)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'record_game failed for profile %: %', p_profile_id, SQLERRM;
    RETURN jsonb_build_object('success', false, 'error', 'internal_error');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
