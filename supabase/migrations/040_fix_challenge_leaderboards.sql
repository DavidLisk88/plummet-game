-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  040: Fix challenge_leaderboards (stale since migration 021)         ║
-- ║                                                                      ║
-- ║  Problem:                                                            ║
-- ║    • record_game() only refreshes the global leaderboard via         ║
-- ║      update_ranking_for_account(). It never refreshes per-challenge  ║
-- ║      leaderboards.                                                   ║
-- ║    • The old update_my_challenge_rankings() reads profile_challenge  ║
-- ║      _stats / profile_word_search_stats — tables abandoned after     ║
-- ║      migration 021's aggregate restructure. So even when called      ║
-- ║      historically, it found no new data.                             ║
-- ║                                                                      ║
-- ║  Fix:                                                                ║
-- ║    • Rewrite update_my_challenge_rankings() to read the current      ║
-- ║      per-challenge aggregate tables via the compute_*_skill()        ║
-- ║      helpers (target-word, speed-round, word-category, word-search,  ║
-- ║      word-runner).                                                   ║
-- ║    • Have update_ranking_for_account() call it so every game tick    ║
-- ║      refreshes both global and per-challenge leaderboards.           ║
-- ║    • Backfill: refresh for every existing account.                   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- 1. Rewrite update_my_challenge_rankings(account)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_my_challenge_rankings(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
    rec        RECORD;
    v_class    TEXT;
BEGIN
    IF p_account_id IS NULL THEN RETURN; END IF;

    -- Skip banned accounts
    IF EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id AND is_banned = TRUE) THEN
        DELETE FROM challenge_leaderboards WHERE account_id = p_account_id;
        RETURN;
    END IF;

    -- ──────────────────────────────────────────────────────────────────
    -- TARGET WORD: best profile by compute_target_word_skill
    -- ──────────────────────────────────────────────────────────────────
    SELECT * INTO rec FROM (
        SELECT p.id          AS profile_id,
               p.username    AS username,
               s.challenge_skill,
               s.skill_class,
               COALESCE(SUM(t.high_score), 0)::INTEGER  AS high_score_max,
               COALESCE(SUM(t.games_played), 0)::INTEGER AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_target_word_skill(p.id) s
        LEFT JOIN challenge_target_word_stats t ON t.profile_id = p.id
        WHERE p.account_id = p_account_id
        GROUP BY p.id, p.username, s.challenge_skill, s.skill_class
        HAVING COALESCE(SUM(t.games_played), 0) > 0
        ORDER BY s.challenge_skill DESC
        LIMIT 1
    ) sub;

    IF rec.profile_id IS NOT NULL THEN
        v_class := CASE WHEN rec.skill_class = 'expert' THEN 'master' ELSE rec.skill_class END;
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played,
            skill_class, computed_at
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'target-word',
            rec.challenge_skill,
            (SELECT COALESCE(MAX(high_score), 0) FROM challenge_target_word_stats WHERE profile_id = rec.profile_id),
            rec.games_played, v_class, NOW()
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id             = EXCLUDED.profile_id,
            username               = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating
            END,
            high_score             = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played           = EXCLUDED.games_played,
            skill_class            = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                 AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class
                ELSE EXCLUDED.skill_class
            END,
            computed_at            = NOW();
    ELSE
        DELETE FROM challenge_leaderboards
         WHERE account_id = p_account_id AND challenge_type = 'target-word';
    END IF;

    -- ──────────────────────────────────────────────────────────────────
    -- SPEED ROUND
    -- ──────────────────────────────────────────────────────────────────
    SELECT * INTO rec FROM (
        SELECT p.id AS profile_id, p.username,
               s.challenge_skill, s.skill_class,
               COALESCE(SUM(t.games_played), 0)::INTEGER AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_speed_round_skill(p.id) s
        LEFT JOIN challenge_speed_round_stats t ON t.profile_id = p.id
        WHERE p.account_id = p_account_id
        GROUP BY p.id, p.username, s.challenge_skill, s.skill_class
        HAVING COALESCE(SUM(t.games_played), 0) > 0
        ORDER BY s.challenge_skill DESC
        LIMIT 1
    ) sub;

    IF rec.profile_id IS NOT NULL THEN
        v_class := CASE WHEN rec.skill_class = 'expert' THEN 'master' ELSE rec.skill_class END;
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played,
            skill_class, computed_at
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'speed-round',
            rec.challenge_skill,
            (SELECT COALESCE(MAX(high_score), 0) FROM challenge_speed_round_stats WHERE profile_id = rec.profile_id),
            rec.games_played, v_class, NOW()
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id             = EXCLUDED.profile_id,
            username               = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating
            END,
            high_score             = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played           = EXCLUDED.games_played,
            skill_class            = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                 AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class
                ELSE EXCLUDED.skill_class
            END,
            computed_at            = NOW();
    ELSE
        DELETE FROM challenge_leaderboards
         WHERE account_id = p_account_id AND challenge_type = 'speed-round';
    END IF;

    -- ──────────────────────────────────────────────────────────────────
    -- WORD CATEGORY
    -- ──────────────────────────────────────────────────────────────────
    SELECT * INTO rec FROM (
        SELECT p.id AS profile_id, p.username,
               s.challenge_skill, s.skill_class,
               COALESCE(SUM(t.games_played), 0)::INTEGER AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_word_category_skill(p.id) s
        LEFT JOIN challenge_word_category_stats t ON t.profile_id = p.id
        WHERE p.account_id = p_account_id
        GROUP BY p.id, p.username, s.challenge_skill, s.skill_class
        HAVING COALESCE(SUM(t.games_played), 0) > 0
        ORDER BY s.challenge_skill DESC
        LIMIT 1
    ) sub;

    IF rec.profile_id IS NOT NULL THEN
        v_class := CASE WHEN rec.skill_class = 'expert' THEN 'master' ELSE rec.skill_class END;
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played,
            skill_class, computed_at
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-category',
            rec.challenge_skill,
            (SELECT COALESCE(MAX(high_score), 0) FROM challenge_word_category_stats WHERE profile_id = rec.profile_id),
            rec.games_played, v_class, NOW()
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id             = EXCLUDED.profile_id,
            username               = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating
            END,
            high_score             = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played           = EXCLUDED.games_played,
            skill_class            = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                 AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class
                ELSE EXCLUDED.skill_class
            END,
            computed_at            = NOW();
    ELSE
        DELETE FROM challenge_leaderboards
         WHERE account_id = p_account_id AND challenge_type = 'word-category';
    END IF;

    -- ──────────────────────────────────────────────────────────────────
    -- WORD SEARCH (compute_ws_skill returns 0–100 scale; bespoke tiering)
    -- ──────────────────────────────────────────────────────────────────
    SELECT * INTO rec FROM (
        SELECT p.id AS profile_id, p.username,
               ws.ws_skill_rating AS challenge_skill,
               CASE
                   WHEN ws.ws_skill_rating >= 75 THEN 'master'
                   WHEN ws.ws_skill_rating >= 50 THEN 'high'
                   WHEN ws.ws_skill_rating >= 25 THEN 'medium'
                   ELSE 'low'
               END AS skill_class,
               COALESCE(t.games_played, 0) AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_ws_skill(p.id) ws
        LEFT JOIN challenge_word_search_stats t ON t.profile_id = p.id
        WHERE p.account_id = p_account_id
          AND COALESCE(t.games_played, 0) > 0
        ORDER BY ws.ws_skill_rating DESC
        LIMIT 1
    ) sub;

    IF rec.profile_id IS NOT NULL THEN
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played,
            skill_class, computed_at
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-search',
            rec.challenge_skill,
            (SELECT COALESCE(high_score, 0) FROM challenge_word_search_stats WHERE profile_id = rec.profile_id),
            rec.games_played, rec.skill_class, NOW()
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id             = EXCLUDED.profile_id,
            username               = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating
            END,
            high_score             = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played           = EXCLUDED.games_played,
            skill_class            = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                 AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class
                ELSE EXCLUDED.skill_class
            END,
            computed_at            = NOW();
    ELSE
        DELETE FROM challenge_leaderboards
         WHERE account_id = p_account_id AND challenge_type = 'word-search';
    END IF;

    -- ──────────────────────────────────────────────────────────────────
    -- WORD RUNNER
    -- ──────────────────────────────────────────────────────────────────
    SELECT * INTO rec FROM (
        SELECT p.id AS profile_id, p.username,
               s.challenge_skill, s.skill_class,
               COALESCE(t.games_played, 0) AS games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_word_runner_skill(p.id) s
        LEFT JOIN challenge_word_runner_stats t ON t.profile_id = p.id
        WHERE p.account_id = p_account_id
          AND COALESCE(t.games_played, 0) > 0
        ORDER BY s.challenge_skill DESC
        LIMIT 1
    ) sub;

    IF rec.profile_id IS NOT NULL THEN
        v_class := CASE WHEN rec.skill_class = 'expert' THEN 'master' ELSE rec.skill_class END;
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played,
            skill_class, computed_at
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-runner',
            rec.challenge_skill,
            (SELECT COALESCE(high_score, 0) FROM challenge_word_runner_stats WHERE profile_id = rec.profile_id),
            rec.games_played, v_class, NOW()
        )
        ON CONFLICT (account_id, challenge_type) DO UPDATE SET
            profile_id             = EXCLUDED.profile_id,
            username               = EXCLUDED.username,
            challenge_skill_rating = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                THEN GREATEST(challenge_leaderboards.challenge_skill_rating, EXCLUDED.challenge_skill_rating)
                ELSE EXCLUDED.challenge_skill_rating
            END,
            high_score             = GREATEST(challenge_leaderboards.high_score, EXCLUDED.high_score),
            games_played           = EXCLUDED.games_played,
            skill_class            = CASE
                WHEN challenge_leaderboards.profile_id = EXCLUDED.profile_id
                 AND EXCLUDED.challenge_skill_rating < challenge_leaderboards.challenge_skill_rating
                THEN challenge_leaderboards.skill_class
                ELSE EXCLUDED.skill_class
            END,
            computed_at            = NOW();
    ELSE
        DELETE FROM challenge_leaderboards
         WHERE account_id = p_account_id AND challenge_type = 'word-runner';
    END IF;

    -- ──────────────────────────────────────────────────────────────────
    -- Recompute global_rank + class_rank per challenge_type
    -- ──────────────────────────────────────────────────────────────────
    WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY challenge_type
                                  ORDER BY challenge_skill_rating DESC, computed_at ASC) AS rn
        FROM challenge_leaderboards
    )
    UPDATE challenge_leaderboards cl
       SET global_rank = ranked.rn
      FROM ranked
     WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY challenge_type, skill_class
                                  ORDER BY challenge_skill_rating DESC, computed_at ASC) AS rn
        FROM challenge_leaderboards
    )
    UPDATE challenge_leaderboards cl
       SET class_rank = class_ranked.rn
      FROM class_ranked
     WHERE cl.id = class_ranked.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION update_my_challenge_rankings(UUID) FROM authenticated, anon, public;


