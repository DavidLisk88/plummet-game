-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 025: Fix skill rating formula                               ║
-- ║                                                                        ║
-- ║  Problems fixed:                                                       ║
-- ║  1. Consistency component = 0 for players with varied score ranges     ║
-- ║     across different game modes (CV penalty was too harsh)             ║
-- ║  2. 8th-power expansion curve was too brutal — small component         ║
-- ║     improvements barely moved the final rating                         ║
-- ║  3. Recomputes all ratings and leaderboard rankings                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════
-- PART 1: Replace compute_profile_skill
-- ════════════════════════════════════════

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
        -- FIX: Give casual-only players a floor based on their raw performance
        -- so 15% of the total isn't permanently stuck at 0.
        -- Playing normal with high scores still shows skill.
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

    -- Blend in WS skill
    IF v_ws_games >= 5 THEN
        DECLARE
            v_ws_blend REAL;
        BEGIN
            v_ws_blend := LEAST(0.4, (v_ws_games - 5)::REAL / 62.5);
            v_challenge := v_challenge * (1.0 - v_ws_blend) + v_ws_skill * v_ws_blend;
        END;
    END IF;

    -- ── 6. CONSISTENCY (0-100) ──
    -- FIX: Use smooth inverse-CV formula instead of linear penalty.
    -- Old formula gave 0 when CV > 1 (common for players using multiple modes).
    -- New formula: 100 / (1 + CV) → CV=0.5→67, CV=1→50, CV=2→33, CV=5→17
    -- Active players always get meaningful credit.
    SELECT LEAST(100, COALESCE(
        CASE
            WHEN sub.avg_val IS NULL OR sub.avg_val < 10 THEN
                -- Low-scoring games: give partial credit based on game count
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
            -- Not enough older games to compare — give generous default
            v_progression := 55;
        ELSE
            -- FIX: Smoother sigmoid, biased upward so it's never below 20.
            -- Ratio > 1 (improving) → 55-85. Ratio = 1 (stable) → 55. Ratio < 1 → 20-55.
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

    -- FIX: EXPAND TO 0-15,000 SCALE using 3.0-power curve (was 8th — too brutal)
    -- Power 3.0 is friendly and responsive to component improvements:
    --   Components avg 50/100 → 15000 × 0.50^3.0 = 1,875  (low)
    --   Components avg 60/100 → 15000 × 0.60^3.0 = 3,240  (medium)
    --   Components avg 70/100 → 15000 × 0.70^3.0 = 5,145  (high)
    --   Components avg 80/100 → 15000 × 0.80^3.0 = 7,680  (high)
    --   Components avg 90/100 → 15000 × 0.90^3.0 = 10,935 (master)
    v_skill := 15000.0 * POWER(v_skill / 100.0, 3.0);

    -- FIX: Activity bonus — every game played guarantees a small upward drift.
    -- LN(1 + games) * 15:  10 games → +36, 50 games → +59, 100 games → +69
    -- Enough to ensure ratings always increase, too small to dominate.
    v_skill := v_skill + LN(1 + v_total_games) * 15;

    -- FIX: Faster confidence gate — 25 games instead of 50 to reach full potential.
    -- New players reach 100% in fewer games, so they see meaningful growth sooner.
    v_skill := v_skill * LEAST(1.0, v_total_games / 25.0);

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


-- ════════════════════════════════════════
-- PART 2: Recompute ALL ratings and leaderboard rankings
-- ════════════════════════════════════════

-- First: reset skill_rating on profile_game_stats so the ratchet doesn't block updates
UPDATE profile_game_stats SET skill_rating = 0;

-- Recompute rankings for ALL accounts
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
            -- Reset the leaderboard row so the ratchet doesn't block the new formula
            UPDATE leaderboard_rankings SET skill_rating = 0 WHERE account_id = v_acct.account_id;
            PERFORM update_ranking_for_account(v_acct.account_id);
            v_count := v_count + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '025 recompute: ranking failed for account %: %', v_acct.account_id, SQLERRM;
        END;
    END LOOP;
    RAISE NOTICE '025 recompute: recomputed rankings for % accounts', v_count;
END;
$$;

-- Backfill profile_game_stats.skill_rating from recomputed leaderboard
UPDATE profile_game_stats pgs SET
    skill_rating = COALESCE(lr.skill_rating, 0)
FROM leaderboard_rankings lr
WHERE lr.profile_id = pgs.profile_id;
