-- ════════════════════════════════════════════════════════════════════════════
-- Migration 022: Skill Rating Rewrite + Old Table Archive
-- ════════════════════════════════════════════════════════════════════════════
--
-- Rewrites ALL compute_*_skill functions to read from the new aggregate
-- tables created in 021 (instead of game_scores + old stat tables).
--
-- Also:
--   - Adds game_history tracking (per-game JSONB entries, capped at 50)
--   - Monotonic skill_rating on profile_game_stats (only goes up)
--   - Removes game_scores INSERT from record_game() (no more event log)
--   - Drops 5 remaining stat triggers on game_scores
--   - Archives old tables (rename to _legacy/_log)
--   - Recomputes all rankings from new functions
--
-- Run AFTER migration 020 and 021.
-- ════════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 1: Rewrite compute_ws_skill                                      ║
-- ║  OLD: reads profile_word_search_stats                                  ║
-- ║  NEW: reads challenge_word_search_stats                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION compute_ws_skill(p_profile_id UUID)
RETURNS TABLE (
    ws_skill_rating REAL,
    completion_rate_score REAL,
    speed_efficiency_score REAL,
    level_progression_score REAL,
    bonus_discovery_score REAL,
    perfect_clear_rate REAL,
    ws_games_played INTEGER
) AS $$
DECLARE
    v_ws RECORD;
    v_completion REAL := 0;
    v_speed REAL := 0;
    v_level REAL := 0;
    v_bonus REAL := 0;
    v_perfect_rate REAL := 0;
    v_skill REAL := 0;
    v_confidence REAL := 0;
BEGIN
    SELECT * INTO v_ws
    FROM challenge_word_search_stats ws
    WHERE ws.profile_id = p_profile_id;

    IF v_ws IS NULL OR v_ws.games_played < 1 THEN
        RETURN QUERY SELECT 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0;
        RETURN;
    END IF;

    -- VECTOR 1: COMPLETION RATE SCORE (0-100)
    v_completion := LEAST(100, POWER(v_ws.avg_completion_rate, 1.5) * 100);
    v_perfect_rate := CASE
        WHEN v_ws.games_played > 0
        THEN v_ws.perfect_clears::REAL / v_ws.games_played
        ELSE 0
    END;
    v_completion := LEAST(100, v_completion + v_perfect_rate * 20);

    -- VECTOR 2: SPEED EFFICIENCY SCORE (0-100)
    v_speed := LEAST(100, GREATEST(0,
        100 * (1.0 - v_ws.avg_time_efficiency)
    ));
    IF v_ws.fastest_clear_seconds IS NOT NULL AND v_ws.fastest_clear_seconds < 120 THEN
        v_speed := LEAST(100, v_speed + 15);
    ELSIF v_ws.fastest_clear_seconds IS NOT NULL AND v_ws.fastest_clear_seconds < 180 THEN
        v_speed := LEAST(100, v_speed + 8);
    END IF;

    -- VECTOR 3: LEVEL PROGRESSION SCORE (0-100)
    v_level := LEAST(100, 14.5 * LN(1 + v_ws.highest_level_reached));

    -- VECTOR 4: BONUS WORD DISCOVERY SCORE (0-100)
    IF v_ws.games_played > 0 THEN
        v_bonus := LEAST(100,
            30 * LN(1 + v_ws.total_bonus_words::REAL / v_ws.games_played) +
            20 * LN(1 + v_ws.best_bonus_words_single) +
            CASE WHEN v_ws.total_bonus_words > 0 THEN 10 ELSE 0 END
        );
    END IF;

    -- WEIGHTED COMBINATION
    v_skill := (
        v_completion * 0.30 +
        v_speed * 0.25 +
        v_level * 0.25 +
        v_bonus * 0.20
    );

    -- CONFIDENCE GATE
    v_confidence := LEAST(1.0, GREATEST(0, (v_ws.games_played - 5)::REAL / 25.0));
    v_skill := v_skill * v_confidence;

    RETURN QUERY SELECT
        v_skill,
        v_completion,
        v_speed,
        v_level,
        v_bonus,
        v_perfect_rate,
        v_ws.games_played;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 2: Rewrite compute_target_word_skill                             ║
-- ║  OLD: reads profile_challenge_stats + game_scores                      ║
-- ║  NEW: reads challenge_target_word_stats                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION compute_target_word_skill(p_profile_id UUID)
RETURNS TABLE (challenge_skill REAL, skill_class TEXT) AS $$
DECLARE
    v_games INTEGER;
    v_high_score INTEGER;
    v_avg_score REAL;
    v_score_stddev REAL;
    v_avg_targets REAL;
    v_best_targets INTEGER;
    v_avg_combo REAL;
    v_avg_words REAL;
    c_scoring REAL := 0;
    c_target_eff REAL := 0;
    c_consistency REAL := 0;
    c_combo REAL := 0;
    c_volume REAL := 0;
    v_internal REAL := 0;
    v_skill REAL := 0;
    v_class TEXT := 'low';
