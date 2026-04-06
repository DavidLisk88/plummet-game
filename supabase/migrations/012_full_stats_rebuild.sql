-- ============================================================
-- Migration 012: Full stats rebuild + rating scale fix
-- ============================================================
-- RATING SCALE: 0-15,000 (8th-power curve where internal is 0-100)
-- Formula: 15000 * POWER(internal / 100, 8)
-- Max possible: 15000 * 1^8 = 15,000.
--
-- All functions use:
--   v_skill := 15000.0 * POWER(v_internal / 100.0, 8)
-- where v_internal is a weighted sum of components each 0-100.
--
-- The 8th power creates an aggressive curve that keeps low/mid
-- players in small numbers but rewards mastery exponentially:
--   internal 45 → 25,  60 → 252,  70 → 865,  80 → 2517
--
-- CLASS THRESHOLDS:
--   - Master class (≥ 10000): requires internal ≥ 95 — near-perfect
--     mastery of every dimension. Only the most dedicated players
--     will ever reach this tier.
--   - High class   (≥ 5000): requires internal ≥ 87 — expert mastery
--     across every dimension. Hundreds of games, top scores on
--     hard mode, time pressure excellence, challenge proficiency,
--     high consistency, broad versatility. Extremely long grind.
--   - Medium class  (≥ 1500): requires internal ≥ 76 — serious
--     dedication. Strong scores across all dimensions, 100+ games,
--     meaningful variety. A significant grind to reach.
--   - Low class    (< 1500): where every player starts. Casual and
--     intermediate players live here for a long time.
--
-- ADDITIONAL FIXES:
--   1. compute_word_runner_skill rewritten: was using 3 UNCAPPED
--      additive components (internal could exceed 100 → inflated
--      ratings like 661 with minimal play). Now uses proper
--      5-component pattern with LEAST(100,...) caps, weighted sum,
--      and 15-game confidence gate matching all other challenges.
--
--   2. refresh_challenge_leaderboards uses per-challenge compute
--      functions (was using stale pre-007 formula).
--
--   3. update_my_challenge_rankings WS call site uses matching scale.
--
--   4. get_challenge_analysis_data nests WS data under 'word_search'.
--
--   5. get_player_analysis_data: removed word_search data from main
--      profile analysis (belongs only on word-search challenge tab).
--
--   6. grid_size CHECK restored to 3-16.
--
--   7. All aggregate tables rebuilt from game_scores source of truth.
-- ============================================================

-- ────────────────────────────────────────
-- 0. FIX: Restore grid_size CHECK to allow word search grids (3-16)
-- ────────────────────────────────────────
ALTER TABLE game_scores DROP CONSTRAINT IF EXISTS game_scores_grid_size_check;
ALTER TABLE game_scores ADD CONSTRAINT game_scores_grid_size_check
    CHECK (grid_size IS NULL OR grid_size BETWEEN 3 AND 16);

-- ────────────────────────────────────────
-- 1. FIX: compute_profile_skill — 0-15,000 scale (8th-power curve) + word-runner in challenge component
-- ────────────────────────────────────────
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
    rec RECORD;
