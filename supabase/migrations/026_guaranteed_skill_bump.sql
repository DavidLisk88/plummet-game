-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 026: Guaranteed minimum skill increase per game             ║
-- ║                                                                        ║
-- ║  Every game played MUST increase the skill rating, even if only        ║
-- ║  slightly. The minimum bump depends on game mode:                      ║
-- ║    Sandbox:       +0.1  (casual, untimed — tiny nudge)                 ║
-- ║    Timed:         +0.5                                                 ║
-- ║    Word Category: +0.8                                                 ║
-- ║    Target Word:   +1.0                                                 ║
-- ║    Word Search:   +1.0                                                 ║
-- ║    Word Runner:   +1.0                                                 ║
-- ║    Speed Round:   +1.5  (hardest challenge — biggest reward)           ║
-- ║                                                                        ║
-- ║  Also fixes update_ranking_for_account to use the bumped               ║
-- ║  profile_game_stats.skill_rating as a floor.                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════
-- PART 1: Replace record_game with guaranteed bump in ratchet
-- ════════════════════════════════════════

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
    p_ws_clear_seconds       REAL DEFAULT NULL
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
    v_min_bump REAL;           -- ← NEW: guaranteed minimum bump per game
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
    ELSIF p_is_challenge AND p_challenge_type = 'speed-round' THEN
        v_game_entry := v_game_entry || jsonb_build_object('tr', COALESCE(p_time_remaining_seconds, 0));
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
            total_time_used_seconds, best_words_in_game,
            total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 6), 1, p_score, p_score,
            p_words_found, p_score, p_best_combo, p_longest_word_length,
            p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
            GREATEST(0, v_time_used), p_words_found,
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
            total_time_used_seconds = challenge_speed_round_stats.total_time_used_seconds + GREATEST(0, v_time_used),
            best_words_in_game = GREATEST(challenge_speed_round_stats.best_words_in_game, p_words_found),
            total_xp_earned = challenge_speed_round_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_speed_round_stats.total_coins_earned + p_coins_earned,
            game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || challenge_speed_round_stats.game_history) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 50) sub),
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'word-category' THEN
        INSERT INTO challenge_word_category_stats (
            profile_id, grid_size, category_key,
            games_played, high_score, total_score, total_words, avg_score,
            best_combo, best_longest_word, sum_score_squared, score_variance,
            recent_scores, total_category_words, best_category_words_per_game,
            total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 6), COALESCE(p_category_key, 'animals'),
            1, p_score, p_score, p_words_found, p_score, p_best_combo,
            p_longest_word_length, p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score),
            COALESCE(p_bonus_words_completed, 0), COALESCE(p_bonus_words_completed, 0),
            p_xp_earned, p_coins_earned, jsonb_build_array(v_game_entry), NOW()
        )
        ON CONFLICT (profile_id, grid_size, category_key) DO UPDATE SET
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
            total_category_words = challenge_word_category_stats.total_category_words + COALESCE(p_bonus_words_completed, 0),
            best_category_words_per_game = GREATEST(challenge_word_category_stats.best_category_words_per_game, COALESCE(p_bonus_words_completed, 0)),
            total_xp_earned = challenge_word_category_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_word_category_stats.total_coins_earned + p_coins_earned,
            game_history    = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(v_game_entry) || challenge_word_category_stats.game_history) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 50) sub),
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'word-search' THEN
        v_completion_rate := CASE
            WHEN COALESCE(p_ws_placed_words, 0) > 0
            THEN LEAST(1.0, p_words_found::REAL / p_ws_placed_words)
            ELSE 0 END;

        INSERT INTO challenge_word_search_stats (
            profile_id, games_played, high_score, total_score, total_words,
            avg_score, best_combo, sum_score_squared, score_variance,
            recent_scores, highest_level_reached, avg_completion_rate,
            perfect_clears, avg_time_efficiency, total_bonus_words,
            best_bonus_words_single, total_placed_words, fastest_clear_seconds,
            total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, 1, p_score, p_score, p_words_found,
            p_score, COALESCE(p_best_combo, 0), p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score),
            COALESCE(p_ws_level, 1), v_completion_rate,
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

    ELSIF NOT p_is_challenge AND (p_time_limit_seconds IS NULL OR p_time_limit_seconds = 0) THEN
        -- SANDBOX
        INSERT INTO sandbox_grid_stats (
            profile_id, grid_size, difficulty,
            games_played, high_score, total_score, total_words, avg_score,
            best_combo, best_longest_word, sum_score_squared, score_variance,
            recent_scores, total_xp_earned, total_coins_earned, game_history, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 5), COALESCE(p_difficulty, 'casual'),
            1, p_score, p_score, p_words_found, p_score, p_best_combo,
            p_longest_word_length, p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score), p_xp_earned, p_coins_earned,
            jsonb_build_array(v_game_entry), NOW()
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
        updated_at = NOW()
    WHERE id = p_profile_id;

    -- ════════════════════════════════════════════════════════════════
    -- D. Compute + store monotonic skill_rating on profile_game_stats
    --    with GUARANTEED MINIMUM BUMP per game mode
    -- ════════════════════════════════════════════════════════════════
    BEGIN
        -- Determine guaranteed minimum bump based on game mode
        v_min_bump := CASE
            WHEN p_is_challenge AND p_challenge_type = 'speed-round'    THEN 1.5
            WHEN p_is_challenge AND p_challenge_type = 'target-word'    THEN 1.0
            WHEN p_is_challenge AND p_challenge_type = 'word-search'    THEN 1.0
            WHEN p_is_challenge AND p_challenge_type = 'word-runner'    THEN 1.0
            WHEN p_is_challenge AND p_challenge_type = 'word-category'  THEN 0.8
            WHEN p_game_mode = 'timed'                                  THEN 0.5
            ELSE 0.1  -- sandbox (casual, untimed)
        END;

        SELECT ps.skill_rating INTO v_new_profile_skill
        FROM compute_profile_skill(p_profile_id) ps;

        -- Ratchet: stored value always goes up by AT LEAST v_min_bump.
        -- If the computed value is even higher, it wins.
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