BEGIN
    SELECT
        COALESCE(SUM(t.games_played), 0)::INTEGER,
        COALESCE(MAX(t.high_score), 0)::INTEGER,
        CASE WHEN SUM(t.games_played) > 0
             THEN (SUM(t.total_score)::REAL / SUM(t.games_played)) ELSE 0 END,
        SQRT(GREATEST(0, CASE WHEN SUM(t.games_played) > 0
             THEN SUM(t.score_variance * t.games_played) / SUM(t.games_played) ELSE 0 END)),
        CASE WHEN SUM(t.games_played) > 0
             THEN (SUM(t.total_targets_completed)::REAL / SUM(t.games_played)) ELSE 0 END,
        COALESCE(MAX(t.best_targets_in_game), 0)::INTEGER,
        COALESCE(MAX(t.best_combo) * 0.65, 0),
        CASE WHEN SUM(t.games_played) > 0
             THEN (SUM(t.total_words)::REAL / SUM(t.games_played)) ELSE 0 END
    INTO v_games, v_high_score, v_avg_score, v_score_stddev,
         v_avg_targets, v_best_targets, v_avg_combo, v_avg_words
    FROM challenge_target_word_stats t
    WHERE t.profile_id = p_profile_id;

    IF v_games < 1 THEN
        RETURN QUERY SELECT 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    -- C1: SCORING POWER (0-100)
    c_scoring := LEAST(100, 15.0 * LN(1 + v_avg_score / 100.0));

    -- C2: TARGET EFFICIENCY (0-100)
    c_target_eff := LEAST(100, 12.0 + 25.0 * LN(1 + v_avg_targets));
    c_target_eff := LEAST(100, c_target_eff + LEAST(16, v_best_targets * 1.2));

    -- C3: CONSISTENCY (0-100)
    IF v_avg_score > 0 THEN
        c_consistency := LEAST(100, GREATEST(0,
            100 * (1.0 - LEAST(1.0, v_score_stddev / GREATEST(v_avg_score, 1)))
        ));
    END IF;

    -- C4: COMBO MASTERY (0-100)
    c_combo := LEAST(100, 20.0 * LN(1 + v_avg_combo));

    -- C5: VOLUME (0-100)
    c_volume := LEAST(100, 13.0 * LN(1 + v_games));

    -- WEIGHTED COMBINATION (internal 0-100)
    v_internal := (
        c_scoring     * 0.25 +
        c_target_eff  * 0.30 +
        c_consistency * 0.15 +
        c_combo       * 0.15 +
        c_volume      * 0.15
    );

    -- EXPAND TO 0-15,000 SCALE (8th-power curve)
    v_skill := 15000.0 * POWER(v_internal / 100.0, 8);

    -- CONFIDENCE GATE (full rating at 15+ games)
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    IF v_skill >= 10000 THEN v_class := 'master';
    ELSIF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 3: Rewrite compute_speed_round_skill                             ║
-- ║  OLD: reads profile_challenge_stats + game_scores                      ║
-- ║  NEW: reads challenge_speed_round_stats                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION compute_speed_round_skill(p_profile_id UUID)
RETURNS TABLE (challenge_skill REAL, skill_class TEXT) AS $$
DECLARE
    v_games INTEGER;
    v_high_score INTEGER;
    v_avg_score REAL;
    v_score_stddev REAL;
    v_avg_wpm REAL;
    v_avg_words REAL;
    v_best_words INTEGER;
    c_wpm REAL := 0;
    c_scoring REAL := 0;
    c_word_count REAL := 0;
    c_consistency REAL := 0;
    c_volume REAL := 0;
    v_internal REAL := 0;
    v_skill REAL := 0;
    v_class TEXT := 'low';
BEGIN
    SELECT
        COALESCE(SUM(t.games_played), 0)::INTEGER,
        COALESCE(MAX(t.high_score), 0)::INTEGER,
        CASE WHEN SUM(t.games_played) > 0
             THEN (SUM(t.total_score)::REAL / SUM(t.games_played)) ELSE 0 END,
        SQRT(GREATEST(0, CASE WHEN SUM(t.games_played) > 0
             THEN SUM(t.score_variance * t.games_played) / SUM(t.games_played) ELSE 0 END)),
        CASE WHEN SUM(t.games_played) > 0
             THEN (SUM(t.total_words)::REAL / SUM(t.games_played)) ELSE 0 END,
        COALESCE(MAX(t.best_words_in_game), 0)::INTEGER,
        -- WPM = total_words / total_time_used * 60
        CASE WHEN SUM(t.total_time_used_seconds) > 0
             THEN (SUM(t.total_words)::REAL / SUM(t.total_time_used_seconds) * 60.0) ELSE 0 END
    INTO v_games, v_high_score, v_avg_score, v_score_stddev,
         v_avg_words, v_best_words, v_avg_wpm
    FROM challenge_speed_round_stats t
    WHERE t.profile_id = p_profile_id;

    IF v_games < 1 THEN
        RETURN QUERY SELECT 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    -- C1: WORDS PER MINUTE (0-100)
    c_wpm := LEAST(100, 23.0 * LN(1 + v_avg_wpm));

    -- C2: SCORING POWER (0-100)
    c_scoring := LEAST(100, 13.0 * LN(1 + v_avg_score / 50.0));

    -- C3: WORD COUNT PER GAME (0-100)
    c_word_count := LEAST(100, 16.0 * LN(1 + v_avg_words));
    c_word_count := LEAST(100, c_word_count + LEAST(12, v_best_words * 0.25));

    -- C4: CONSISTENCY (0-100)
    IF v_avg_score > 0 THEN
        c_consistency := LEAST(100, GREATEST(0,
            100 * (1.0 - LEAST(1.0, v_score_stddev / GREATEST(v_avg_score, 1)))
        ));
    END IF;

    -- C5: VOLUME (0-100)
    c_volume := LEAST(100, 13.0 * LN(1 + v_games));

    -- WEIGHTED — speed is king (internal 0-100)
    v_internal := (
        c_wpm         * 0.30 +
        c_scoring     * 0.25 +
        c_word_count  * 0.15 +
        c_consistency * 0.15 +
        c_volume      * 0.15
    );

    -- EXPAND TO 0-15,000 SCALE (8th-power curve)
    v_skill := 15000.0 * POWER(v_internal / 100.0, 8);
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    IF v_skill >= 10000 THEN v_class := 'master';
    ELSIF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 4: Rewrite compute_word_category_skill                           ║