BEGIN
    SELECT COUNT(*) INTO v_total_games FROM game_scores WHERE game_scores.profile_id = p_profile_id;
    IF v_total_games < 1 THEN
        RETURN QUERY SELECT 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    -- Fetch WS skill for integration into challenge component
    SELECT ws.ws_skill_rating, ws.ws_games_played
    INTO v_ws_skill, v_ws_games
    FROM compute_ws_skill(p_profile_id) ws;
    v_ws_skill := COALESCE(v_ws_skill, 0);
    v_ws_games := COALESCE(v_ws_games, 0);

    -- 1. RAW SCORE (0-100)
    SELECT LEAST(100, 20 * LN(1 + GREATEST(0, AVG(sub.top_score)) / 100))
    INTO v_raw
    FROM (
        SELECT MAX(score) as top_score
        FROM game_scores WHERE game_scores.profile_id = p_profile_id
        GROUP BY game_mode, difficulty, grid_size
        ORDER BY top_score DESC LIMIT 20
    ) sub;

    -- 2. GRID MASTERY (0-100)
    SELECT LEAST(100, COALESCE(
        SUM(
            (6.0 / gs.grid_size) *
            20 * LN(1 + gs.high_score / 200.0) *
            LEAST(1, gs.games_played / 3.0)
        ) / NULLIF(COUNT(*), 0) * 2.0, 0))
    INTO v_grid
    FROM profile_high_scores gs WHERE gs.profile_id = p_profile_id;

    -- 3. DIFFICULTY (0-100)
    SELECT LEAST(100, COALESCE(
        (
            (SELECT COALESCE(AVG(20 * LN(1 + score / 150.0)), 0)
             FROM game_scores WHERE game_scores.profile_id = p_profile_id AND difficulty = 'hard') * 0.7
            +
            (SELECT COUNT(*)::REAL / NULLIF(v_total_games, 0) * 100
             FROM game_scores WHERE game_scores.profile_id = p_profile_id AND difficulty = 'hard') * 0.3
        ), 0))
    INTO v_diff;

    -- 4. TIME PRESSURE (0-100)
    SELECT LEAST(100, COALESCE(
        SUM(
            (300.0 / GREATEST(gs.time_limit_seconds, 60)) *
            16 * LN(1 + gs.high_score / 100.0) *
            LEAST(1, gs.games_played / 2.0)
        ) / NULLIF(COUNT(*), 0) * 2.5, 0))
    INTO v_time
    FROM profile_high_scores gs
    WHERE gs.profile_id = p_profile_id AND gs.game_mode = 'timed' AND gs.time_limit_seconds IS NOT NULL;

    -- 5. CHALLENGE COMPONENT (0-100)
    SELECT LEAST(100, COALESCE(
        SUM(
            CASE cs.challenge_type
                WHEN 'speed-round' THEN 1.75
                WHEN 'target-word' THEN 1.5
                WHEN 'word-runner' THEN 1.5
                WHEN 'word-category' THEN 1.3
                WHEN 'word-search' THEN 2.0
                ELSE 1.0
            END *
            16 * LN(1 + cs.high_score / 150.0) *
            LEAST(1, cs.games_played / 3.0)
        ) / NULLIF(COUNT(*), 0) * 2.5, 0))
    INTO v_challenge
    FROM profile_challenge_stats cs WHERE cs.profile_id = p_profile_id;

    -- Blend in dedicated WS skill (captures completion rate, speed,
    -- level progression, bonus discovery — not in challenge_stats)
    IF v_ws_games >= 5 THEN
        DECLARE
            v_ws_blend REAL;
        BEGIN
            v_ws_blend := LEAST(0.4, (v_ws_games - 5)::REAL / 62.5);
            v_challenge := v_challenge * (1.0 - v_ws_blend) + v_ws_skill * v_ws_blend;
        END;
    END IF;

    -- 6. CONSISTENCY (0-100)
    SELECT LEAST(100, COALESCE(
        CASE
            WHEN STDDEV_POP(sub.score) IS NULL OR AVG(sub.score) < 10 THEN 0
            ELSE GREATEST(0, 100 - (STDDEV_POP(sub.score) / NULLIF(AVG(sub.score), 0) * 100))
        END, 0))
    INTO v_consistency
    FROM (
        SELECT score FROM game_scores
        WHERE game_scores.profile_id = p_profile_id
        ORDER BY played_at DESC LIMIT 30
    ) sub;

    -- 7. VERSATILITY (0-100)
    SELECT LEAST(100, COALESCE(
        (
            (SELECT COUNT(DISTINCT (game_mode, grid_size, difficulty, COALESCE(time_limit_seconds, 0), COALESCE(challenge_type, '')))
             FROM game_scores WHERE game_scores.profile_id = p_profile_id)::REAL
            / 37.0 * 50
            +
            (SELECT COUNT(*)::REAL FROM profile_high_scores
             WHERE profile_high_scores.profile_id = p_profile_id AND high_score > 500)
            / 12.0 * 50
        ), 0))
    INTO v_versatility;

    -- 8. PROGRESSION (0-100)
    SELECT LEAST(100, COALESCE(
        CASE
            WHEN (SELECT COUNT(*) FROM game_scores WHERE game_scores.profile_id = p_profile_id) < 5 THEN 30
            ELSE GREATEST(0,
                50 + 50 * (1 / (1 + EXP(-3 * (
                    (SELECT COALESCE(AVG(sub_recent.score), 0) FROM (
                        SELECT score FROM game_scores WHERE game_scores.profile_id = p_profile_id ORDER BY played_at DESC LIMIT 10
                    ) sub_recent)
                    -
                    (SELECT COALESCE(AVG(sub_old.score), 0) FROM (
                        SELECT score FROM game_scores WHERE game_scores.profile_id = p_profile_id ORDER BY played_at DESC LIMIT 20 OFFSET 10
                    ) sub_old)
                ) / NULLIF(GREATEST(
                    (SELECT COALESCE(AVG(sub_old2.score), 1) FROM (
                        SELECT score FROM game_scores WHERE game_scores.profile_id = p_profile_id ORDER BY played_at DESC LIMIT 20 OFFSET 10
                    ) sub_old2), 1), 0)
                ))) - 25)
        END, 0))
    INTO v_progression;

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

    RETURN QUERY SELECT v_skill, v_raw, v_grid, v_diff, v_time, v_challenge, v_consistency, v_versatility, v_progression, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 2. FIX: compute_target_word_skill — 0-15,000 scale (8th-power curve)
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_target_word_skill(p_profile_id UUID)
RETURNS TABLE (challenge_skill REAL, skill_class TEXT) AS $$
DECLARE
    v_cs RECORD;
    v_games INTEGER;
    v_avg_score REAL;
    v_high_score INTEGER;
    v_avg_targets REAL;
    v_best_targets INTEGER;
    v_avg_combo REAL;
    v_score_stddev REAL;
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
    SELECT * INTO v_cs
    FROM profile_challenge_stats
    WHERE profile_id = p_profile_id AND challenge_type = 'target-word';

    IF v_cs IS NULL OR v_cs.games_played < 1 THEN
        RETURN QUERY SELECT 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    v_games := v_cs.games_played;
    v_high_score := v_cs.high_score;

    SELECT
        COALESCE(AVG(gs.score), 0),
        COALESCE(STDDEV(gs.score), 0),
        COALESCE(AVG(gs.target_words_completed), 0),
        COALESCE(MAX(gs.target_words_completed), 0),
        COALESCE(AVG(gs.best_combo), 0),
        COALESCE(AVG(gs.words_found), 0)
    INTO v_avg_score, v_score_stddev, v_avg_targets, v_best_targets, v_avg_combo, v_avg_words
    FROM game_scores gs
    WHERE gs.profile_id = p_profile_id
      AND gs.challenge_type = 'target-word' AND gs.is_challenge = TRUE;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 3. FIX: compute_speed_round_skill — 0-15,000 scale (8th-power curve)
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_speed_round_skill(p_profile_id UUID)
RETURNS TABLE (challenge_skill REAL, skill_class TEXT) AS $$
DECLARE
    v_cs RECORD;
    v_games INTEGER;
    v_avg_score REAL;
    v_high_score INTEGER;
    v_avg_wpm REAL;
    v_avg_words REAL;
    v_best_words INTEGER;
    v_score_stddev REAL;
    v_avg_combo REAL;
    c_wpm REAL := 0;
    c_scoring REAL := 0;
    c_word_count REAL := 0;
    c_consistency REAL := 0;
    c_volume REAL := 0;
    v_internal REAL := 0;
    v_skill REAL := 0;
    v_class TEXT := 'low';
