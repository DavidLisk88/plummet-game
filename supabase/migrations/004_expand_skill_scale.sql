-- ============================================================
-- Expand skill rating to 0-10,000 scale with confidence gate
--
-- Changes:
--   1. Squares the internal 0-100 score → 0-10,000 range
--   2. Adds games-played confidence: min(1, games / 50)
--   3. New class thresholds: Low <1500, Medium 1500-4999, High 5000+
-- ============================================================

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
    rec RECORD;
BEGIN
    SELECT COUNT(*) INTO v_total_games FROM game_scores WHERE game_scores.profile_id = p_profile_id;
    IF v_total_games < 1 THEN
        RETURN QUERY SELECT 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    -- 1. RAW SCORE (0-100)
    SELECT LEAST(100, 25 * LN(1 + GREATEST(0, AVG(sub.top_score)) / 100))
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
            25 * LN(1 + gs.high_score / 200.0) *
            LEAST(1, gs.games_played / 3.0)
        ) / NULLIF(COUNT(*), 0) * 2.5, 0))
    INTO v_grid
    FROM profile_high_scores gs WHERE gs.profile_id = p_profile_id;

    -- 3. DIFFICULTY (0-100)
    SELECT LEAST(100, COALESCE(
        (
            (SELECT COALESCE(AVG(25 * LN(1 + score / 150.0)), 0)
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
            20 * LN(1 + gs.high_score / 100.0) *
            LEAST(1, gs.games_played / 2.0)
        ) / NULLIF(COUNT(*), 0) * 3.0, 0))
    INTO v_time
    FROM profile_high_scores gs
    WHERE gs.profile_id = p_profile_id AND gs.game_mode = 'timed' AND gs.time_limit_seconds IS NOT NULL;

    -- 5. CHALLENGE (0-100)
    SELECT LEAST(100, COALESCE(
        SUM(
            CASE cs.challenge_type
                WHEN 'speed-round' THEN 1.75
                WHEN 'target-word' THEN 1.5
                WHEN 'word-category' THEN 1.3
                ELSE 1.0
            END *
            20 * LN(1 + cs.high_score / 150.0) *
            LEAST(1, cs.games_played / 3.0)
        ) / NULLIF(COUNT(*), 0) * 3.0, 0))
    INTO v_challenge
    FROM profile_challenge_stats cs WHERE cs.profile_id = p_profile_id;

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
            / 30.0 * 50
            +
            (SELECT COUNT(*)::REAL FROM profile_high_scores
             WHERE profile_high_scores.profile_id = p_profile_id AND high_score > 500)
            / 10.0 * 50
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

    -- EXPAND TO 0-10000 SCALE (square the internal score)
    v_skill := v_skill * v_skill / 100.0;

    -- GAMES-PLAYED CONFIDENCE GATE (need 50 games for full rating)
    v_skill := v_skill * LEAST(1.0, v_total_games / 50.0);

    -- DETERMINE CLASS
    IF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_raw, v_grid, v_diff, v_time, v_challenge, v_consistency, v_versatility, v_progression, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
