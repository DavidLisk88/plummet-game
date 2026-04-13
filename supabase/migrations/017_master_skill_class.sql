-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 017: Add "Master" skill class tier
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- Adds a new "master" tier for elite players (skill_rating >= 10000)
-- Updates CHECK constraints and calculation functions

-- ────────────────────────────────────────
-- 1. Drop and recreate CHECK constraints on leaderboard_rankings
-- ────────────────────────────────────────
ALTER TABLE leaderboard_rankings 
    DROP CONSTRAINT IF EXISTS leaderboard_rankings_skill_class_check;

ALTER TABLE leaderboard_rankings 
    ADD CONSTRAINT leaderboard_rankings_skill_class_check 
    CHECK (skill_class IN ('master', 'high', 'medium', 'low'));

-- ────────────────────────────────────────
-- 2. Drop and recreate CHECK constraints on challenge_leaderboards
-- ────────────────────────────────────────
ALTER TABLE challenge_leaderboards 
    DROP CONSTRAINT IF EXISTS challenge_leaderboards_skill_class_check;

ALTER TABLE challenge_leaderboards 
    ADD CONSTRAINT challenge_leaderboards_skill_class_check 
    CHECK (skill_class IN ('master', 'high', 'medium', 'low'));

-- ────────────────────────────────────────
-- 3. Update the main leaderboard ranking function
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_my_rankings(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
    best_profile RECORD;
    sub_scores RECORD;
    final_rating REAL;
    skill_class_val TEXT;
BEGIN
    -- Pick best profile by XP
    SELECT p.id AS profile_id, p.display_name AS username
    INTO best_profile
    FROM profiles p
    WHERE p.account_id = p_account_id
    ORDER BY (p.stats->>'xp')::INT DESC NULLS LAST
    LIMIT 1;

    IF best_profile IS NULL THEN
        DELETE FROM leaderboard_rankings WHERE account_id = p_account_id;
        RETURN;
    END IF;

    -- Calculate subscores
    SELECT * INTO sub_scores FROM compute_skill_subscores(best_profile.profile_id);

    -- Weighted combination
    final_rating := (
        sub_scores.raw_score_component      * 0.15 +
        sub_scores.grid_mastery_component   * 0.15 +
        sub_scores.difficulty_component     * 0.15 +
        sub_scores.time_pressure_component  * 0.10 +
        sub_scores.challenge_component      * 0.15 +
        sub_scores.consistency_component    * 0.10 +
        sub_scores.versatility_component    * 0.10 +
        sub_scores.progression_component    * 0.10
    );

    -- Determine skill class with master tier
    skill_class_val := CASE
        WHEN final_rating >= 10000 THEN 'master'
        WHEN final_rating >= 5000 THEN 'high'
        WHEN final_rating >= 1500 THEN 'medium'
        ELSE 'low'
    END;

    -- Upsert with ratchet logic (never decrease)
    INSERT INTO leaderboard_rankings (
        account_id, profile_id, username,
        skill_rating,
        raw_score_component, grid_mastery_component, difficulty_component,
        time_pressure_component, challenge_component, consistency_component,
        versatility_component, progression_component,
        skill_class
    )
    VALUES (
        p_account_id, best_profile.profile_id, best_profile.username,
        final_rating,
        sub_scores.raw_score_component, sub_scores.grid_mastery_component,
        sub_scores.difficulty_component, sub_scores.time_pressure_component,
        sub_scores.challenge_component, sub_scores.consistency_component,
        sub_scores.versatility_component, sub_scores.progression_component,
        skill_class_val
    )
    ON CONFLICT (account_id)
    DO UPDATE SET
        profile_id = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.profile_id ELSE EXCLUDED.profile_id END,
        username = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id AND EXCLUDED.skill_rating < leaderboard_rankings.skill_rating
            THEN leaderboard_rankings.username ELSE EXCLUDED.username END,
        skill_rating = GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating),
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
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY skill_rating DESC) as rn
        FROM leaderboard_rankings
    )
    UPDATE leaderboard_rankings lr SET class_rank = class_ranked.rn
    FROM class_ranked WHERE lr.id = class_ranked.id;

    -- Also update challenge leaderboards for this account
    PERFORM update_my_challenge_rankings(p_account_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 4. Update the challenge leaderboard ranking function with master tier
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_my_challenge_rankings(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
    rec RECORD;
BEGIN
    -- Target Word
    FOR rec IN SELECT * FROM calculate_target_word_skill((SELECT id FROM profiles WHERE account_id = p_account_id ORDER BY (stats->>'xp')::INT DESC NULLS LAST LIMIT 1)) LOOP
        INSERT INTO challenge_leaderboards (account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class)
        SELECT p_account_id, p.id, p.display_name, 'target-word',
            rec.challenge_skill, pcs.high_score, pcs.games_played, rec.skill_class
        FROM profiles p
        JOIN profile_challenge_stats pcs ON pcs.profile_id = p.id AND pcs.challenge_type = 'target-word'
        WHERE p.account_id = p_account_id
        ORDER BY (p.stats->>'xp')::INT DESC NULLS LAST LIMIT 1
        ON CONFLICT (account_id, challenge_type)
        DO UPDATE SET
            challenge_skill_rating = GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating),
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN EXCLUDED.challenge_skill_rating > challenge_leaderboards.challenge_skill_rating
                THEN EXCLUDED.skill_class ELSE challenge_leaderboards.skill_class END,
            computed_at = NOW();
    END LOOP;

    -- Speed Round
    FOR rec IN SELECT * FROM calculate_speed_round_skill((SELECT id FROM profiles WHERE account_id = p_account_id ORDER BY (stats->>'xp')::INT DESC NULLS LAST LIMIT 1)) LOOP
        INSERT INTO challenge_leaderboards (account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class)
        SELECT p_account_id, p.id, p.display_name, 'speed-round',
            rec.challenge_skill, pcs.high_score, pcs.games_played, rec.skill_class
        FROM profiles p
        JOIN profile_challenge_stats pcs ON pcs.profile_id = p.id AND pcs.challenge_type = 'speed-round'
        WHERE p.account_id = p_account_id
        ORDER BY (p.stats->>'xp')::INT DESC NULLS LAST LIMIT 1
        ON CONFLICT (account_id, challenge_type)
        DO UPDATE SET
            challenge_skill_rating = GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating),
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN EXCLUDED.challenge_skill_rating > challenge_leaderboards.challenge_skill_rating
                THEN EXCLUDED.skill_class ELSE challenge_leaderboards.skill_class END,
            computed_at = NOW();
    END LOOP;

    -- Word Category
    FOR rec IN SELECT * FROM calculate_word_category_skill((SELECT id FROM profiles WHERE account_id = p_account_id ORDER BY (stats->>'xp')::INT DESC NULLS LAST LIMIT 1)) LOOP
        INSERT INTO challenge_leaderboards (account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class)
        SELECT p_account_id, p.id, p.display_name, 'word-category',
            rec.challenge_skill, pcs.high_score, pcs.games_played, rec.skill_class
        FROM profiles p
        JOIN profile_challenge_stats pcs ON pcs.profile_id = p.id AND pcs.challenge_type = 'word-category'
        WHERE p.account_id = p_account_id
        ORDER BY (p.stats->>'xp')::INT DESC NULLS LAST LIMIT 1
        ON CONFLICT (account_id, challenge_type)
        DO UPDATE SET
            challenge_skill_rating = GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating),
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN EXCLUDED.challenge_skill_rating > challenge_leaderboards.challenge_skill_rating
                THEN EXCLUDED.skill_class ELSE challenge_leaderboards.skill_class END,
            computed_at = NOW();
    END LOOP;

    -- Word Search
    FOR rec IN SELECT * FROM calculate_word_search_skill((SELECT id FROM profiles WHERE account_id = p_account_id ORDER BY (stats->>'xp')::INT DESC NULLS LAST LIMIT 1)) LOOP
        INSERT INTO challenge_leaderboards (account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class)
        SELECT p_account_id, p.id, p.display_name, 'word-search',
            rec.challenge_skill, pcs.high_score, pcs.games_played, rec.skill_class
        FROM profiles p
        JOIN profile_challenge_stats pcs ON pcs.profile_id = p.id AND pcs.challenge_type = 'word-search'
        WHERE p.account_id = p_account_id
        ORDER BY (p.stats->>'xp')::INT DESC NULLS LAST LIMIT 1
        ON CONFLICT (account_id, challenge_type)
        DO UPDATE SET
            challenge_skill_rating = GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating),
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN EXCLUDED.challenge_skill_rating > challenge_leaderboards.challenge_skill_rating
                THEN EXCLUDED.skill_class ELSE challenge_leaderboards.skill_class END,
            computed_at = NOW();
    END LOOP;

    -- Word Runner
    FOR rec IN SELECT * FROM calculate_word_runner_skill((SELECT id FROM profiles WHERE account_id = p_account_id ORDER BY (stats->>'xp')::INT DESC NULLS LAST LIMIT 1)) LOOP
        INSERT INTO challenge_leaderboards (account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played, skill_class)
        SELECT p_account_id, p.id, p.display_name, 'word-runner',
            rec.challenge_skill, pcs.high_score, pcs.games_played, rec.skill_class
        FROM profiles p
        JOIN profile_challenge_stats pcs ON pcs.profile_id = p.id AND pcs.challenge_type = 'word-runner'
        WHERE p.account_id = p_account_id
        ORDER BY (p.stats->>'xp')::INT DESC NULLS LAST LIMIT 1
        ON CONFLICT (account_id, challenge_type)
        DO UPDATE SET
            challenge_skill_rating = GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating),
            high_score = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played = EXCLUDED.games_played,
            skill_class = CASE
                WHEN EXCLUDED.challenge_skill_rating > challenge_leaderboards.challenge_skill_rating
                THEN EXCLUDED.skill_class ELSE challenge_leaderboards.skill_class END,
            computed_at = NOW();
    END LOOP;

    -- Recompute global and class ranks for all challenge types
    UPDATE challenge_leaderboards SET global_rank = sub.rn
    FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY challenge_type ORDER BY challenge_skill_rating DESC) as rn FROM challenge_leaderboards) sub
    WHERE challenge_leaderboards.id = sub.id;

    UPDATE challenge_leaderboards SET class_rank = sub.rn
    FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY challenge_type, skill_class ORDER BY challenge_skill_rating DESC) as rn FROM challenge_leaderboards) sub
    WHERE challenge_leaderboards.id = sub.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 5. Backfill: Recalculate skill_class for existing entries that might qualify for master
-- ────────────────────────────────────────
UPDATE leaderboard_rankings 
SET skill_class = 'master' 
WHERE skill_rating >= 10000 AND skill_class != 'master';

UPDATE challenge_leaderboards 
SET skill_class = 'master' 
WHERE challenge_skill_rating >= 10000 AND skill_class != 'master';

-- Recompute class ranks after backfill
WITH class_ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY skill_rating DESC) as rn
    FROM leaderboard_rankings
)
UPDATE leaderboard_rankings lr SET class_rank = class_ranked.rn
FROM class_ranked WHERE lr.id = class_ranked.id;

UPDATE challenge_leaderboards SET class_rank = sub.rn
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY challenge_type, skill_class ORDER BY challenge_skill_rating DESC) as rn FROM challenge_leaderboards) sub
WHERE challenge_leaderboards.id = sub.id;