BEGIN
    SELECT * INTO v_cs
    FROM profile_challenge_stats
    WHERE profile_id = p_profile_id AND challenge_type = 'speed-round';

    IF v_cs IS NULL OR v_cs.games_played < 1 THEN
        RETURN QUERY SELECT 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    v_games := v_cs.games_played;
    v_high_score := v_cs.high_score;

    SELECT
        COALESCE(AVG(gs.score), 0),
        COALESCE(STDDEV(gs.score), 0),
        COALESCE(AVG(gs.words_found), 0),
        COALESCE(MAX(gs.words_found), 0),
        COALESCE(AVG(gs.best_combo), 0),
        COALESCE(AVG(
            gs.words_found::REAL / GREATEST(1,
                (COALESCE(gs.time_limit_seconds, 180) - COALESCE(gs.time_remaining_seconds, 0))
            ) * 60.0
        ), 0)
    INTO v_avg_score, v_score_stddev, v_avg_words, v_best_words, v_avg_combo, v_avg_wpm
    FROM game_scores gs
    WHERE gs.profile_id = p_profile_id
      AND gs.challenge_type = 'speed-round' AND gs.is_challenge = TRUE;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 4. FIX: compute_word_category_skill — 0-15,000 scale (8th-power curve)
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_word_category_skill(p_profile_id UUID)
RETURNS TABLE (challenge_skill REAL, skill_class TEXT) AS $$
DECLARE
    v_cs RECORD;
    v_games INTEGER;
    v_avg_score REAL;
    v_score_stddev REAL;
    v_avg_cat_words REAL;
    v_best_cat_words INTEGER;
    v_num_categories INTEGER;
    v_avg_combo REAL;
    c_cat_words REAL := 0;
    c_scoring REAL := 0;
    c_breadth REAL := 0;
    c_consistency REAL := 0;
    c_volume REAL := 0;
    v_internal REAL := 0;
    v_skill REAL := 0;
    v_class TEXT := 'low';
BEGIN
    SELECT * INTO v_cs
    FROM profile_challenge_stats
    WHERE profile_id = p_profile_id AND challenge_type = 'word-category';

    IF v_cs IS NULL OR v_cs.games_played < 1 THEN
        RETURN QUERY SELECT 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    v_games := v_cs.games_played;

    SELECT
        COALESCE(AVG(gs.score), 0),
        COALESCE(STDDEV(gs.score), 0),
        COALESCE(AVG(gs.bonus_words_completed), 0),
        COALESCE(MAX(gs.bonus_words_completed), 0),
        COALESCE(AVG(gs.best_combo), 0)
    INTO v_avg_score, v_score_stddev, v_avg_cat_words, v_best_cat_words, v_avg_combo
    FROM game_scores gs
    WHERE gs.profile_id = p_profile_id
      AND gs.challenge_type = 'word-category' AND gs.is_challenge = TRUE;

    SELECT COUNT(DISTINCT category_key)
    INTO v_num_categories
    FROM profile_category_stats
    WHERE profile_id = p_profile_id;

    -- C1: CATEGORY WORD RATE (0-100)
    c_cat_words := LEAST(100, 23.0 * LN(1 + v_avg_cat_words));
    c_cat_words := LEAST(100, c_cat_words + LEAST(12, v_best_cat_words * 1.0));

    -- C2: SCORING POWER (0-100)
    c_scoring := LEAST(100, 15.0 * LN(1 + v_avg_score / 100.0));

    -- C3: CATEGORY BREADTH (0-100)
    c_breadth := LEAST(100, (v_num_categories::REAL / 7.0) * 100);

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 5. FIX: compute_word_runner_skill — full rewrite
--    Old version: 3 uncapped additive components, 5-game confidence gate
--    New version: 5 capped components (0-100 each), weighted sum,
--                 8th-power curve to 0-15,000, 15-game confidence gate
-- ────────────────────────────────────────
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
    -- Components (each 0-100)
    c_scoring REAL := 0;
    c_peak REAL := 0;
    c_word_output REAL := 0;
    c_combo REAL := 0;
    c_volume REAL := 0;
    v_internal REAL := 0;
    v_skill REAL := 0;
    v_class TEXT := 'low';
BEGIN
    SELECT cs.high_score, cs.games_played
    INTO v_high_score, v_games
    FROM profile_challenge_stats cs
    WHERE cs.profile_id = p_profile_id AND cs.challenge_type = 'word-runner';

    IF NOT FOUND OR v_games IS NULL OR v_games < 1 THEN
        challenge_skill := 0;
        skill_class := 'low';
        RETURN NEXT;
        RETURN;
    END IF;

    -- Aggregate from game_scores
    SELECT
        COALESCE(AVG(gs.score), 0),
        COALESCE(STDDEV(gs.score), 0),
        COALESCE(AVG(gs.words_found), 0),
        COALESCE(AVG(gs.best_combo), 0),
        COALESCE(MAX(gs.best_combo), 0)
    INTO v_avg_score, v_score_stddev, v_avg_words, v_avg_combo, v_best_combo
    FROM game_scores gs
    WHERE gs.profile_id = p_profile_id AND gs.challenge_type = 'word-runner';

    -- ═══ C1: SCORING POWER (0-100) ═══
    -- avg score: 50→10, 200→24, 500→36, 1500→52, 5000→70
    c_scoring := LEAST(100, 15.0 * LN(1 + v_avg_score / 50.0));

    -- ═══ C2: PEAK PERFORMANCE (0-100) ═══
    -- high score: 100→13, 500→29, 2000→45, 5000→55
    c_peak := LEAST(100, 12.0 * LN(1 + COALESCE(v_high_score, 0)::REAL / 50.0));
    -- Bonus for exceptional peak scores
    c_peak := LEAST(100, c_peak + LEAST(12, COALESCE(v_high_score, 0)::REAL / 615.0));

    -- ═══ C3: WORD OUTPUT (0-100) ═══
    -- avg words per game: 2→20, 5→32, 15→50, 40→67
    c_word_output := LEAST(100, 18.0 * LN(1 + v_avg_words));

    -- ═══ C4: COMBO MASTERY (0-100) ═══
    -- avg combo: 1→14, 3→28, 8→44, 20→60
    c_combo := LEAST(100, 20.0 * LN(1 + v_avg_combo));
    -- Bonus for best single-game combo
    c_combo := LEAST(100, c_combo + LEAST(12, v_best_combo * 1.2));

    -- ═══ C5: VOLUME / EXPERIENCE (0-100) ═══
    -- 5→23, 15→36, 50→51, 200→69
    c_volume := LEAST(100, 13.0 * LN(1 + v_games));

    -- ═══ WEIGHTED COMBINATION (internal 0-100) ═══
    v_internal := (
        c_scoring     * 0.30 +
        c_word_output * 0.25 +
        c_peak        * 0.15 +
        c_combo       * 0.15 +
        c_volume      * 0.15
    );

    -- ═══ EXPAND TO 0-15,000 SCALE (8th-power curve) ═══
    v_skill := 15000.0 * POWER(v_internal / 100.0, 8);

    -- ═══ CONFIDENCE GATE (full rating at 15+ games) ═══
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

