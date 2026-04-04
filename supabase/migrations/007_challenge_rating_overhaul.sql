-- ============================================================
-- MIGRATION 007: Challenge Rating Formula Overhaul
-- ============================================================
-- PROBLEM: All challenge ratings use a single log formula capped at 100,
--          with class thresholds at 65/35. A score of 100 in speed-round
--          already hits "high class". The main leaderboard uses a rich
--          8-component 0-10,000 scale — challenges need the same depth.
--
-- SOLUTION: Per-challenge compute functions with multi-component vectors,
--           0-10,000 scale (squared from 0-100 internal), confidence gates,
--           and class thresholds matching the main board (5000/1500).
-- ============================================================

-- ────────────────────────────────────────
-- 1. TARGET WORD: compute_target_word_skill(profile_id)
--    Components: scoring power, target efficiency, consistency,
--                combo mastery, volume/experience
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
    -- Components (each 0-100)
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

    -- Aggregate from game_scores
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

    -- ═══ C1: SCORING POWER (0-100) ═══
    -- Log scale: score 500→30, 2000→50, 5000→65, 10000→75, 30000→90
    c_scoring := LEAST(100, 18.0 * LN(1 + v_avg_score / 100.0));

    -- ═══ C2: TARGET EFFICIENCY (0-100) ═══
    -- How many target words per game on average
    -- 1→15, 3→40, 5→55, 8→70, 12→85, 20→100
    c_target_eff := LEAST(100, 15.0 + 30.0 * LN(1 + v_avg_targets));
    -- Bonus for best single-game targets
    c_target_eff := LEAST(100, c_target_eff + LEAST(20, v_best_targets * 1.5));

    -- ═══ C3: CONSISTENCY (0-100) ═══
    -- Low stddev relative to mean = consistent
    IF v_avg_score > 0 THEN
        c_consistency := LEAST(100, GREATEST(0,
            100 * (1.0 - LEAST(1.0, v_score_stddev / GREATEST(v_avg_score, 1)))
        ));
    END IF;

    -- ═══ C4: COMBO MASTERY (0-100) ═══
    -- Average combo achievement: 2→20, 5→45, 10→65, 20→82, 50→100
    c_combo := LEAST(100, 25.0 * LN(1 + v_avg_combo));

    -- ═══ C5: VOLUME / EXPERIENCE (0-100) ═══
    -- Diminishing returns: 10g→30, 30g→50, 80g→70, 200g→85, 500g→100
    c_volume := LEAST(100, 16.0 * LN(1 + v_games));

    -- ═══ WEIGHTED COMBINATION ═══
    v_internal := (
        c_scoring     * 0.25 +
        c_target_eff  * 0.30 +
        c_consistency * 0.15 +
        c_combo       * 0.15 +
        c_volume      * 0.15
    );

    -- ═══ EXPAND TO 0-10,000 SCALE ═══
    v_skill := v_internal * v_internal / 100.0;

    -- ═══ CONFIDENCE GATE (full rating at 15+ games) ═══
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    -- ═══ CLASS ═══
    IF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ────────────────────────────────────────