-- ║  OLD: reads profile_challenge_stats + game_scores + profile_cat_stats  ║
-- ║  NEW: reads challenge_word_category_stats                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION compute_word_category_skill(p_profile_id UUID)
RETURNS TABLE (challenge_skill REAL, skill_class TEXT) AS $$
DECLARE
    v_games INTEGER;
    v_avg_score REAL;
    v_score_stddev REAL;
    v_avg_cat_words REAL;
    v_best_cat_words INTEGER;
    v_num_categories INTEGER;
    c_cat_words REAL := 0;
    c_scoring REAL := 0;
    c_breadth REAL := 0;
    c_consistency REAL := 0;
    c_volume REAL := 0;
    v_internal REAL := 0;
    v_skill REAL := 0;
    v_class TEXT := 'low';
BEGIN
    SELECT
        COALESCE(SUM(t.games_played), 0)::INTEGER,
        CASE WHEN SUM(t.games_played) > 0
             THEN (SUM(t.total_score)::REAL / SUM(t.games_played)) ELSE 0 END,
        SQRT(GREATEST(0, CASE WHEN SUM(t.games_played) > 0
             THEN SUM(t.score_variance * t.games_played) / SUM(t.games_played) ELSE 0 END)),
        CASE WHEN SUM(t.games_played) > 0
             THEN (SUM(t.total_category_words)::REAL / SUM(t.games_played)) ELSE 0 END,
        COALESCE(MAX(t.best_category_words_per_game), 0)::INTEGER,
        COUNT(DISTINCT t.category_key)::INTEGER
    INTO v_games, v_avg_score, v_score_stddev, v_avg_cat_words,
         v_best_cat_words, v_num_categories
    FROM challenge_word_category_stats t
    WHERE t.profile_id = p_profile_id;

    IF v_games < 1 THEN
        RETURN QUERY SELECT 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    -- C1: CATEGORY WORD RATE (0-100)
    c_cat_words := LEAST(100, 23.0 * LN(1 + v_avg_cat_words));
    c_cat_words := LEAST(100, c_cat_words + LEAST(12, v_best_cat_words * 1.0));

    -- C2: SCORING POWER (0-100)
    c_scoring := LEAST(100, 15.0 * LN(1 + v_avg_score / 100.0));

    -- C3: CATEGORY BREADTH (0-100) — out of 11 categories
    c_breadth := LEAST(100, (v_num_categories::REAL / 11.0) * 100);

    -- C4: CONSISTENCY (0-100)
    IF v_avg_score > 0 THEN
        c_consistency := LEAST(100, GREATEST(0,
            100 * (1.0 - LEAST(1.0, v_score_stddev / GREATEST(v_avg_score, 1)))
        ));
    END IF;

    -- C5: VOLUME (0-100)
    c_volume := LEAST(100, 13.0 * LN(1 + v_games));

    -- WEIGHTED — category words matter most (internal 0-100)
    v_internal := (
        c_cat_words   * 0.30 +
        c_scoring     * 0.25 +
        c_breadth     * 0.15 +
        c_consistency * 0.15 +
        c_volume      * 0.15
    );

    -- EXPAND TO 0-15,000 SCALE (8th-power curve)
    v_skill := 15000.0 * POWER(v_internal / 100.0, 8);
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    IF v_skill >= 10000 THEN v_class := 'master';
    ELSIF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 5: Rewrite compute_word_runner_skill                             ║