-- ────────────────────────────────────────
-- 6. FIX: update_my_challenge_rankings
--    WS call site + all class thresholds 10000/5000/1500 on 0-15,000 scale (8th-power curve)
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_my_challenge_rankings(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
    rec RECORD;
BEGIN
    DELETE FROM challenge_leaderboards WHERE account_id = p_account_id;

    -- ── TARGET WORD ──
    FOR rec IN
        SELECT p.id as profile_id, p.username,
               tw.challenge_skill, tw.skill_class,
               COALESCE(cs.high_score, 0) as high_score,
               COALESCE(cs.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_target_word_skill(p.id) tw
        LEFT JOIN profile_challenge_stats cs
            ON cs.profile_id = p.id AND cs.challenge_type = 'target-word'
        WHERE p.account_id = p_account_id
          AND COALESCE(cs.games_played, 0) > 0
        ORDER BY tw.challenge_skill DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'target-word',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        );
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'target-word'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'target-word'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;

    -- ── SPEED ROUND ──
    FOR rec IN
        SELECT p.id as profile_id, p.username,
               sr.challenge_skill, sr.skill_class,
               COALESCE(cs.high_score, 0) as high_score,
               COALESCE(cs.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_speed_round_skill(p.id) sr
        LEFT JOIN profile_challenge_stats cs
            ON cs.profile_id = p.id AND cs.challenge_type = 'speed-round'
        WHERE p.account_id = p_account_id
          AND COALESCE(cs.games_played, 0) > 0
        ORDER BY sr.challenge_skill DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'speed-round',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        );
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'speed-round'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'speed-round'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;

    -- ── WORD CATEGORY ──
    FOR rec IN
        SELECT p.id as profile_id, p.username,
               wc.challenge_skill, wc.skill_class,
               COALESCE(cs.high_score, 0) as high_score,
               COALESCE(cs.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_word_category_skill(p.id) wc
        LEFT JOIN profile_challenge_stats cs
            ON cs.profile_id = p.id AND cs.challenge_type = 'word-category'
        WHERE p.account_id = p_account_id
          AND COALESCE(cs.games_played, 0) > 0
        ORDER BY wc.challenge_skill DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-category',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        );
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-category'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-category'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;

    -- ── WORD SEARCH (compute_ws_skill returns 0-100, 8th-power curve to 0-15,000) ──
    FOR rec IN
        SELECT p.id as profile_id, p.username,
               (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) as challenge_skill,
               CASE
                   WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 10000 THEN 'master'
                   WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 5000 THEN 'high'
                   WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 1500 THEN 'medium'
                   ELSE 'low'
               END as skill_class,
               COALESCE(wss.high_score, 0) as high_score,
               COALESCE(wss.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_ws_skill(p.id) ws
        LEFT JOIN profile_word_search_stats wss ON wss.profile_id = p.id
        WHERE p.account_id = p_account_id AND COALESCE(wss.games_played, 0) > 0
        ORDER BY ws.ws_skill_rating DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-search',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        );
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-search'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-search'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;

    -- ── WORD RUNNER ──
    FOR rec IN
        SELECT p.id as profile_id, p.username,
               wr.challenge_skill, wr.skill_class,
               COALESCE(cs.high_score, 0) as high_score,
               COALESCE(cs.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_word_runner_skill(p.id) wr
        LEFT JOIN profile_challenge_stats cs
            ON cs.profile_id = p.id AND cs.challenge_type = 'word-runner'
        WHERE p.account_id = p_account_id
          AND COALESCE(cs.games_played, 0) > 0
        ORDER BY wr.challenge_skill DESC LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-runner',
            rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
        );
    END LOOP;

    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-runner'
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) as rn
        FROM challenge_leaderboards WHERE challenge_type = 'word-runner'
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
    FROM class_ranked WHERE cl.id = class_ranked.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-restrict direct access
REVOKE EXECUTE ON FUNCTION update_my_challenge_rankings(UUID) FROM authenticated, anon, public;

-- ────────────────────────────────────────
-- 7. FIX: refresh_challenge_leaderboards
--    Uses per-challenge compute functions, 0-15,000 scale (8th-power curve), 10000/5000/1500 thresholds
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_challenge_leaderboards()
RETURNS void AS $$
DECLARE
    acc RECORD;
    rec RECORD;
    rank_counter INTEGER;
    current_class TEXT;
    class_counter INTEGER;
BEGIN
    DELETE FROM challenge_leaderboards;

    -- ── TARGET WORD (uses compute_target_word_skill → 0-15,000) ──
    FOR acc IN SELECT id FROM accounts WHERE is_banned = FALSE LOOP
        FOR rec IN
            SELECT p.id AS profile_id, p.username,
                   tw.challenge_skill, tw.skill_class,
                   COALESCE(cs.high_score, 0) AS high_score,
                   COALESCE(cs.games_played, 0) AS games_played
            FROM profiles p
            CROSS JOIN LATERAL compute_target_word_skill(p.id) tw
            LEFT JOIN profile_challenge_stats cs
                ON cs.profile_id = p.id AND cs.challenge_type = 'target-word'
            WHERE p.account_id = acc.id
              AND COALESCE(cs.games_played, 0) > 0
            ORDER BY tw.challenge_skill DESC LIMIT 1
        LOOP
            INSERT INTO challenge_leaderboards (
                account_id, profile_id, username, challenge_type,
                challenge_skill_rating, high_score, games_played, skill_class
            ) VALUES (
                acc.id, rec.profile_id, rec.username, 'target-word',
                rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
            );
        END LOOP;
    END LOOP;

    rank_counter := 0;
    FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'target-word' ORDER BY challenge_skill_rating DESC LOOP
        rank_counter := rank_counter + 1;
        UPDATE challenge_leaderboards SET global_rank = rank_counter WHERE id = rec.id;
    END LOOP;
    FOR current_class IN SELECT DISTINCT cl.skill_class FROM challenge_leaderboards cl WHERE cl.challenge_type = 'target-word' LOOP
        class_counter := 0;
        FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'target-word' AND skill_class = current_class ORDER BY challenge_skill_rating DESC LOOP
            class_counter := class_counter + 1;
            UPDATE challenge_leaderboards SET class_rank = class_counter WHERE id = rec.id;
        END LOOP;
    END LOOP;

    -- ── SPEED ROUND (uses compute_speed_round_skill → 0-15,000) ──
    FOR acc IN SELECT id FROM accounts WHERE is_banned = FALSE LOOP
        FOR rec IN
            SELECT p.id AS profile_id, p.username,
                   sr.challenge_skill, sr.skill_class,
                   COALESCE(cs.high_score, 0) AS high_score,
                   COALESCE(cs.games_played, 0) AS games_played
            FROM profiles p
            CROSS JOIN LATERAL compute_speed_round_skill(p.id) sr
            LEFT JOIN profile_challenge_stats cs
                ON cs.profile_id = p.id AND cs.challenge_type = 'speed-round'
            WHERE p.account_id = acc.id
              AND COALESCE(cs.games_played, 0) > 0
            ORDER BY sr.challenge_skill DESC LIMIT 1
        LOOP
            INSERT INTO challenge_leaderboards (
                account_id, profile_id, username, challenge_type,
                challenge_skill_rating, high_score, games_played, skill_class
            ) VALUES (
                acc.id, rec.profile_id, rec.username, 'speed-round',
                rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
            );
        END LOOP;
    END LOOP;

    rank_counter := 0;
    FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'speed-round' ORDER BY challenge_skill_rating DESC LOOP
        rank_counter := rank_counter + 1;
        UPDATE challenge_leaderboards SET global_rank = rank_counter WHERE id = rec.id;
    END LOOP;
    FOR current_class IN SELECT DISTINCT cl.skill_class FROM challenge_leaderboards cl WHERE cl.challenge_type = 'speed-round' LOOP
        class_counter := 0;
        FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'speed-round' AND skill_class = current_class ORDER BY challenge_skill_rating DESC LOOP
            class_counter := class_counter + 1;
            UPDATE challenge_leaderboards SET class_rank = class_counter WHERE id = rec.id;
        END LOOP;
    END LOOP;

    -- ── WORD CATEGORY (uses compute_word_category_skill → 0-15,000) ──
    FOR acc IN SELECT id FROM accounts WHERE is_banned = FALSE LOOP
        FOR rec IN
            SELECT p.id AS profile_id, p.username,
                   wc.challenge_skill, wc.skill_class,
                   COALESCE(cs.high_score, 0) AS high_score,
                   COALESCE(cs.games_played, 0) AS games_played
            FROM profiles p
            CROSS JOIN LATERAL compute_word_category_skill(p.id) wc
            LEFT JOIN profile_challenge_stats cs
                ON cs.profile_id = p.id AND cs.challenge_type = 'word-category'
            WHERE p.account_id = acc.id
              AND COALESCE(cs.games_played, 0) > 0
            ORDER BY wc.challenge_skill DESC LIMIT 1
        LOOP
            INSERT INTO challenge_leaderboards (
                account_id, profile_id, username, challenge_type,
                challenge_skill_rating, high_score, games_played, skill_class
            ) VALUES (
                acc.id, rec.profile_id, rec.username, 'word-category',
                rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
            );
        END LOOP;
    END LOOP;

    rank_counter := 0;
    FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'word-category' ORDER BY challenge_skill_rating DESC LOOP
        rank_counter := rank_counter + 1;
        UPDATE challenge_leaderboards SET global_rank = rank_counter WHERE id = rec.id;
    END LOOP;
    FOR current_class IN SELECT DISTINCT cl.skill_class FROM challenge_leaderboards cl WHERE cl.challenge_type = 'word-category' LOOP
        class_counter := 0;
        FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'word-category' AND skill_class = current_class ORDER BY challenge_skill_rating DESC LOOP
            class_counter := class_counter + 1;
            UPDATE challenge_leaderboards SET class_rank = class_counter WHERE id = rec.id;
        END LOOP;
    END LOOP;

    -- ── WORD SEARCH (compute_ws_skill returns 0-100, 8th-power curve to 0-15,000) ──
    FOR acc IN SELECT id FROM accounts WHERE is_banned = FALSE LOOP
        FOR rec IN
            SELECT p.id AS profile_id, p.username,
                   (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) AS challenge_skill,
                   CASE
                       WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 10000 THEN 'master'
                       WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 5000 THEN 'high'
                       WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 1500 THEN 'medium'
                       ELSE 'low'
                   END AS skill_class,
                   COALESCE(wss.high_score, 0) AS high_score,
                   COALESCE(wss.games_played, 0) AS games_played
            FROM profiles p
            CROSS JOIN LATERAL compute_ws_skill(p.id) ws
            LEFT JOIN profile_word_search_stats wss ON wss.profile_id = p.id
            WHERE p.account_id = acc.id AND COALESCE(wss.games_played, 0) > 0
            ORDER BY ws.ws_skill_rating DESC LIMIT 1
        LOOP
            INSERT INTO challenge_leaderboards (
                account_id, profile_id, username, challenge_type,
                challenge_skill_rating, high_score, games_played, skill_class
            ) VALUES (
                acc.id, rec.profile_id, rec.username, 'word-search',
                rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
            );
        END LOOP;
    END LOOP;

    rank_counter := 0;
    FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'word-search' ORDER BY challenge_skill_rating DESC LOOP
        rank_counter := rank_counter + 1;
        UPDATE challenge_leaderboards SET global_rank = rank_counter WHERE id = rec.id;
    END LOOP;
    FOR current_class IN SELECT DISTINCT cl.skill_class FROM challenge_leaderboards cl WHERE cl.challenge_type = 'word-search' LOOP
        class_counter := 0;
        FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'word-search' AND skill_class = current_class ORDER BY challenge_skill_rating DESC LOOP
            class_counter := class_counter + 1;
            UPDATE challenge_leaderboards SET class_rank = class_counter WHERE id = rec.id;
        END LOOP;
    END LOOP;

    -- ── WORD RUNNER (uses compute_word_runner_skill → 0-15,000) ──
    FOR acc IN SELECT id FROM accounts WHERE is_banned = FALSE LOOP
        FOR rec IN
            SELECT p.id AS profile_id, p.username,
                   wr.challenge_skill, wr.skill_class,
                   COALESCE(cs.high_score, 0) AS high_score,
                   COALESCE(cs.games_played, 0) AS games_played
            FROM profiles p
            CROSS JOIN LATERAL compute_word_runner_skill(p.id) wr
            LEFT JOIN profile_challenge_stats cs
                ON cs.profile_id = p.id AND cs.challenge_type = 'word-runner'
            WHERE p.account_id = acc.id
              AND COALESCE(cs.games_played, 0) > 0
            ORDER BY wr.challenge_skill DESC LIMIT 1
        LOOP
            INSERT INTO challenge_leaderboards (
                account_id, profile_id, username, challenge_type,
                challenge_skill_rating, high_score, games_played, skill_class
            ) VALUES (
                acc.id, rec.profile_id, rec.username, 'word-runner',
                rec.challenge_skill, rec.high_score, rec.games_played, rec.skill_class
            );
        END LOOP;
    END LOOP;

    rank_counter := 0;
    FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'word-runner' ORDER BY challenge_skill_rating DESC LOOP
        rank_counter := rank_counter + 1;
        UPDATE challenge_leaderboards SET global_rank = rank_counter WHERE id = rec.id;
    END LOOP;
    FOR current_class IN SELECT DISTINCT cl.skill_class FROM challenge_leaderboards cl WHERE cl.challenge_type = 'word-runner' LOOP
        class_counter := 0;
        FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = 'word-runner' AND skill_class = current_class ORDER BY challenge_skill_rating DESC LOOP
            class_counter := class_counter + 1;
            UPDATE challenge_leaderboards SET class_rank = class_counter WHERE id = rec.id;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 8. FIX: get_challenge_analysis_data for word-search
--    Nests WS data under 'word_search' key (client expects data.word_search)
--    Uses game_scores COUNT as authoritative games_played
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

    SELECT * INTO v_cl
    FROM challenge_leaderboards
    WHERE profile_id = p_profile_id AND challenge_type = p_challenge_type;

    SELECT * INTO v_cs
    FROM profile_challenge_stats
    WHERE profile_id = p_profile_id AND challenge_type = p_challenge_type;

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

    result := jsonb_build_object(
        'username', v_profile.username,
        'level', v_profile.level,
        'challenge_type', p_challenge_type,
        'skill_rating', COALESCE(v_cl.challenge_skill_rating, 0),
        'skill_class', COALESCE(v_cl.skill_class, 'low'),
        'global_rank', COALESCE(v_cl.global_rank, 0),
        'high_score', COALESCE(v_cs.high_score, 0),
        'games_played', v_total_games,
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

    IF p_challenge_type = 'word-search' THEN
        result := result || jsonb_build_object(
            'word_search', COALESCE(get_ws_stats(p_profile_id), '{}'::JSONB)
        );
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 8b. FIX: get_player_analysis_data — enriched main profile analysis
--     Returns: components, percentiles within class, recent delta,
--     class averages for peer comparison, and notable patterns.
--     NO word_search data (belongs on word-search challenge tab only).
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_player_analysis_data(p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_skill RECORD;
    v_class TEXT;
    v_total_in_class INTEGER;
    v_percentiles JSONB;
    v_class_avgs JSONB;
    v_delta JSONB;
    v_notables JSONB;
    -- For delta calculation
    v_recent_avg REAL;
    v_older_avg REAL;
    v_recent_high INTEGER;
    v_all_time_high INTEGER;
    v_recent_words REAL;
    v_older_words REAL;
    v_streak INTEGER := 0;
    v_improving BOOLEAN := FALSE;
    v_new_pb BOOLEAN := FALSE;
    -- For milestones
    v_total_games INTEGER;
    v_next_milestone INTEGER;
    v_games_to_milestone INTEGER;
BEGIN
    -- Access control
    IF NOT EXISTS (
        SELECT 1 FROM leaderboard_rankings lr
        JOIN profiles p ON p.id = lr.profile_id
        WHERE lr.profile_id = p_profile_id
    ) AND NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = p_profile_id AND account_id = auth.uid()
    ) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_profile FROM profiles WHERE id = p_profile_id;
    IF v_profile IS NULL THEN RETURN NULL; END IF;

    SELECT * INTO v_skill FROM compute_profile_skill(p_profile_id);
    v_class := v_skill.skill_class;

    -- ═══ PERCENTILES WITHIN CLASS ═══
    -- Compare this player's components against all players in the same class
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

    -- ═══ RECENT DELTA (last 10 vs previous 10) ═══
    SELECT COALESCE(AVG(sub.score), 0) INTO v_recent_avg
    FROM (SELECT score FROM game_scores WHERE profile_id = p_profile_id ORDER BY played_at DESC LIMIT 10) sub;

    SELECT COALESCE(AVG(sub.score), 0) INTO v_older_avg
    FROM (SELECT score FROM game_scores WHERE profile_id = p_profile_id ORDER BY played_at DESC LIMIT 10 OFFSET 10) sub;

    SELECT COALESCE(AVG(sub.wf), 0) INTO v_recent_words
    FROM (SELECT words_found::REAL AS wf FROM game_scores WHERE profile_id = p_profile_id ORDER BY played_at DESC LIMIT 10) sub;

    SELECT COALESCE(AVG(sub.wf), 0) INTO v_older_words
    FROM (SELECT words_found::REAL AS wf FROM game_scores WHERE profile_id = p_profile_id ORDER BY played_at DESC LIMIT 10 OFFSET 10) sub;

    v_delta := jsonb_build_object(
        'score_change_pct', CASE WHEN v_older_avg > 0 THEN ROUND(((v_recent_avg - v_older_avg) / v_older_avg * 100)::NUMERIC, 1) ELSE 0 END,
        'words_change_pct', CASE WHEN v_older_words > 0 THEN ROUND(((v_recent_words - v_older_words) / v_older_words * 100)::NUMERIC, 1) ELSE 0 END,
        'recent_avg', ROUND(v_recent_avg::NUMERIC, 1),
        'older_avg', ROUND(v_older_avg::NUMERIC, 1)
    );

    -- ═══ NOTABLE PATTERNS ═══
    v_total_games := v_profile.games_played;

    -- Check for recent personal best (in last 5 games)
    SELECT MAX(sub.score) INTO v_recent_high
    FROM (SELECT score FROM game_scores WHERE profile_id = p_profile_id ORDER BY played_at DESC LIMIT 5) sub;
    v_all_time_high := v_profile.high_score;
    v_new_pb := (v_recent_high IS NOT NULL AND v_recent_high >= v_all_time_high AND v_total_games > 5);

    -- Check for improvement streak (last 5 games each beat previous)
    SELECT COUNT(*) INTO v_streak
    FROM (
        SELECT score, LAG(score) OVER (ORDER BY played_at DESC) AS prev_score
        FROM game_scores WHERE profile_id = p_profile_id ORDER BY played_at DESC LIMIT 6
    ) sub
    WHERE sub.prev_score IS NOT NULL AND sub.score >= sub.prev_score;

    v_improving := (v_streak >= 3);

    -- Next game milestone
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

    -- ═══ BUILD RESULT ═══
    result := jsonb_build_object(
        'username', v_profile.username,
        'level', v_profile.level,
        'games_played', v_profile.games_played,
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

-- ────────────────────────────────────────
-- 9. REBUILD profiles aggregate fields
-- Source: game_scores (games_played, total_words, high_score)
-- ────────────────────────────────────────
UPDATE profiles p SET
    games_played = COALESCE(agg.total_games, 0),
    total_words  = COALESCE(agg.total_words, 0),
    high_score   = COALESCE(agg.max_score, 0),
    updated_at   = NOW()
FROM (
    SELECT
        profile_id,
        COUNT(*)::INTEGER AS total_games,
        COALESCE(SUM(words_found), 0)::INTEGER AS total_words,
        COALESCE(MAX(score), 0)::INTEGER AS max_score
    FROM game_scores
    GROUP BY profile_id
) agg
WHERE p.id = agg.profile_id;

-- Reset profiles with NO game_scores to 0
UPDATE profiles SET
    games_played = 0,
    total_words  = 0,
    high_score   = 0,
    updated_at   = NOW()
WHERE id NOT IN (SELECT DISTINCT profile_id FROM game_scores)
  AND games_played > 0;

-- ────────────────────────────────────────
-- 10. REBUILD profile_challenge_stats
-- Source: game_scores WHERE is_challenge = TRUE
-- Preserves target_word_level (client-tracked, not in game_scores)
-- ────────────────────────────────────────

-- Remove orphaned rows that have no matching games
DELETE FROM profile_challenge_stats pcs
WHERE NOT EXISTS (
    SELECT 1 FROM game_scores gs
    WHERE gs.profile_id = pcs.profile_id
      AND gs.is_challenge = TRUE
      AND gs.challenge_type = pcs.challenge_type
);

-- Upsert rebuilt aggregates (target_word_level left untouched on conflict)
INSERT INTO profile_challenge_stats (profile_id, challenge_type, high_score, games_played, total_words, updated_at)
SELECT
    gs.profile_id,
    gs.challenge_type,
    MAX(gs.score)::INTEGER,
    COUNT(*)::INTEGER,
    COALESCE(SUM(gs.words_found), 0)::INTEGER,
    NOW()
FROM game_scores gs
WHERE gs.is_challenge = TRUE AND gs.challenge_type IS NOT NULL
GROUP BY gs.profile_id, gs.challenge_type
ON CONFLICT (profile_id, challenge_type) DO UPDATE SET
    high_score   = EXCLUDED.high_score,
    games_played = EXCLUDED.games_played,
    total_words  = EXCLUDED.total_words,
    updated_at   = NOW();

-- ────────────────────────────────────────
-- 11. REBUILD profile_high_scores
-- Source: game_scores grouped by dimension key
-- ────────────────────────────────────────
TRUNCATE profile_high_scores;

INSERT INTO profile_high_scores (
    profile_id, game_mode, is_challenge, challenge_type, category_key,
    grid_size, difficulty, time_limit_seconds,
    high_score, best_words_found, best_combo, best_longest_word,
    best_target_words, games_played, total_score, avg_score,
    achieved_at, updated_at
)
SELECT
    profile_id,
    game_mode,
    is_challenge,
    challenge_type,
    category_key,
    grid_size,
    difficulty,
    time_limit_seconds,
    MAX(score)::INTEGER,
    MAX(words_found)::INTEGER,
    MAX(best_combo)::INTEGER,
    MAX(longest_word_length)::INTEGER,
    MAX(target_words_completed)::INTEGER,
    COUNT(*)::INTEGER,
    SUM(score)::BIGINT,
    AVG(score)::REAL,
    MAX(played_at),
    NOW()
FROM game_scores
GROUP BY profile_id, game_mode, is_challenge, challenge_type, category_key,
         grid_size, difficulty, time_limit_seconds;

-- ────────────────────────────────────────
-- 12. REBUILD profile_category_stats
-- Source: game_scores WHERE challenge_type = 'word-category'
-- ────────────────────────────────────────
TRUNCATE profile_category_stats;

INSERT INTO profile_category_stats (
    profile_id, category_key, high_score, games_played,
    total_category_words, best_category_words_per_game,
    high_score_grid_3, high_score_grid_4, high_score_grid_5,
    high_score_grid_6, high_score_grid_7, high_score_grid_8,
    updated_at
)
SELECT
    profile_id,
    category_key,
    MAX(score)::INTEGER,
    COUNT(*)::INTEGER,
    COALESCE(SUM(bonus_words_completed), 0)::INTEGER,
    COALESCE(MAX(bonus_words_completed), 0)::INTEGER,
    COALESCE(MAX(CASE WHEN grid_size = 3 THEN score END), 0)::INTEGER,
    COALESCE(MAX(CASE WHEN grid_size = 4 THEN score END), 0)::INTEGER,
    COALESCE(MAX(CASE WHEN grid_size = 5 THEN score END), 0)::INTEGER,
    COALESCE(MAX(CASE WHEN grid_size = 6 THEN score END), 0)::INTEGER,
    COALESCE(MAX(CASE WHEN grid_size = 7 THEN score END), 0)::INTEGER,
    COALESCE(MAX(CASE WHEN grid_size = 8 THEN score END), 0)::INTEGER,
    NOW()
FROM game_scores
WHERE challenge_type = 'word-category' AND category_key IS NOT NULL
GROUP BY profile_id, category_key;

-- ────────────────────────────────────────
-- 13. REBUILD profile_word_search_stats (most complex)
-- Source: game_scores WHERE challenge_type = 'word-search'
-- ────────────────────────────────────────
TRUNCATE profile_word_search_stats;

WITH ws_games AS (
    SELECT
        profile_id,
        score,
        grid_size,
        COALESCE(target_words_completed, 0) AS total_found,
        COALESCE(bonus_words_completed, 0) AS bonus_found,
        GREATEST(0, COALESCE(target_words_completed, 0) - COALESCE(bonus_words_completed, 0)) AS placed_found,
        COALESCE(time_limit_seconds, 420)::REAL AS time_limit,
        (COALESCE(time_limit_seconds, 420) - COALESCE(time_remaining_seconds, 0))::REAL AS time_used,
        (time_remaining_seconds IS NOT NULL AND time_remaining_seconds > 0) AS is_perfect,
        played_at,
        ROW_NUMBER() OVER (PARTITION BY profile_id ORDER BY played_at DESC) AS rn
    FROM game_scores
    WHERE is_challenge = TRUE AND challenge_type = 'word-search'
),

rolling_windows AS (
    SELECT
        profile_id,
        jsonb_agg(
            jsonb_build_object(
                'placed', placed_found,
                'found', total_found,
                'bonus', bonus_found,
                'time_used', ROUND(time_used::NUMERIC, 1),
                'time_limit', time_limit,
                'score', score,
                'level', grid_size,
                'perfect', is_perfect,
                'played_at', played_at
            ) ORDER BY played_at DESC
        ) AS recent_games
    FROM ws_games
    WHERE rn <= 50
    GROUP BY profile_id
),

rolling_avgs AS (
    SELECT
        rw.profile_id,
        AVG(LEAST(1.0, (elem->>'found')::REAL / GREATEST((elem->>'placed')::REAL, 1))) AS avg_comp,
        AVG((elem->>'time_used')::REAL / GREATEST((elem->>'time_limit')::REAL, 1)) AS avg_eff,
        AVG((elem->>'score')::REAL) AS avg_score
    FROM rolling_windows rw,
         jsonb_array_elements(rw.recent_games) AS elem
    GROUP BY rw.profile_id
),

ws_agg AS (
    SELECT
        profile_id,
        COUNT(*)::INTEGER AS games_played,
        SUM(total_found)::INTEGER AS total_words_found,
        SUM(placed_found)::INTEGER AS total_placed_words,
        SUM(bonus_found)::INTEGER AS total_bonus_words,
        COUNT(*) FILTER (WHERE is_perfect)::INTEGER AS perfect_clears,
        MAX(score)::INTEGER AS high_score,
        MAX(total_found)::INTEGER AS best_words_per_game,
        MAX(grid_size)::INTEGER AS highest_level_reached,
        MIN(time_used) FILTER (WHERE is_perfect) AS fastest_clear_seconds,
        MAX(bonus_found)::INTEGER AS best_bonus_words_single
    FROM ws_games
    GROUP BY profile_id
)

INSERT INTO profile_word_search_stats (
    profile_id, games_played, total_words_found, total_placed_words,
    total_bonus_words, perfect_clears,
    high_score, best_words_per_game, highest_level_reached,
    fastest_clear_seconds, best_bonus_words_single,
    avg_completion_rate, avg_time_efficiency, avg_score_per_game,
    recent_games, updated_at
)
SELECT
    a.profile_id,
    a.games_played,
    a.total_words_found,
    a.total_placed_words,
    a.total_bonus_words,
    a.perfect_clears,
    a.high_score,
    a.best_words_per_game,
    COALESCE(a.highest_level_reached, 1),
    a.fastest_clear_seconds,
    a.best_bonus_words_single,
    COALESCE(r.avg_comp, 0)::REAL,
    COALESCE(r.avg_eff, 0)::REAL,
    COALESCE(r.avg_score, 0)::REAL,
    COALESCE(rw.recent_games, '[]'::JSONB),
    NOW()
FROM ws_agg a
LEFT JOIN rolling_avgs r ON r.profile_id = a.profile_id
LEFT JOIN rolling_windows rw ON rw.profile_id = a.profile_id;

-- ────────────────────────────────────────
-- 14. REFRESH ALL MATERIALIZED VIEWS
-- ────────────────────────────────────────
SELECT refresh_materialized_views();

-- ────────────────────────────────────────
-- 15. RECOMPUTE ALL LEADERBOARD RANKINGS
-- All compute functions now use 0-15,000 scale (8th-power curve) with 10000/5000/1500 class thresholds
-- ────────────────────────────────────────
SELECT refresh_leaderboard();
SELECT refresh_challenge_leaderboards();