-- 2. SPEED ROUND: compute_speed_round_skill(profile_id)
--    Components: words per minute, scoring density, word count,
--                consistency, volume
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
    -- Components
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

    -- ═══ C1: WORDS PER MINUTE (0-100) ═══
    -- 2wpm→20, 4wpm→35, 7wpm→50, 12wpm→65, 20wpm→80, 35wpm→95
    c_wpm := LEAST(100, 28.0 * LN(1 + v_avg_wpm));

    -- ═══ C2: SCORING POWER (0-100) ═══
    -- Average score: 200→30, 800→45, 2500→60, 8000→75, 25000→90
    c_scoring := LEAST(100, 16.0 * LN(1 + v_avg_score / 50.0));

    -- ═══ C3: WORD COUNT PER GAME (0-100) ═══
    -- 5→25, 15→40, 30→55, 60→70, 120→85
    c_word_count := LEAST(100, 20.0 * LN(1 + v_avg_words));
    -- Bonus for best single game
    c_word_count := LEAST(100, c_word_count + LEAST(15, v_best_words * 0.3));

    -- ═══ C4: CONSISTENCY (0-100) ═══
    IF v_avg_score > 0 THEN
        c_consistency := LEAST(100, GREATEST(0,
            100 * (1.0 - LEAST(1.0, v_score_stddev / GREATEST(v_avg_score, 1)))
        ));
    END IF;

    -- ═══ C5: VOLUME (0-100) ═══
    c_volume := LEAST(100, 16.0 * LN(1 + v_games));

    -- ═══ WEIGHTED — speed is king ═══
    v_internal := (
        c_wpm         * 0.30 +
        c_scoring     * 0.25 +
        c_word_count  * 0.15 +
        c_consistency * 0.15 +
        c_volume      * 0.15
    );

    v_skill := v_internal * v_internal / 100.0;
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    IF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ────────────────────────────────────────
-- 3. WORD CATEGORY: compute_word_category_skill(profile_id)
--    Components: category word rate, scoring, category breadth,
--                consistency, volume
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
    -- Components
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

    -- How many distinct categories played
    SELECT COUNT(DISTINCT category_key)
    INTO v_num_categories
    FROM profile_category_stats
    WHERE profile_id = p_profile_id;

    -- ═══ C1: CATEGORY WORD RATE (0-100) ═══
    -- Avg category words per game: 2→25, 5→45, 10→60, 20→75, 40→90
    c_cat_words := LEAST(100, 28.0 * LN(1 + v_avg_cat_words));
    -- Bonus for best single game performance
    c_cat_words := LEAST(100, c_cat_words + LEAST(15, v_best_cat_words * 1.2));

    -- ═══ C2: SCORING POWER (0-100) ═══
    c_scoring := LEAST(100, 18.0 * LN(1 + v_avg_score / 100.0));

    -- ═══ C3: CATEGORY BREADTH (0-100) ═══
    -- 6 possible categories: 1→17, 2→33, 3→50, 4→67, 5→83, 6→100
    c_breadth := LEAST(100, (v_num_categories::REAL / 6.0) * 100);

    -- ═══ C4: CONSISTENCY (0-100) ═══
    IF v_avg_score > 0 THEN
        c_consistency := LEAST(100, GREATEST(0,
            100 * (1.0 - LEAST(1.0, v_score_stddev / GREATEST(v_avg_score, 1)))
        ));
    END IF;

    -- ═══ C5: VOLUME (0-100) ═══
    c_volume := LEAST(100, 16.0 * LN(1 + v_games));

    -- ═══ WEIGHTED — category words matter most ═══
    v_internal := (
        c_cat_words   * 0.30 +
        c_scoring     * 0.25 +
        c_breadth     * 0.15 +
        c_consistency * 0.15 +
        c_volume      * 0.15
    );

    v_skill := v_internal * v_internal / 100.0;
    v_skill := v_skill * LEAST(1.0, v_games / 15.0);

    IF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ────────────────────────────────────────
-- 4. UPDATE update_my_challenge_rankings to use new compute functions
--    Also update word-search to use same 0-10,000 scale & thresholds
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_my_challenge_rankings(p_account_id UUID)
RETURNS void AS $$
DECLARE
    rec RECORD;
BEGIN
    -- Remove existing entries for this account
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

    -- Recompute ranks for target-word
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

    -- ── WORD SEARCH (uses existing compute_ws_skill, but apply squared scale) ──
    FOR rec IN
        SELECT p.id as profile_id, p.username,
               -- Square the 0-100 WS skill to get 0-10,000 scale
               (ws.ws_skill_rating * ws.ws_skill_rating / 100.0) as challenge_skill,
               CASE
                   WHEN (ws.ws_skill_rating * ws.ws_skill_rating / 100.0) >= 5000 THEN 'high'
                   WHEN (ws.ws_skill_rating * ws.ws_skill_rating / 100.0) >= 1500 THEN 'medium'
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-restrict direct access (called via update_my_ranking only)
REVOKE EXECUTE ON FUNCTION update_my_challenge_rankings(UUID) FROM authenticated, anon, public;
