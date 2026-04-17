-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 033 — Revert score inflation, add 4-tier class system    ║
-- ║                                                                      ║
-- ║  032 inflated all stored scores ×3.333 AND changed functions to     ║
-- ║  output 0-50K. This was wrong — scores should stay on the 0-15K    ║
-- ║  scale. Only the class thresholds should change.                    ║
-- ║                                                                      ║
-- ║  NEW 4-TIER CLASS SYSTEM:                                           ║
-- ║    low     < 5,000                                                   ║
-- ║    medium  ≥ 5,000                                                   ║
-- ║    high    ≥ 10,000                                                  ║
-- ║    master  ≥ 20,000                                                  ║
-- ║    expert  ≥ 50,000                                                  ║
-- ║                                                                      ║
-- ║  Functions output 0-15K. Per-game bumps accumulate with no cap.     ║
-- ║  Expert requires massive long-term play dedication.                 ║
-- ╚══════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════════
-- PART 1: Revert compute_profile_skill back to 0-15K + new thresholds
-- ════════════════════════════════════════════════════════════════════════

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
    SELECT * INTO v_pgs FROM profile_game_stats WHERE profile_id = p_profile_id;
    v_total_games := COALESCE(v_pgs.games_played, 0);

    IF v_total_games < 1 THEN
        RETURN QUERY SELECT 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL,
                            0::REAL, 0::REAL, 0::REAL, 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    SELECT ws.ws_skill_rating, ws.ws_games_played
    INTO v_ws_skill, v_ws_games
    FROM compute_ws_skill(p_profile_id) ws;
    v_ws_skill := COALESCE(v_ws_skill, 0);
    v_ws_games := COALESCE(v_ws_games, 0);

    -- ── 1. RAW SCORE (0-100) ──
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
        v_diff := LEAST(25, v_raw * 0.25);
    END IF;

    -- ── 4. TIME PRESSURE (0-100) ──
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

    IF v_ws_games >= 5 THEN
        DECLARE
            v_ws_blend REAL;
        BEGIN
            v_ws_blend := LEAST(0.4, (v_ws_games - 5)::REAL / 62.5);
            v_challenge := v_challenge * (1.0 - v_ws_blend) + v_ws_skill * v_ws_blend;
        END;
    END IF;

    -- ── 6. CONSISTENCY (0-100) ──
    SELECT LEAST(100, COALESCE(
        CASE
            WHEN sub.avg_val IS NULL OR sub.avg_val < 10 THEN
                LEAST(40, v_total_games::REAL * 2)
            ELSE
                100.0 / (1.0 + COALESCE(sub.std_val, 0) / NULLIF(sub.avg_val, 0))
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
    DECLARE
        v_recent_avg REAL;
        v_older_avg REAL;
    BEGIN
        SELECT COALESCE(AVG(elem::REAL), 0) INTO v_recent_avg
        FROM (SELECT elem FROM jsonb_array_elements_text(v_pgs.recent_scores) AS elem LIMIT 10) sub;

        SELECT COALESCE(AVG(elem::REAL), 0) INTO v_older_avg
        FROM (SELECT elem FROM jsonb_array_elements_text(v_pgs.recent_scores) AS elem LIMIT 20 OFFSET 10) sub;

        IF v_total_games < 5 THEN
            v_progression := 40;
        ELSIF v_older_avg < 1 THEN
            v_progression := 55;
        ELSE
            v_progression := LEAST(100, GREATEST(20,
                55 + 30 * (1 / (1 + EXP(-2.5 * (
                    (v_recent_avg - v_older_avg) / NULLIF(GREATEST(v_older_avg, 1), 0)
                )))) - 15));
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

    -- 0-15,000 SCALE (reverted from 032's 0-50K) — same cubic curve
    v_skill := 15000.0 * POWER(v_skill / 100.0, 3.0);

    -- Activity bonus
    v_skill := v_skill + LN(1 + v_total_games) * 15;

    -- Confidence gate — 25 games
    v_skill := v_skill * LEAST(1.0, v_total_games / 25.0);

    -- DETERMINE CLASS (new 4-tier thresholds)
    IF v_skill >= 50000 THEN v_class := 'expert';
    ELSIF v_skill >= 20000 THEN v_class := 'master';
    ELSIF v_skill >= 10000 THEN v_class := 'high';
    ELSIF v_skill >= 5000 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_raw, v_grid, v_diff, v_time,
                        v_challenge, v_consistency, v_versatility,
                        v_progression, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ════════════════════════════════════════════════════════════════════════
-- PART 2: Revert per-challenge skill functions to 0-15K + new thresholds
-- ════════════════════════════════════════════════════════════════════════

-- ── 2a. compute_target_word_skill ──
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

    c_scoring := LEAST(100, 15.0 * LN(1 + v_avg_score / 100.0));
    c_target_eff := LEAST(100, 12.0 + 25.0 * LN(1 + v_avg_targets));
    c_target_eff := LEAST(100, c_target_eff + LEAST(16, v_best_targets * 1.2));
    IF v_avg_score > 0 THEN
        c_consistency := LEAST(100, GREATEST(0,
            100 * (1.0 - LEAST(1.0, v_score_stddev / GREATEST(v_avg_score, 1)))));
    END IF;
    c_combo := LEAST(100, 20.0 * LN(1 + v_avg_combo));
    c_volume := LEAST(100, 13.0 * LN(1 + v_games));

    v_internal := (
        c_scoring     * 0.25 +
        c_target_eff  * 0.30 +
        c_consistency * 0.15 +
        c_combo       * 0.15 +
        c_volume      * 0.15
    );

    -- 0-15,000 SCALE (reverted from 032's 0-50K)
    v_skill := 15000.0 * POWER(v_internal / 100.0, 8);
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    IF v_skill >= 50000 THEN v_class := 'expert';
    ELSIF v_skill >= 20000 THEN v_class := 'master';
    ELSIF v_skill >= 10000 THEN v_class := 'high';
    ELSIF v_skill >= 5000 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ── 2b. compute_speed_round_skill ──
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
        -- Uses total_time_seconds (renamed from total_time_used_seconds in migration 030)
        CASE WHEN SUM(t.total_time_seconds) > 0
             THEN (SUM(t.total_words)::REAL / SUM(t.total_time_seconds) * 60.0) ELSE 0 END
    INTO v_games, v_high_score, v_avg_score, v_score_stddev,
         v_avg_words, v_best_words, v_avg_wpm
    FROM challenge_speed_round_stats t
    WHERE t.profile_id = p_profile_id;

    IF v_games < 1 THEN
        RETURN QUERY SELECT 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    c_wpm := LEAST(100, 23.0 * LN(1 + v_avg_wpm));
    c_scoring := LEAST(100, 13.0 * LN(1 + v_avg_score / 50.0));
    c_word_count := LEAST(100, 16.0 * LN(1 + v_avg_words));
    c_word_count := LEAST(100, c_word_count + LEAST(12, v_best_words * 0.25));
    IF v_avg_score > 0 THEN
        c_consistency := LEAST(100, GREATEST(0,
            100 * (1.0 - LEAST(1.0, v_score_stddev / GREATEST(v_avg_score, 1)))));
    END IF;
    c_volume := LEAST(100, 13.0 * LN(1 + v_games));

    v_internal := (
        c_wpm         * 0.30 +
        c_scoring     * 0.25 +
        c_word_count  * 0.15 +
        c_consistency * 0.15 +
        c_volume      * 0.15
    );

    -- 0-15,000 SCALE (reverted from 032's 0-50K)
    v_skill := 15000.0 * POWER(v_internal / 100.0, 8);
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    IF v_skill >= 50000 THEN v_class := 'expert';
    ELSIF v_skill >= 20000 THEN v_class := 'master';
    ELSIF v_skill >= 10000 THEN v_class := 'high';
    ELSIF v_skill >= 5000 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ── 2c. compute_word_category_skill ──
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

    c_cat_words := LEAST(100, 23.0 * LN(1 + v_avg_cat_words));
    c_cat_words := LEAST(100, c_cat_words + LEAST(12, v_best_cat_words * 1.0));
    c_scoring := LEAST(100, 15.0 * LN(1 + v_avg_score / 100.0));
    c_breadth := LEAST(100, (v_num_categories::REAL / 11.0) * 100);
    IF v_avg_score > 0 THEN
        c_consistency := LEAST(100, GREATEST(0,
            100 * (1.0 - LEAST(1.0, v_score_stddev / GREATEST(v_avg_score, 1)))));
    END IF;
    c_volume := LEAST(100, 13.0 * LN(1 + v_games));

    v_internal := (
        c_cat_words   * 0.30 +
        c_scoring     * 0.25 +
        c_breadth     * 0.15 +
        c_consistency * 0.15 +
        c_volume      * 0.15
    );

    -- 0-15,000 SCALE (reverted from 032's 0-50K)
    v_skill := 15000.0 * POWER(v_internal / 100.0, 8);
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    IF v_skill >= 50000 THEN v_class := 'expert';
    ELSIF v_skill >= 20000 THEN v_class := 'master';
    ELSIF v_skill >= 10000 THEN v_class := 'high';
    ELSIF v_skill >= 5000 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ── 2d. compute_word_runner_skill ──
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

    c_scoring := LEAST(100, 15.0 * LN(1 + v_avg_score / 50.0));
    c_peak := LEAST(100, 12.0 * LN(1 + COALESCE(v_high_score, 0)::REAL / 50.0));
    c_peak := LEAST(100, c_peak + LEAST(12, COALESCE(v_high_score, 0)::REAL / 615.0));
    c_word_output := LEAST(100, 18.0 * LN(1 + v_avg_words));
    c_combo := LEAST(100, 20.0 * LN(1 + v_avg_combo));
    c_combo := LEAST(100, c_combo + LEAST(12, v_best_combo * 1.2));
    c_volume := LEAST(100, 13.0 * LN(1 + v_games));

    v_internal := (
        c_scoring     * 0.30 +
        c_word_output * 0.25 +
        c_peak        * 0.15 +
        c_combo       * 0.15 +
        c_volume      * 0.15
    );

    -- 0-15,000 SCALE (reverted from 032's 0-50K)
    v_skill := 15000.0 * POWER(v_internal / 100.0, 8);
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    challenge_skill := v_skill;
    skill_class := CASE
        WHEN v_skill >= 50000 THEN 'expert'
        WHEN v_skill >= 20000 THEN 'master'
        WHEN v_skill >= 10000 THEN 'high'
        WHEN v_skill >= 5000 THEN 'medium'
        ELSE 'low'
    END;
    RETURN NEXT;
END;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- PART 3: Update update_ranking_for_account with 4-tier thresholds
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_ranking_for_account(p_account_id UUID)
RETURNS void AS $$
DECLARE
    v_best_profile_id UUID;
    v_best_username TEXT;
    v_skill RECORD;
    v_pgs_floor REAL;
BEGIN
    IF p_account_id IS NULL THEN RETURN; END IF;

    IF EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id AND is_banned = TRUE) THEN RETURN; END IF;

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

    SELECT * INTO v_skill FROM compute_profile_skill(v_best_profile_id);

    SELECT COALESCE(pgs.skill_rating, 0) INTO v_pgs_floor
    FROM profile_game_stats pgs WHERE pgs.profile_id = v_best_profile_id;
    v_skill.skill_rating := GREATEST(v_skill.skill_rating, COALESCE(v_pgs_floor, 0));

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
        skill_rating = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id
            THEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating)
            ELSE EXCLUDED.skill_rating
        END,
        raw_score_component     = EXCLUDED.raw_score_component,
        grid_mastery_component  = EXCLUDED.grid_mastery_component,
        difficulty_component    = EXCLUDED.difficulty_component,
        time_pressure_component = EXCLUDED.time_pressure_component,
        challenge_component     = EXCLUDED.challenge_component,
        consistency_component   = EXCLUDED.consistency_component,
        versatility_component   = EXCLUDED.versatility_component,
        progression_component   = EXCLUDED.progression_component,
        -- 4-tier class thresholds
        skill_class = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id
            THEN CASE
                WHEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating) >= 50000 THEN 'expert'
                WHEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating) >= 20000 THEN 'master'
                WHEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating) >= 10000 THEN 'high'
                WHEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating) >= 5000  THEN 'medium'
                ELSE 'low'
            END
            ELSE EXCLUDED.skill_class
        END,
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


-- ════════════════════════════════════════════════════════════════════════
-- PART 4: Undo 032's data inflation and recompute
-- ════════════════════════════════════════════════════════════════════════

-- 4a. Undo the ×3.333 inflation on profile_game_stats floor
UPDATE profile_game_stats
SET skill_rating = skill_rating / (50000.0 / 15000.0);

-- 4b. Undo the ×3.333 inflation on challenge_leaderboards
UPDATE challenge_leaderboards
SET challenge_skill_rating = challenge_skill_rating / (50000.0 / 15000.0);

-- 4c. Reset leaderboard_rankings skill_rating to 0 to clear the ratchet
UPDATE leaderboard_rankings
SET skill_rating = 0;

-- 4d. Recompute all rankings with reverted 0-15K functions
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
            RAISE WARNING '033 recompute: ranking failed for account %: %', v_acct.account_id, SQLERRM;
        END;
    END LOOP;
    RAISE NOTICE '033 recompute: recomputed rankings for % accounts', v_count;
END;
$$;

-- 4e. Fix challenge_leaderboards skill_class with new thresholds
UPDATE challenge_leaderboards
SET skill_class = CASE
    WHEN challenge_skill_rating >= 50000 THEN 'expert'
    WHEN challenge_skill_rating >= 20000 THEN 'master'
    WHEN challenge_skill_rating >= 10000 THEN 'high'
    WHEN challenge_skill_rating >= 5000  THEN 'medium'
    ELSE 'low'
END;