-- ════════════════════════════════════════
-- PART 2: update_ranking_for_account uses profile_game_stats as floor
-- ════════════════════════════════════════
-- The bumped skill_rating from record_game lives in profile_game_stats.
-- The leaderboard function must also reflect it.

CREATE OR REPLACE FUNCTION update_ranking_for_account(p_account_id UUID)
RETURNS void AS $$
DECLARE
    v_best_profile_id UUID;
    v_best_username TEXT;
    v_skill RECORD;
    v_pgs_floor REAL;
BEGIN
    IF p_account_id IS NULL THEN RETURN; END IF;

    -- Check if account is banned
    IF EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id AND is_banned = TRUE) THEN RETURN; END IF;

    -- Find the best-skilled profile for this account
    SELECT p.id, p.username INTO v_best_profile_id, v_best_username
    FROM profiles p
    CROSS JOIN LATERAL compute_profile_skill(p.id) s
    WHERE p.account_id = p_account_id AND p.games_played > 0
    ORDER BY s.skill_rating DESC
    LIMIT 1;

    IF v_best_profile_id IS NULL THEN
        DELETE FROM leaderboard_rankings WHERE account_id = p_account_id;
        RETURN;
    END IF;

    -- Compute skill for the best profile
    SELECT * INTO v_skill FROM compute_profile_skill(v_best_profile_id);

    -- Use profile_game_stats.skill_rating as floor (includes guaranteed bumps)
    SELECT COALESCE(pgs.skill_rating, 0) INTO v_pgs_floor
    FROM profile_game_stats pgs WHERE pgs.profile_id = v_best_profile_id;
    v_skill.skill_rating := GREATEST(v_skill.skill_rating, COALESCE(v_pgs_floor, 0));

    -- Upsert into leaderboard
    INSERT INTO leaderboard_rankings (
        account_id, profile_id, username,
        skill_rating, raw_score_component, grid_mastery_component,
        difficulty_component, time_pressure_component, challenge_component,
        consistency_component, versatility_component, progression_component,
        skill_class, computed_at
    ) VALUES (
        p_account_id, v_best_profile_id, v_best_username,
        v_skill.skill_rating, v_skill.raw_score_component, v_skill.grid_mastery_component,
        v_skill.difficulty_component, v_skill.time_pressure_component, v_skill.challenge_component,
        v_skill.consistency_component, v_skill.versatility_component, v_skill.progression_component,
        v_skill.skill_class, NOW()
    )
    ON CONFLICT (account_id) DO UPDATE SET
        profile_id = EXCLUDED.profile_id,
        username = EXCLUDED.username,
        -- Same profile → ratchet (never decrease). Different profile → use its own rating.
        skill_rating = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id
            THEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating)
            ELSE EXCLUDED.skill_rating
        END,
        raw_score_component = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.raw_score_component ELSE EXCLUDED.raw_score_component END,
        grid_mastery_component = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.grid_mastery_component ELSE EXCLUDED.grid_mastery_component END,
        difficulty_component = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.difficulty_component ELSE EXCLUDED.difficulty_component END,
        time_pressure_component = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.time_pressure_component ELSE EXCLUDED.time_pressure_component END,
        challenge_component = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.challenge_component ELSE EXCLUDED.challenge_component END,
        consistency_component = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.consistency_component ELSE EXCLUDED.consistency_component END,
        versatility_component = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.versatility_component ELSE EXCLUDED.versatility_component END,
        progression_component = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.progression_component ELSE EXCLUDED.progression_component END,
        skill_class = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.skill_class ELSE EXCLUDED.skill_class END,
        analysis_text = NULL,
        computed_at = NOW();

    -- Recompute global ranks
    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY skill_rating DESC) as rn
        FROM leaderboard_rankings
    )
    UPDATE leaderboard_rankings lr SET global_rank = ranked.rn
    FROM ranked WHERE lr.id = ranked.id;

    -- Recompute class ranks
    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY skill_rating DESC) as crn
        FROM leaderboard_rankings
    )
    UPDATE leaderboard_rankings lr SET class_rank = class_ranked.crn
    FROM class_ranked WHERE lr.id = class_ranked.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
