-- ============================================================
-- PLUMMET — Word Runner Backend Integration
-- Migration 010: Expand CHECK constraints + add word-runner to ranking system
-- ============================================================

-- ─── Expand challenge_type CHECK constraints to include 'word-runner' ───

ALTER TABLE game_scores DROP CONSTRAINT IF EXISTS game_scores_challenge_type_check;
ALTER TABLE game_scores ADD CONSTRAINT game_scores_challenge_type_check
    CHECK (challenge_type IN ('target-word', 'speed-round', 'word-category', 'word-search', 'word-runner', NULL));

ALTER TABLE profile_challenge_stats DROP CONSTRAINT IF EXISTS profile_challenge_stats_challenge_type_check;
ALTER TABLE profile_challenge_stats ADD CONSTRAINT profile_challenge_stats_challenge_type_check
    CHECK (challenge_type IN ('target-word', 'speed-round', 'word-category', 'word-search', 'word-runner'));

ALTER TABLE challenge_leaderboards DROP CONSTRAINT IF EXISTS challenge_leaderboards_challenge_type_check;
ALTER TABLE challenge_leaderboards ADD CONSTRAINT challenge_leaderboards_challenge_type_check
    CHECK (challenge_type IN ('target-word', 'speed-round', 'word-category', 'word-search', 'word-runner'));

-- ─── Make grid_size nullable (Word Runner has no grid) ───
ALTER TABLE game_scores ALTER COLUMN grid_size DROP NOT NULL;
ALTER TABLE game_scores DROP CONSTRAINT IF EXISTS game_scores_grid_size_check;
ALTER TABLE game_scores ADD CONSTRAINT game_scores_grid_size_check
    CHECK (grid_size IS NULL OR grid_size BETWEEN 3 AND 8);

ALTER TABLE profile_high_scores ALTER COLUMN grid_size DROP NOT NULL;

-- ─── Compute skill function for Word Runner ───
-- Uses log-scaled high score × confidence from games played.
-- Scale output to 0-10,000 to match the 007 overhaul pattern.
-- NOTE: profile_challenge_stats has no avg_score column,
-- so we compute it from game_scores directly.
CREATE OR REPLACE FUNCTION compute_word_runner_skill(p_profile_id UUID)
RETURNS TABLE(challenge_skill REAL, skill_class TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_high_score INTEGER;
    v_games INTEGER;
    v_avg_score REAL;
    v_best_combo INTEGER;
    v_skill REAL;
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

    -- Compute avg score + best combo from game_scores (not stored in challenge stats)
    SELECT COALESCE(AVG(gs.score), 0),
           COALESCE(MAX(gs.best_combo), 0)
    INTO v_avg_score, v_best_combo
    FROM game_scores gs
    WHERE gs.profile_id = p_profile_id AND gs.challenge_type = 'word-runner';

    -- Base: log-scaled high score (0-~60 for typical play)
    v_skill := 50 * LN(1 + COALESCE(v_high_score, 0)::REAL / 100);
    -- Avg score bonus (0-~30)
    v_skill := v_skill + 30 * LN(1 + v_avg_score::REAL / 200);
    -- Combo bonus (0-~15)
    v_skill := v_skill + LEAST(15, v_best_combo * 2.5);
    -- Confidence from games played (ramp to 1.0 over 5 games)
    v_skill := v_skill * LEAST(1.0, v_games::REAL / 5.0);
    -- Square to 0-10,000 scale
    v_skill := LEAST(10000, v_skill * v_skill / 100.0);

    challenge_skill := v_skill;
    skill_class := CASE
        WHEN v_skill >= 5000 THEN 'high'
        WHEN v_skill >= 1500 THEN 'medium'
        ELSE 'low'
    END;
    RETURN NEXT;
END;
$$;

-- ─── Add word-runner block to update_my_challenge_rankings ───
-- This function is called by update_my_ranking() after every game.
-- We CREATE OR REPLACE the entire function to add the word-runner block.
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

    -- ── WORD SEARCH (uses existing compute_ws_skill, squared scale) ──
    FOR rec IN
        SELECT p.id as profile_id, p.username,
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

-- Re-restrict direct access (called via update_my_ranking only)
REVOKE EXECUTE ON FUNCTION update_my_challenge_rankings(UUID) FROM authenticated, anon, public;
