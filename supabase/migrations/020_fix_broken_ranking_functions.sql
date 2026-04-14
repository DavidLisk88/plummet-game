-- ════════════════════════════════════════════════════════════════════════════
-- Migration 020: Fix broken ranking functions from Migration 017
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migration 017 ("master skill class") replaced update_my_challenge_rankings()
-- with a version that references NON-EXISTENT functions and columns:
--   - calculate_target_word_skill  → should be compute_target_word_skill
--   - calculate_speed_round_skill  → should be compute_speed_round_skill
--   - calculate_word_category_skill → should be compute_word_category_skill
--   - calculate_word_search_skill  → should be compute_word_search_skill  (never existed)
--   - calculate_word_runner_skill  → should be compute_word_runner_skill
--   - p.display_name               → should be p.username
--   - (p.stats->>'xp')::INT       → should be p.xp
--
-- This caused update_my_challenge_rankings() to throw an error at runtime.
-- Since update_ranking_for_account() calls it without exception handling,
-- the ENTIRE ranking update (both main + challenge) silently failed.
--
-- This migration:
--   1. Restores the correct update_my_challenge_rankings() (from 013, with master class)
--   2. Drops the broken update_my_rankings() (plural) that was never called
--   3. Backfills all ranking data for every account
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. Fix: update_my_challenge_rankings() — correct function/column references
--    Restored from migration 013 design with master skill class support
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_my_challenge_rankings(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
    rec RECORD;
BEGIN
    -- ── TARGET WORD ──
    -- Count games_played and high_score from game_scores (authoritative)
    -- instead of profile_challenge_stats (stale cache)
    FOR rec IN
        SELECT p.id as profile_id, p.username,
               tw.challenge_skill, tw.skill_class,
               COALESCE(gs_agg.high_score, 0) as high_score,
               COALESCE(gs_agg.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_target_word_skill(p.id) tw
        LEFT JOIN LATERAL (
            SELECT MAX(gs.score)::INTEGER as high_score,
                   COUNT(*)::INTEGER as games_played
            FROM game_scores gs
            WHERE gs.profile_id = p.id
              AND gs.challenge_type = 'target-word'
              AND gs.is_challenge = TRUE
        ) gs_agg ON TRUE
        WHERE p.account_id = p_account_id
          AND COALESCE(gs_agg.games_played, 0) > 0
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
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
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
               COALESCE(gs_agg.high_score, 0) as high_score,
               COALESCE(gs_agg.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_speed_round_skill(p.id) sr
        LEFT JOIN LATERAL (
            SELECT MAX(gs.score)::INTEGER as high_score,
                   COUNT(*)::INTEGER as games_played
            FROM game_scores gs
            WHERE gs.profile_id = p.id
              AND gs.challenge_type = 'speed-round'
              AND gs.is_challenge = TRUE
        ) gs_agg ON TRUE
        WHERE p.account_id = p_account_id
          AND COALESCE(gs_agg.games_played, 0) > 0
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
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
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
               COALESCE(gs_agg.high_score, 0) as high_score,
               COALESCE(gs_agg.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_word_category_skill(p.id) wc
        LEFT JOIN LATERAL (
            SELECT MAX(gs.score)::INTEGER as high_score,
                   COUNT(*)::INTEGER as games_played
            FROM game_scores gs
            WHERE gs.profile_id = p.id
              AND gs.challenge_type = 'word-category'
              AND gs.is_challenge = TRUE
        ) gs_agg ON TRUE
        WHERE p.account_id = p_account_id
          AND COALESCE(gs_agg.games_played, 0) > 0
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
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
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

    -- ── WORD SEARCH ──
    FOR rec IN
        SELECT p.id as profile_id, p.username,
               (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) as challenge_skill,
               CASE
                   WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 10000 THEN 'master'
                   WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 5000 THEN 'high'
                   WHEN (15000.0 * POWER(ws.ws_skill_rating / 100.0, 8)) >= 1500 THEN 'medium'
                   ELSE 'low'
               END as skill_class,
               COALESCE(gs_agg.high_score, 0) as high_score,
               COALESCE(gs_agg.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_ws_skill(p.id) ws
        LEFT JOIN LATERAL (
            SELECT MAX(gs.score)::INTEGER as high_score,
                   COUNT(*)::INTEGER as games_played
            FROM game_scores gs
            WHERE gs.profile_id = p.id
              AND gs.challenge_type = 'word-search'
              AND gs.is_challenge = TRUE
        ) gs_agg ON TRUE
        WHERE p.account_id = p_account_id AND COALESCE(gs_agg.games_played, 0) > 0
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
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
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
               COALESCE(gs_agg.high_score, 0) as high_score,
               COALESCE(gs_agg.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_word_runner_skill(p.id) wr
        LEFT JOIN LATERAL (
            SELECT MAX(gs.score)::INTEGER as high_score,
                   COUNT(*)::INTEGER as games_played
            FROM game_scores gs
            WHERE gs.profile_id = p.id
              AND gs.challenge_type = 'word-runner'
              AND gs.is_challenge = TRUE
        ) gs_agg ON TRUE
        WHERE p.account_id = p_account_id
          AND COALESCE(gs_agg.games_played, 0) > 0
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
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class ELSE EXCLUDED.skill_class END,
            computed_at = NOW();
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
-- 2. Drop the broken update_my_rankings() (plural) from migration 017
--    This function was never called by the client but references
--    non-existent compute_skill_subscores() and p.display_name
-- ────────────────────────────────────────
DROP FUNCTION IF EXISTS update_my_rankings(UUID);

-- ────────────────────────────────────────
-- 3. Fix get_my_rank() — add profile_id so client can fetch analysis data
-- ────────────────────────────────────────
DROP FUNCTION IF EXISTS get_my_rank();

CREATE OR REPLACE FUNCTION get_my_rank()
RETURNS TABLE (
    global_rank INTEGER,
    skill_class TEXT,
    class_rank INTEGER,
    skill_rating REAL,
    username TEXT,
    profile_id UUID,
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
           lr.raw_score_component, lr.grid_mastery_component,
           lr.difficulty_component, lr.time_pressure_component, lr.challenge_component,
           lr.consistency_component, lr.versatility_component, lr.progression_component
    FROM leaderboard_rankings lr
    WHERE lr.account_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 4. Fix get_my_challenge_rank() — add profile_id so client can fetch
--    challenge analysis data; add high_score/games_played from DB
-- ────────────────────────────────────────
DROP FUNCTION IF EXISTS get_my_challenge_rank(TEXT);

CREATE OR REPLACE FUNCTION get_my_challenge_rank(p_challenge_type TEXT)
RETURNS TABLE (
    global_rank INTEGER,
    skill_class TEXT,
    class_rank INTEGER,
    skill_rating REAL,
    username TEXT,
    profile_id UUID,
    high_score INTEGER,
    games_played INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT cl.global_rank, cl.skill_class, cl.class_rank,
           cl.challenge_skill_rating AS skill_rating,
           cl.username, cl.profile_id, cl.high_score, cl.games_played
    FROM challenge_leaderboards cl
    WHERE cl.account_id = auth.uid()
      AND cl.challenge_type = p_challenge_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 5. Enrich get_player_analysis_data() — add high_score, total_words,
--    play_streak so "Your Rank" dropdown can show DB-authoritative stats
--    instead of local profile data
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
    v_recent_avg REAL;
    v_older_avg REAL;
    v_recent_high INTEGER;
    v_all_time_high INTEGER;
    v_recent_words REAL;
    v_older_words REAL;
    v_streak INTEGER := 0;
    v_improving BOOLEAN := FALSE;
    v_new_pb BOOLEAN := FALSE;
    v_total_games INTEGER;
    v_next_milestone INTEGER;
    v_games_to_milestone INTEGER;
BEGIN
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

    v_total_games := v_profile.games_played;

    SELECT MAX(sub.score) INTO v_recent_high
    FROM (SELECT score FROM game_scores WHERE profile_id = p_profile_id ORDER BY played_at DESC LIMIT 5) sub;
    v_all_time_high := v_profile.high_score;
    v_new_pb := (v_recent_high IS NOT NULL AND v_recent_high >= v_all_time_high AND v_total_games > 5);

    SELECT COUNT(*) INTO v_streak
    FROM (
        SELECT score, LAG(score) OVER (ORDER BY played_at DESC) AS prev_score
        FROM game_scores WHERE profile_id = p_profile_id ORDER BY played_at DESC LIMIT 6
    ) sub
    WHERE sub.prev_score IS NOT NULL AND sub.score >= sub.prev_score;

    v_improving := (v_streak >= 3);

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
        'games_played', v_profile.games_played,
        'high_score', v_profile.high_score,
        'total_words', v_profile.total_words,
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

-- ────────────────────────────────────────
-- 6. Fix get_challenge_analysis_data() — read ALL stats from game_scores
--    The old version read high_score, total_words, target_word_level from
--    profile_challenge_stats (stale cache). Now everything is counted
--    directly from game_scores (the authoritative source).
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
    v_recent_scores JSONB;
    v_avg_score REAL;
    v_score_stddev REAL;
    v_best_combo INTEGER;
    v_avg_words REAL;
    v_total_games INTEGER;
    v_high_score INTEGER;
    v_total_words INTEGER;
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

    -- ALL stats from game_scores — zero reliance on cache tables
    SELECT
        COALESCE(AVG(gs.score), 0),
        COALESCE(STDDEV(gs.score), 0),
        COALESCE(MAX(gs.best_combo), 0),
        COALESCE(AVG(gs.words_found), 0),
        COUNT(*)::INTEGER,
        COALESCE(MAX(gs.score), 0)::INTEGER,
        COALESCE(SUM(gs.words_found), 0)::INTEGER
    INTO v_avg_score, v_score_stddev, v_best_combo, v_avg_words,
         v_total_games, v_high_score, v_total_words
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
        'high_score', v_high_score,
        'games_played', v_total_games,
        'total_words', v_total_words,
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
            'target_word_level', COALESCE((
                SELECT MAX(gs.target_words_completed)
                FROM game_scores gs
                WHERE gs.profile_id = p_profile_id
                  AND gs.challenge_type = 'target-word' AND gs.is_challenge = TRUE
            ), 1),
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
            )
        );
    END IF;

    IF p_challenge_type = 'word-runner' THEN
        result := result || jsonb_build_object(
            'avg_distance', (
                SELECT ROUND(COALESCE(AVG(gs.score), 0)::NUMERIC, 1)
                FROM game_scores gs
                WHERE gs.profile_id = p_profile_id
                  AND gs.challenge_type = 'word-runner' AND gs.is_challenge = TRUE
            ),
            'best_distance', (
                SELECT COALESCE(MAX(gs.score), 0)
                FROM game_scores gs
                WHERE gs.profile_id = p_profile_id
                  AND gs.challenge_type = 'word-runner' AND gs.is_challenge = TRUE
            )
        );
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 7. Auto-trigger: recompute rankings on every game_scores INSERT
--    This makes rankings fully server-authoritative — no client call needed.
--    The trigger looks up the account from the profile and recomputes
--    both the main leaderboard ranking AND all challenge rankings.
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_update_ranking_on_game()
RETURNS TRIGGER AS $$
DECLARE
    v_account_id UUID;
BEGIN
    SELECT account_id INTO v_account_id
    FROM profiles WHERE id = NEW.profile_id;

    IF v_account_id IS NOT NULL THEN
        PERFORM update_ranking_for_account(v_account_id);
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never block game recording if ranking computation fails
    RAISE WARNING 'auto_update_ranking_on_game failed for profile %: %', NEW.profile_id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_update_ranking ON game_scores;
CREATE TRIGGER trg_auto_update_ranking
    AFTER INSERT ON game_scores
    FOR EACH ROW EXECUTE FUNCTION auto_update_ranking_on_game();

-- ────────────────────────────────────────
-- 8. Backfill: Fix stale profile_challenge_stats from game_scores (truth)
--    The stats table was broken before migration 019, so games_played,
--    high_score, and total_words may be wrong. Recompute from game_scores.
-- ────────────────────────────────────────

-- Fix existing rows
UPDATE profile_challenge_stats cs SET
    games_played = gs_agg.games_played,
    high_score = gs_agg.high_score,
    total_words = gs_agg.total_words
FROM (
    SELECT profile_id, challenge_type,
           COUNT(*)::INTEGER as games_played,
           COALESCE(MAX(score), 0)::INTEGER as high_score,
           COALESCE(SUM(words_found), 0)::INTEGER as total_words
    FROM game_scores
    WHERE is_challenge = TRUE AND challenge_type IS NOT NULL
    GROUP BY profile_id, challenge_type
) gs_agg
WHERE cs.profile_id = gs_agg.profile_id
  AND cs.challenge_type = gs_agg.challenge_type;

-- Insert missing rows (games recorded but no stats row exists)
INSERT INTO profile_challenge_stats (profile_id, challenge_type, high_score, games_played, total_words)
SELECT gs.profile_id, gs.challenge_type,
       MAX(gs.score)::INTEGER,
       COUNT(*)::INTEGER,
       COALESCE(SUM(gs.words_found), 0)::INTEGER
FROM game_scores gs
WHERE gs.is_challenge = TRUE AND gs.challenge_type IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM profile_challenge_stats cs
    WHERE cs.profile_id = gs.profile_id AND cs.challenge_type = gs.challenge_type
  )
GROUP BY gs.profile_id, gs.challenge_type;

-- Also fix profile_word_search_stats (word-search uses a separate table)
UPDATE profile_word_search_stats wss SET
    games_played = gs_agg.games_played,
    high_score = gs_agg.high_score
FROM (
    SELECT profile_id,
           COUNT(*)::INTEGER as games_played,
           COALESCE(MAX(score), 0)::INTEGER as high_score
    FROM game_scores
    WHERE challenge_type = 'word-search' AND is_challenge = TRUE
    GROUP BY profile_id
) gs_agg
WHERE wss.profile_id = gs_agg.profile_id;

-- ────────────────────────────────────────
-- 9. Backfill: Recompute rankings for ALL accounts
--    Since update_ranking_for_account() has been silently failing,
--    all rankings are stale. Force a fresh computation.
-- ────────────────────────────────────────
DO $$
DECLARE
    v_account RECORD;
BEGIN
    FOR v_account IN
        SELECT DISTINCT a.id
        FROM accounts a
        JOIN profiles p ON p.account_id = a.id
        WHERE a.is_banned = FALSE AND p.games_played > 0
    LOOP
        BEGIN
            PERFORM update_ranking_for_account(v_account.id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to update ranking for account %: %', v_account.id, SQLERRM;
        END;
    END LOOP;
END;
$$;