-- ════════════════════════════════════════════════════════════════════════
-- 2. Patch update_ranking_for_account to ALSO refresh challenge boards
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_ranking_for_account(p_account_id UUID)
RETURNS void AS $$
DECLARE
    v_best_profile_id UUID;
    v_best_username   TEXT;
    v_skill           RECORD;
    v_pgs_floor       REAL;
BEGIN
    IF p_account_id IS NULL THEN RETURN; END IF;

    -- Banned accounts: clear from both leaderboards
    IF EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id AND is_banned = TRUE) THEN
        DELETE FROM leaderboard_rankings   WHERE account_id = p_account_id;
        DELETE FROM challenge_leaderboards WHERE account_id = p_account_id;
        RETURN;
    END IF;

    -- Find best-skilled profile for this account
    SELECT p.id, p.username INTO v_best_profile_id, v_best_username
    FROM profiles p
    CROSS JOIN LATERAL compute_profile_skill(p.id) s
    WHERE p.account_id = p_account_id AND p.games_played > 0
    ORDER BY s.skill_rating DESC
    LIMIT 1;

    IF v_best_profile_id IS NULL THEN
        DELETE FROM leaderboard_rankings   WHERE account_id = p_account_id;
        DELETE FROM challenge_leaderboards WHERE account_id = p_account_id;
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
        username   = EXCLUDED.username,
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

    -- Refresh per-challenge leaderboards (was broken since 021)
    BEGIN
        PERFORM update_my_challenge_rankings(p_account_id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'update_ranking_for_account: challenge ranking update failed for %: %',
                      p_account_id, SQLERRM;
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ════════════════════════════════════════════════════════════════════════
-- 3. Backfill: refresh challenge leaderboards for every existing account
--    (catches up everyone who has been playing while it was broken)
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_acc RECORD;
BEGIN
    FOR v_acc IN
        SELECT DISTINCT a.id
        FROM accounts a
        WHERE COALESCE(a.is_banned, FALSE) = FALSE
          AND EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = a.id)
    LOOP
        BEGIN
            PERFORM update_my_challenge_rankings(v_acc.id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'backfill challenge rankings failed for account %: %',
                          v_acc.id, SQLERRM;
        END;
    END LOOP;
END $$;
