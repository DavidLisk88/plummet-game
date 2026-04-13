-- ────────────────────────────────────────────────────────────────
-- Migration 013: Skill Rating Ratchet — ratings never decrease
-- ────────────────────────────────────────────────────────────────
-- Skill ratings should only go up for a given profile. When the
-- account's representative profile changes (e.g. due to deletion
-- or restoration), the new profile's own rating is used directly.
--
-- Core logic lives in update_ranking_for_account(UUID) so it can
-- be called from triggers, service-role functions, and the
-- client-facing update_my_ranking() wrapper.
-- ────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════
-- 1a. Core helper: update_ranking_for_account(UUID)
--     Ratchet is PROFILE-AWARE: only applies GREATEST when the
--     same profile is still the best. When a different profile
--     takes over, its own rating is used as-is.
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_ranking_for_account(p_account_id UUID)
RETURNS void AS $$
DECLARE
    v_best_profile_id UUID;
    v_best_username TEXT;
    v_skill RECORD;
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
        -- No profiles with games — remove from leaderboard if present
        DELETE FROM leaderboard_rankings WHERE account_id = p_account_id;
        RETURN;
    END IF;

    -- Compute skill for the best profile
    SELECT * INTO v_skill FROM compute_profile_skill(v_best_profile_id);

    -- Upsert into leaderboard
    -- Ratchet: GREATEST only when SAME profile; when profile changes, use new rating directly
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
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY skill_rating DESC) as rn
        FROM leaderboard_rankings
    )
    UPDATE leaderboard_rankings lr SET class_rank = class_ranked.rn
    FROM class_ranked WHERE lr.id = class_ranked.id;

    -- Also update challenge leaderboards for this account
    PERFORM update_my_challenge_rankings(p_account_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ════════════════════════════════════════
-- 1b. Client-facing wrapper (uses auth.uid())
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_my_ranking()
RETURNS void AS $$
BEGIN
    PERFORM update_ranking_for_account(auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════
-- 2. update_my_challenge_rankings() — profile-aware ratchet
--    Same profile → GREATEST. Different profile → use new rating directly.
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_my_challenge_rankings(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
    rec RECORD;
BEGIN
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