-- ║  OLD: reads profile_challenge_stats + game_scores                      ║
-- ║  NEW: reads challenge_word_runner_stats                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION compute_word_runner_skill(p_profile_id UUID)
RETURNS TABLE(challenge_skill REAL, skill_class TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_games INTEGER;
    v_high_score INTEGER;
    v_avg_score REAL;
    v_score_stddev REAL;
    v_avg_words REAL;
    v_avg_combo REAL;
    v_best_combo INTEGER;
    c_scoring REAL := 0;
    c_peak REAL := 0;
    c_word_output REAL := 0;
    c_combo REAL := 0;
    c_volume REAL := 0;
    v_internal REAL := 0;
    v_skill REAL := 0;
    v_class TEXT := 'low';
BEGIN
    SELECT
        t.games_played,
        t.high_score,
        CASE WHEN t.games_played > 0 THEN (t.total_score::REAL / t.games_played) ELSE 0 END,
        SQRT(GREATEST(0, t.score_variance)),
        CASE WHEN t.games_played > 0 THEN (t.total_words::REAL / t.games_played) ELSE 0 END,
        COALESCE(t.best_combo * 0.65, 0),
        COALESCE(t.best_combo, 0)
    INTO v_games, v_high_score, v_avg_score, v_score_stddev,
         v_avg_words, v_avg_combo, v_best_combo
    FROM challenge_word_runner_stats t
    WHERE t.profile_id = p_profile_id;

    IF NOT FOUND OR v_games IS NULL OR v_games < 1 THEN
        challenge_skill := 0;
        skill_class := 'low';
        RETURN NEXT;
        RETURN;
    END IF;

    -- C1: SCORING POWER (0-100)
    c_scoring := LEAST(100, 15.0 * LN(1 + v_avg_score / 50.0));

    -- C2: PEAK PERFORMANCE (0-100)
    c_peak := LEAST(100, 12.0 * LN(1 + COALESCE(v_high_score, 0)::REAL / 50.0));
    c_peak := LEAST(100, c_peak + LEAST(12, COALESCE(v_high_score, 0)::REAL / 615.0));

    -- C3: WORD OUTPUT (0-100)
    c_word_output := LEAST(100, 18.0 * LN(1 + v_avg_words));

    -- C4: COMBO MASTERY (0-100)
    c_combo := LEAST(100, 20.0 * LN(1 + v_avg_combo));
    c_combo := LEAST(100, c_combo + LEAST(12, v_best_combo * 1.2));

    -- C5: VOLUME / EXPERIENCE (0-100)
    c_volume := LEAST(100, 13.0 * LN(1 + v_games));

    -- WEIGHTED COMBINATION (internal 0-100)
    v_internal := (
        c_scoring     * 0.30 +
        c_word_output * 0.25 +
        c_peak        * 0.15 +
        c_combo       * 0.15 +
        c_volume      * 0.15
    );

    -- EXPAND TO 0-15,000 SCALE (8th-power curve)
    v_skill := 15000.0 * POWER(v_internal / 100.0, 8);
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    challenge_skill := v_skill;
    skill_class := CASE
        WHEN v_skill >= 10000 THEN 'master'
        WHEN v_skill >= 5000 THEN 'high'
        WHEN v_skill >= 1500 THEN 'medium'
        ELSE 'low'
    END;
    RETURN NEXT;
END;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 6: Rewrite compute_profile_skill                                 ║
-- ║  OLD: reads game_scores, profile_high_scores, profile_challenge_stats  ║
-- ║  NEW: reads profile_game_stats + all aggregate tables                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION compute_profile_skill(p_profile_id UUID)
RETURNS TABLE (
    skill_rating REAL,
    raw_score_component REAL,
    grid_mastery_component REAL,
    difficulty_component REAL,
    time_pressure_component REAL,
    challenge_component REAL,
    consistency_component REAL,
    versatility_component REAL,
    progression_component REAL,
    skill_class TEXT
) AS $$
DECLARE
    v_total_games INTEGER;
    v_raw REAL := 0;
    v_grid REAL := 0;
    v_diff REAL := 0;
    v_time REAL := 0;
    v_challenge REAL := 0;
    v_consistency REAL := 0;
    v_versatility REAL := 0;
    v_progression REAL := 0;
    v_skill REAL := 0;
    v_class TEXT := 'low';
    v_ws_skill REAL := 0;
    v_ws_games INTEGER := 0;
    v_pgs RECORD;
    v_hard_total BIGINT;
    v_hard_games INTEGER;
    v_distinct_combos INTEGER;
    v_high_score_combos INTEGER;
BEGIN
    -- Get profile global stats
    SELECT * INTO v_pgs FROM profile_game_stats WHERE profile_id = p_profile_id;
    v_total_games := COALESCE(v_pgs.games_played, 0);

    IF v_total_games < 1 THEN
        RETURN QUERY SELECT 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL,
                            0::REAL, 0::REAL, 0::REAL, 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    -- Fetch WS skill for challenge component blend
    SELECT ws.ws_skill_rating, ws.ws_games_played
    INTO v_ws_skill, v_ws_games
    FROM compute_ws_skill(p_profile_id) ws;
    v_ws_skill := COALESCE(v_ws_skill, 0);
    v_ws_games := COALESCE(v_ws_games, 0);

    -- ── 1. RAW SCORE (0-100) ──
    -- Top 20 high scores across all dimension combos
    SELECT LEAST(100, 20 * LN(1 + GREATEST(0, AVG(sub.hs)) / 100))
    INTO v_raw
    FROM (
        SELECT high_score AS hs FROM sandbox_grid_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT high_score FROM timed_grid_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT high_score FROM challenge_target_word_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT high_score FROM challenge_speed_round_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT high_score FROM challenge_word_category_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT high_score FROM challenge_word_search_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT high_score FROM challenge_word_runner_stats WHERE profile_id = p_profile_id AND games_played > 0
        ORDER BY 1 DESC LIMIT 20
    ) sub;
    v_raw := COALESCE(v_raw, 0);

    -- ── 2. GRID MASTERY (0-100) ──
    -- Uses grid_size from sandbox, timed, and challenge tables
    SELECT LEAST(100, COALESCE(
        SUM(
            (6.0 / gs.grid_size) *
            20 * LN(1 + gs.high_score / 200.0) *
            LEAST(1, gs.games_played / 3.0)
        ) / NULLIF(COUNT(*), 0) * 2.0, 0))
    INTO v_grid
    FROM (
        SELECT grid_size, high_score::INTEGER, games_played
        FROM sandbox_grid_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT grid_size, high_score::INTEGER, games_played
        FROM timed_grid_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT grid_size, high_score::INTEGER, games_played
        FROM challenge_target_word_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT grid_size, high_score::INTEGER, games_played
        FROM challenge_speed_round_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT grid_size, high_score::INTEGER, games_played
        FROM challenge_word_category_stats WHERE profile_id = p_profile_id AND games_played > 0
    ) gs;
    v_grid := COALESCE(v_grid, 0);

    -- ── 3. DIFFICULTY (0-100) ──
    -- Hard-mode stats from sandbox + timed (challenges have no difficulty)
    SELECT COALESCE(SUM(total_score), 0), COALESCE(SUM(games_played), 0)
    INTO v_hard_total, v_hard_games
    FROM (
        SELECT total_score, games_played FROM sandbox_grid_stats
        WHERE profile_id = p_profile_id AND difficulty = 'hard'
        UNION ALL
        SELECT total_score, games_played FROM timed_grid_stats
        WHERE profile_id = p_profile_id AND difficulty = 'hard'
    ) hs;

    IF v_hard_games > 0 THEN
        v_diff := LEAST(100, (
            (20 * LN(1 + (v_hard_total::REAL / v_hard_games) / 150.0)) * 0.7
            + (v_hard_games::REAL / NULLIF(v_total_games, 0) * 100) * 0.3
        ));
    ELSE
        v_diff := 0;
    END IF;

    -- ── 4. TIME PRESSURE (0-100) ──
    -- From timed_grid_stats (time_limit_minutes * 60 = seconds)
    SELECT LEAST(100, COALESCE(
        SUM(
            (300.0 / GREATEST(gs.time_limit_minutes * 60, 60)) *
            16 * LN(1 + gs.high_score / 100.0) *
            LEAST(1, gs.games_played / 2.0)
        ) / NULLIF(COUNT(*), 0) * 2.5, 0))
    INTO v_time
    FROM timed_grid_stats gs
    WHERE gs.profile_id = p_profile_id AND gs.games_played > 0;
    v_time := COALESCE(v_time, 0);

    -- ── 5. CHALLENGE COMPONENT (0-100) ──
    -- One row per challenge type with appropriate multiplier
    SELECT LEAST(100, COALESCE(
        SUM(
            ct.multiplier *
            16 * LN(1 + ct.high_score / 150.0) *
            LEAST(1, ct.games_played / 3.0)
        ) / NULLIF(COUNT(*), 0) * 2.5, 0))
    INTO v_challenge
    FROM (
        SELECT 1.5::REAL AS multiplier, MAX(high_score)::INTEGER AS high_score, SUM(games_played)::INTEGER AS games_played
        FROM challenge_target_word_stats WHERE profile_id = p_profile_id HAVING SUM(games_played) > 0
        UNION ALL
        SELECT 1.75, MAX(high_score)::INTEGER, SUM(games_played)::INTEGER
        FROM challenge_speed_round_stats WHERE profile_id = p_profile_id HAVING SUM(games_played) > 0
        UNION ALL
        SELECT 1.3, MAX(high_score)::INTEGER, SUM(games_played)::INTEGER
        FROM challenge_word_category_stats WHERE profile_id = p_profile_id HAVING SUM(games_played) > 0
        UNION ALL
        SELECT 2.0, high_score::INTEGER, games_played
        FROM challenge_word_search_stats WHERE profile_id = p_profile_id AND games_played > 0
        UNION ALL
        SELECT 1.5, high_score::INTEGER, games_played
        FROM challenge_word_runner_stats WHERE profile_id = p_profile_id AND games_played > 0
    ) ct;
    v_challenge := COALESCE(v_challenge, 0);

    -- Blend in WS skill (same as before)
    IF v_ws_games >= 5 THEN
        DECLARE
            v_ws_blend REAL;
        BEGIN
            v_ws_blend := LEAST(0.4, (v_ws_games - 5)::REAL / 62.5);
            v_challenge := v_challenge * (1.0 - v_ws_blend) + v_ws_skill * v_ws_blend;
        END;
    END IF;

    -- ── 6. CONSISTENCY (0-100) ──
    -- From recent_scores JSONB (last 30 games)
    SELECT LEAST(100, COALESCE(
        CASE
            WHEN sub.avg_val IS NULL OR sub.avg_val < 10 THEN 0
            WHEN sub.std_val IS NULL OR sub.std_val = 0 THEN 95
            ELSE GREATEST(0, 100 - (sub.std_val / NULLIF(sub.avg_val, 0) * 100))
        END, 0))
    INTO v_consistency
    FROM (
        SELECT AVG(elem::REAL) AS avg_val,
               COALESCE(STDDEV_POP(elem::REAL), 0) AS std_val
        FROM profile_game_stats pgs,
             jsonb_array_elements_text(pgs.recent_scores) AS elem
        WHERE pgs.profile_id = p_profile_id
    ) sub;
    v_consistency := COALESCE(v_consistency, 0);

    -- ── 7. VERSATILITY (0-100) ──
    -- Count distinct dimension combos played + high-score combos > 500
    SELECT (
        (SELECT COUNT(*) FROM sandbox_grid_stats WHERE profile_id = p_profile_id AND games_played > 0)
        + (SELECT COUNT(*) FROM timed_grid_stats WHERE profile_id = p_profile_id AND games_played > 0)
        + (SELECT COUNT(*) FROM challenge_target_word_stats WHERE profile_id = p_profile_id AND games_played > 0)
        + (SELECT COUNT(*) FROM challenge_speed_round_stats WHERE profile_id = p_profile_id AND games_played > 0)
        + (SELECT COUNT(*) FROM challenge_word_category_stats WHERE profile_id = p_profile_id AND games_played > 0)
        + (CASE WHEN EXISTS (SELECT 1 FROM challenge_word_search_stats WHERE profile_id = p_profile_id AND games_played > 0) THEN 1 ELSE 0 END)
        + (CASE WHEN EXISTS (SELECT 1 FROM challenge_word_runner_stats WHERE profile_id = p_profile_id AND games_played > 0) THEN 1 ELSE 0 END)
    )::INTEGER INTO v_distinct_combos;

    SELECT (
        (SELECT COUNT(*) FROM sandbox_grid_stats WHERE profile_id = p_profile_id AND high_score > 500)
        + (SELECT COUNT(*) FROM timed_grid_stats WHERE profile_id = p_profile_id AND high_score > 500)
    )::INTEGER INTO v_high_score_combos;

    v_versatility := LEAST(100, COALESCE(
        (v_distinct_combos::REAL / 37.0 * 50
         + v_high_score_combos::REAL / 12.0 * 50), 0));

    -- ── 8. PROGRESSION (0-100) ──
    -- Compare recent 10 vs older 10 from recent_scores JSONB
    DECLARE
        v_recent_avg REAL;
        v_older_avg REAL;
    BEGIN
        SELECT COALESCE(AVG(elem::REAL), 0) INTO v_recent_avg
        FROM (SELECT elem FROM jsonb_array_elements_text(v_pgs.recent_scores) AS elem LIMIT 10) sub;

        SELECT COALESCE(AVG(elem::REAL), 0) INTO v_older_avg
        FROM (SELECT elem FROM jsonb_array_elements_text(v_pgs.recent_scores) AS elem LIMIT 20 OFFSET 10) sub;

        IF v_total_games < 5 THEN
            v_progression := 30;
        ELSE
            v_progression := LEAST(100, GREATEST(0,
                50 + 50 * (1 / (1 + EXP(-3 * (
                    (v_recent_avg - v_older_avg) / NULLIF(GREATEST(v_older_avg, 1), 0)
                )))) - 25));
        END IF;
    END;

    -- WEIGHTED SUM (internal 0-100)
    v_skill := (
        v_raw * 0.05 +
        v_grid * 0.20 +
        v_diff * 0.15 +
        v_time * 0.18 +
        v_challenge * 0.15 +
        v_consistency * 0.12 +
        v_versatility * 0.10 +
        v_progression * 0.05
    );

    -- EXPAND TO 0-15,000 SCALE (8th-power curve)
    v_skill := 15000.0 * POWER(v_skill / 100.0, 8);

    -- GAMES-PLAYED CONFIDENCE GATE
    v_skill := v_skill * LEAST(1.0, v_total_games / 50.0);

    -- DETERMINE CLASS
    IF v_skill >= 10000 THEN v_class := 'master';
    ELSIF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_raw, v_grid, v_diff, v_time,
                        v_challenge, v_consistency, v_versatility,
                        v_progression, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 7: Rewrite update_my_challenge_rankings                          ║
-- ║  OLD: LEFT JOIN LATERAL game_scores for high_score/games_played        ║
-- ║  NEW: reads from challenge_*_stats aggregate tables                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION update_my_challenge_rankings(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
    rec RECORD;
BEGIN
    -- Verify caller owns this account
    IF p_account_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;
    -- ── TARGET WORD ──
    FOR rec IN
        SELECT p.id AS profile_id, p.username,
               tw.challenge_skill, tw.skill_class,
               COALESCE(agg.high_score, 0) AS high_score,
               COALESCE(agg.games_played, 0) AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_target_word_skill(p.id) tw
        LEFT JOIN LATERAL (
            SELECT MAX(t.high_score)::INTEGER AS high_score,
                   SUM(t.games_played)::INTEGER AS games_played
            FROM challenge_target_word_stats t
            WHERE t.profile_id = p.id
        ) agg ON TRUE
        WHERE p.account_id = p_account_id
          AND COALESCE(agg.games_played, 0) > 0
        ORDER BY tw.challenge_skill DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'target-word',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id = EXCLUDED.profile_id,
            username = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating END,
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                     AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'target-word'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'target-word'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;

    -- ── SPEED ROUND ──
    FOR rec IN
        SELECT p.id AS profile_id, p.username,
               sr.challenge_skill, sr.skill_class,
               COALESCE(agg.high_score, 0) AS high_score,
               COALESCE(agg.games_played, 0) AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_speed_round_skill(p.id) sr
        LEFT JOIN LATERAL (
            SELECT MAX(t.high_score)::INTEGER AS high_score,
                   SUM(t.games_played)::INTEGER AS games_played
            FROM challenge_speed_round_stats t
            WHERE t.profile_id = p.id
        ) agg ON TRUE
        WHERE p.account_id = p_account_id
          AND COALESCE(agg.games_played, 0) > 0
        ORDER BY sr.challenge_skill DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'speed-round',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id = EXCLUDED.profile_id,
            username = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating END,
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                     AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'speed-round'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'speed-round'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;

    -- ── WORD CATEGORY ──
    FOR rec IN
        SELECT p.id AS profile_id, p.username,
               wc.challenge_skill, wc.skill_class,
               COALESCE(agg.high_score, 0) AS high_score,
               COALESCE(agg.games_played, 0) AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_word_category_skill(p.id) wc
        LEFT JOIN LATERAL (
            SELECT MAX(t.high_score)::INTEGER AS high_score,
                   SUM(t.games_played)::INTEGER AS games_played
            FROM challenge_word_category_stats t
            WHERE t.profile_id = p.id
        ) agg ON TRUE
        WHERE p.account_id = p_account_id
          AND COALESCE(agg.games_played, 0) > 0
        ORDER BY wc.challenge_skill DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-category',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id = EXCLUDED.profile_id,
            username = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating END,
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                     AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-category'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-category'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;

    -- ── WORD SEARCH ──
    FOR rec IN
        SELECT p.id AS profile_id, p.username,
               (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) AS challenge_skill,
               CASE
                   WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 10000 THEN 'master'
                   WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 5000 THEN 'high'
                   WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 1500 THEN 'medium'
                   ELSE 'low'
               END AS skill_class,
               COALESCE(t.high_score, 0) AS high_score,
               COALESCE(t.games_played, 0) AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_ws_skill(p.id) ws
        LEFT JOIN challenge_word_search_stats t ON t.profile_id = p.id
        WHERE p.account_id = p_account_id
          AND COALESCE(t.games_played, 0) > 0
        ORDER BY ws.ws_skill_rating DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-search',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id = EXCLUDED.profile_id,
            username = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating END,
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                     AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-search'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-search'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;

    -- ── WORD RUNNER ──
    FOR rec IN
        SELECT p.id AS profile_id, p.username,
               wr.challenge_skill, wr.skill_class,
               COALESCE(t.high_score, 0) AS high_score,
               COALESCE(t.games_played, 0) AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_word_runner_skill(p.id) wr
        LEFT JOIN challenge_word_runner_stats t ON t.profile_id = p.id
        WHERE p.account_id = p_account_id
          AND COALESCE(t.games_played, 0) > 0
        ORDER BY wr.challenge_skill DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-runner',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id = EXCLUDED.profile_id,
            username = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating END,
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                     AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-runner'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-runner'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 8: Rewrite record_game()                                         ║
-- ║  REMOVED: INSERT into game_scores event log                            ║
-- ║  ADDED:   game_history append (per-game JSONB, capped at 50)           ║
-- ║  ADDED:   monotonic skill_rating update on profile_game_stats          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

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
    -- Add type-specific fields
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
    -- ════════════════════════════════════════════════════════════════
    BEGIN
        SELECT ps.skill_rating INTO v_new_profile_skill
        FROM compute_profile_skill(p_profile_id) ps;

        UPDATE profile_game_stats SET
            skill_rating = GREATEST(profile_game_stats.skill_rating, COALESCE(v_new_profile_skill, 0)),
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


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 9: Drop remaining 5 stat triggers on game_scores                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

DROP TRIGGER IF EXISTS trg_update_high_scores    ON game_scores;
DROP TRIGGER IF EXISTS trg_update_profile_stats  ON game_scores;
DROP TRIGGER IF EXISTS trg_update_challenge_stats ON game_scores;
DROP TRIGGER IF EXISTS trg_update_category_stats ON game_scores;
DROP TRIGGER IF EXISTS trg_update_ws_stats       ON game_scores;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 10: Archive old tables (rename to _legacy/_log)                  ║
-- ║  Data is preserved, just no longer written to.                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE game_scores              RENAME TO game_scores_log;
ALTER TABLE profile_high_scores      RENAME TO profile_high_scores_legacy;
ALTER TABLE profile_challenge_stats  RENAME TO profile_challenge_stats_legacy;
ALTER TABLE profile_category_stats   RENAME TO profile_category_stats_legacy;
ALTER TABLE profile_word_search_stats RENAME TO profile_word_search_stats_legacy;

-- Rename primary key / unique constraints & indexes for clarity
ALTER INDEX IF EXISTS game_scores_pkey             RENAME TO game_scores_log_pkey;
ALTER INDEX IF EXISTS profile_high_scores_pkey     RENAME TO profile_high_scores_legacy_pkey;
ALTER INDEX IF EXISTS profile_challenge_stats_pkey RENAME TO profile_challenge_stats_legacy_pkey;
ALTER INDEX IF EXISTS profile_category_stats_pkey  RENAME TO profile_category_stats_legacy_pkey;
ALTER INDEX IF EXISTS profile_word_search_stats_pkey RENAME TO profile_word_search_stats_legacy_pkey;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 11: Backfill skill_rating on aggregate tables +                  ║
-- ║           Recompute all leaderboard rankings                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Recompute rankings for ALL accounts with games played.
-- This uses the newly rewritten compute functions that read from new tables.
DO $$
DECLARE
    v_acct RECORD;
    v_count INTEGER := 0;
BEGIN
    FOR v_acct IN
        SELECT DISTINCT p.account_id
        FROM profiles p
        WHERE p.games_played > 0
          AND p.account_id IS NOT NULL
    LOOP
        BEGIN
            PERFORM update_ranking_for_account(v_acct.account_id);
            v_count := v_count + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '022 backfill: ranking failed for account %: %', v_acct.account_id, SQLERRM;
        END;
    END LOOP;
    RAISE NOTICE '022 backfill: recomputed rankings for % accounts', v_count;
END;
$$;

-- Backfill skill_rating on profile_game_stats from leaderboard_rankings
UPDATE profile_game_stats pgs SET
    skill_rating = COALESCE(lr.skill_rating, 0)
FROM leaderboard_rankings lr
WHERE lr.profile_id = pgs.profile_id
  AND lr.skill_rating > pgs.skill_rating;

-- Backfill skill_rating on challenge aggregate tables from challenge_leaderboards
UPDATE challenge_target_word_stats t SET
    skill_rating = COALESCE(cl.challenge_skill_rating, 0)
FROM challenge_leaderboards cl
WHERE cl.profile_id = t.profile_id AND cl.challenge_type = 'target-word'
  AND cl.challenge_skill_rating > t.skill_rating;

UPDATE challenge_speed_round_stats t SET
    skill_rating = COALESCE(cl.challenge_skill_rating, 0)
FROM challenge_leaderboards cl
WHERE cl.profile_id = t.profile_id AND cl.challenge_type = 'speed-round'
  AND cl.challenge_skill_rating > t.skill_rating;

UPDATE challenge_word_category_stats t SET
    skill_rating = COALESCE(cl.challenge_skill_rating, 0)
FROM challenge_leaderboards cl
WHERE cl.profile_id = t.profile_id AND cl.challenge_type = 'word-category'
  AND cl.challenge_skill_rating > t.skill_rating;

UPDATE challenge_word_search_stats t SET
    skill_rating = COALESCE(cl.challenge_skill_rating, 0)
FROM challenge_leaderboards cl
WHERE cl.profile_id = t.profile_id AND cl.challenge_type = 'word-search'
  AND cl.challenge_skill_rating > t.skill_rating;

UPDATE challenge_word_runner_stats t SET
    skill_rating = COALESCE(cl.challenge_skill_rating, 0)
FROM challenge_leaderboards cl
WHERE cl.profile_id = t.profile_id AND cl.challenge_type = 'word-runner'
  AND cl.challenge_skill_rating > t.skill_rating;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DONE — Migration 022 Summary                                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- REWROTE: compute_ws_skill, compute_target_word_skill,
--   compute_speed_round_skill, compute_word_category_skill,
--   compute_word_runner_skill, compute_profile_skill,
--   update_my_challenge_rankings, record_game
--
-- All functions now read from new aggregate tables (021).
-- game_scores event log renamed to game_scores_log (read-only archive).
-- 5 old stat tables renamed to _legacy (data preserved).
-- 5 stat triggers dropped (no longer needed).
--
-- Skill ratings are monotonic (ratcheted via GREATEST).
-- game_history JSONB tracks per-game data (capped at 50 entries).
-- record_game() returns skill_rating in response.
--
-- Old materialized views may reference game_scores — they will need
-- a separate refresh/rebuild if still used.
