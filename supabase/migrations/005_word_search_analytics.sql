-- ============================================================
-- PLUMMET — Word Search Analytics & Leaderboard Integration
-- Migration 005: Word Search Performance System
-- ============================================================
--
-- THREAT MODEL / DESIGN RATIONALE (Scientific Method):
--
-- HYPOTHESIS: Word Search skill can be precisely measured by combining
-- four orthogonal performance vectors:
--
--   1. COMPLETION RATE  — How often does the player find ALL placed words?
--      A player who consistently achieves 100% completion is demonstrably
--      more thorough than one who finishes 60% of the time.
--
--   2. SPEED EFFICIENCY — How quickly does the player complete levels
--      relative to the time budget? Finding 5 words in 90 seconds vs 6
--      minutes reflects vastly different pattern-recognition speed.
--      Metric: avg(time_used / time_limit) inverted — lower ratio = faster.
--
--   3. LEVEL PROGRESSION — Higher WS levels have larger grids, more words,
--      diagonal directions, and harder vocabulary. A player at level 200
--      is objectively handling harder puzzles than one at level 10.
--
--   4. BONUS WORD DISCOVERY — Finding accidental/bonus words on the board
--      (words not intentionally placed) demonstrates superior vocabulary
--      breadth and spatial scanning ability.
--
-- CONTROLS AGAINST INFLATION:
--   - Completion rate uses a rolling window (last 50 games) to prevent
--     ancient easy games from inflating the metric.
--   - Speed is normalized per level tier (early levels are expected to be
--     faster; we don't penalize slow completion of hard levels).
--   - Confidence gate: WS skill requires 10+ WS games for any contribution,
--     scaling to full weight at 30 games.
--   - Anti-grinding: diminishing returns on pure volume — playing 500 easy
--     levels slowly won't outscore someone who plays 50 hard levels fast.
--
-- ABOVE-AVERAGE SKILL WEIGHTING:
--   Word Search is classified as a "tough challenge" — its skill multiplier
--   is 2.0× (highest of all challenges), reflecting that spatial pattern
--   recognition + vocabulary under time pressure is cognitively demanding.
--
-- ============================================================

-- ────────────────────────────────────────
-- 1. EXPAND CONSTRAINTS: Allow 'word-search' in existing tables
-- ────────────────────────────────────────

-- game_scores: expand challenge_type CHECK to include 'word-search'
ALTER TABLE game_scores DROP CONSTRAINT IF EXISTS game_scores_challenge_type_check;
ALTER TABLE game_scores ADD CONSTRAINT game_scores_challenge_type_check
    CHECK (challenge_type IN ('target-word', 'speed-round', 'word-category', 'word-search', NULL));

-- game_scores: expand grid_size CHECK to allow word search grids (8-16)
ALTER TABLE game_scores DROP CONSTRAINT IF EXISTS game_scores_grid_size_check;
ALTER TABLE game_scores ADD CONSTRAINT game_scores_grid_size_check
    CHECK (grid_size BETWEEN 3 AND 16);

-- profile_challenge_stats: expand challenge_type CHECK
ALTER TABLE profile_challenge_stats DROP CONSTRAINT IF EXISTS profile_challenge_stats_challenge_type_check;
ALTER TABLE profile_challenge_stats ADD CONSTRAINT profile_challenge_stats_challenge_type_check
    CHECK (challenge_type IN ('target-word', 'speed-round', 'word-category', 'word-search'));

-- challenge_leaderboards: expand challenge_type CHECK
ALTER TABLE challenge_leaderboards DROP CONSTRAINT IF EXISTS challenge_leaderboards_challenge_type_check;
ALTER TABLE challenge_leaderboards ADD CONSTRAINT challenge_leaderboards_challenge_type_check
    CHECK (challenge_type IN ('target-word', 'speed-round', 'word-category', 'word-search'));

-- ────────────────────────────────────────
-- 2. WORD SEARCH STATS TABLE
-- Dedicated analytics table for WS-specific performance metrics
-- that don't fit in the generic game_scores columns.
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_word_search_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Aggregate counts
    games_played INTEGER NOT NULL DEFAULT 0,
    total_words_found INTEGER NOT NULL DEFAULT 0,
    total_placed_words INTEGER NOT NULL DEFAULT 0,      -- sum of placed words across all games
    total_bonus_words INTEGER NOT NULL DEFAULT 0,       -- sum of bonus/accidental words found
    perfect_clears INTEGER NOT NULL DEFAULT 0,          -- games where 100% placed words found

    -- High watermarks
    high_score INTEGER NOT NULL DEFAULT 0,
    best_words_per_game INTEGER NOT NULL DEFAULT 0,
    highest_level_reached INTEGER NOT NULL DEFAULT 1,
    fastest_clear_seconds REAL,                         -- fastest 100% completion time (NULL if never cleared)
    best_bonus_words_single INTEGER NOT NULL DEFAULT 0, -- most bonus words in one game

    -- Performance averages (rolling — recomputed each game)
    avg_completion_rate REAL NOT NULL DEFAULT 0,         -- avg(words_found / placed_words) across recent games
    avg_time_efficiency REAL NOT NULL DEFAULT 0,         -- avg(1 - time_remaining / time_limit) — lower = faster
    avg_score_per_game REAL NOT NULL DEFAULT 0,

    -- Rolling window arrays (last 50 games, stored as JSONB for flexibility)
    -- Each entry: { placed, found, bonus, time_used, time_limit, score, level }
    recent_games JSONB NOT NULL DEFAULT '[]'::JSONB,

    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (profile_id)
);

CREATE INDEX idx_ws_stats_profile ON profile_word_search_stats(profile_id);

-- RLS
ALTER TABLE profile_word_search_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY ws_stats_select ON profile_word_search_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));

-- ────────────────────────────────────────
-- 3. TRIGGER: Update WS stats after each word search game
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_word_search_stats()
RETURNS TRIGGER AS $$
DECLARE
    v_placed INTEGER;
    v_found INTEGER;
    v_bonus INTEGER;
    v_time_used REAL;
    v_time_limit REAL;
    v_is_perfect BOOLEAN;
    v_recent JSONB;
    v_new_entry JSONB;
    v_avg_comp REAL;
    v_avg_eff REAL;
    v_avg_score REAL;
    v_entry JSONB;
    v_sum_comp REAL := 0;
    v_sum_eff REAL := 0;
    v_sum_score REAL := 0;
    v_count INTEGER := 0;
BEGIN
    IF NOT (NEW.is_challenge AND NEW.challenge_type = 'word-search') THEN
        RETURN NEW;
    END IF;

    -- Extract WS-specific metrics from the game_scores row
    -- target_words_completed = total words found (placed + bonus)
    -- bonus_words_completed = bonus words found
    v_found := COALESCE(NEW.target_words_completed, 0);
    v_bonus := COALESCE(NEW.bonus_words_completed, 0);
    v_placed := v_found - v_bonus; -- placed words found = total - bonus
    v_time_limit := COALESCE(NEW.time_limit_seconds, 420)::REAL;
    v_time_used := v_time_limit - COALESCE(NEW.time_remaining_seconds, 0)::REAL;
    v_is_perfect := (NEW.time_remaining_seconds IS NOT NULL AND NEW.time_remaining_seconds > 0);
    -- If time remaining > 0, it means early completion (all placed words found)

    -- Build the new game entry for the rolling window
    v_new_entry := jsonb_build_object(
        'placed', v_placed,
        'found', v_found,
        'bonus', v_bonus,
        'time_used', ROUND(v_time_used::NUMERIC, 1),
        'time_limit', v_time_limit,
        'score', NEW.score,
        'level', NEW.grid_size,  -- grid_size encodes the level tier
        'perfect', v_is_perfect,
        'played_at', NOW()
    );

    -- Get existing recent games array, prepend new entry, cap at 50
    SELECT COALESCE(ws.recent_games, '[]'::JSONB)
    INTO v_recent
    FROM profile_word_search_stats ws
    WHERE ws.profile_id = NEW.profile_id;

    IF v_recent IS NULL THEN
        v_recent := '[]'::JSONB;
    END IF;

    -- Prepend new entry and trim to 50
    v_recent := (v_new_entry || v_recent);
    IF jsonb_array_length(v_recent) > 50 THEN
        v_recent := (
            SELECT jsonb_agg(elem)
            FROM (
                SELECT elem
                FROM jsonb_array_elements(v_recent) WITH ORDINALITY AS t(elem, ord)
                ORDER BY ord
                LIMIT 50
            ) sub
        );
    END IF;

    -- Recompute rolling averages from the window
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_recent) LOOP
        v_count := v_count + 1;
        -- Completion rate: found / max(placed, 1)
        v_sum_comp := v_sum_comp + LEAST(1.0,
            (v_entry->>'found')::REAL / GREATEST((v_entry->>'placed')::REAL, 1));
        -- Time efficiency: time_used / time_limit (lower = faster)
        v_sum_eff := v_sum_eff +
            (v_entry->>'time_used')::REAL / GREATEST((v_entry->>'time_limit')::REAL, 1);
        -- Score
        v_sum_score := v_sum_score + (v_entry->>'score')::REAL;
    END LOOP;

    IF v_count > 0 THEN
        v_avg_comp := v_sum_comp / v_count;
        v_avg_eff := v_sum_eff / v_count;
        v_avg_score := v_sum_score / v_count;
    ELSE
        v_avg_comp := 0;
        v_avg_eff := 0;
        v_avg_score := 0;
    END IF;

    -- Upsert into profile_word_search_stats
    INSERT INTO profile_word_search_stats (
        profile_id, games_played, total_words_found, total_placed_words,
        total_bonus_words, perfect_clears,
        high_score, best_words_per_game, highest_level_reached,
        fastest_clear_seconds, best_bonus_words_single,
        avg_completion_rate, avg_time_efficiency, avg_score_per_game,
        recent_games, updated_at
    ) VALUES (
        NEW.profile_id, 1, v_found, v_placed,
        v_bonus, CASE WHEN v_is_perfect THEN 1 ELSE 0 END,
        NEW.score, v_found, NEW.grid_size,
        CASE WHEN v_is_perfect THEN v_time_used ELSE NULL END,
        v_bonus,
        v_avg_comp, v_avg_eff, v_avg_score,
        v_recent, NOW()
    )
    ON CONFLICT (profile_id) DO UPDATE SET
        games_played = profile_word_search_stats.games_played + 1,
        total_words_found = profile_word_search_stats.total_words_found + v_found,
        total_placed_words = profile_word_search_stats.total_placed_words + v_placed,
        total_bonus_words = profile_word_search_stats.total_bonus_words + v_bonus,
        perfect_clears = profile_word_search_stats.perfect_clears +
            CASE WHEN v_is_perfect THEN 1 ELSE 0 END,
        high_score = GREATEST(profile_word_search_stats.high_score, NEW.score),
        best_words_per_game = GREATEST(profile_word_search_stats.best_words_per_game, v_found),
        highest_level_reached = GREATEST(profile_word_search_stats.highest_level_reached, NEW.grid_size),
        fastest_clear_seconds = CASE
            WHEN v_is_perfect THEN LEAST(
                COALESCE(profile_word_search_stats.fastest_clear_seconds, v_time_used),
                v_time_used
            )
            ELSE profile_word_search_stats.fastest_clear_seconds
        END,
        best_bonus_words_single = GREATEST(profile_word_search_stats.best_bonus_words_single, v_bonus),
        avg_completion_rate = v_avg_comp,
        avg_time_efficiency = v_avg_eff,
        avg_score_per_game = v_avg_score,
        recent_games = v_recent,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_ws_stats
AFTER INSERT ON game_scores
FOR EACH ROW EXECUTE FUNCTION update_word_search_stats();

-- ────────────────────────────────────────
-- 4. WORD SEARCH SKILL COMPUTATION
-- Dedicated function that computes a WS-specific skill rating (0-100)
-- incorporating all four performance vectors.
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_ws_skill(p_profile_id UUID)
RETURNS TABLE (
    ws_skill_rating REAL,
    completion_rate_score REAL,
    speed_efficiency_score REAL,
    level_progression_score REAL,
    bonus_discovery_score REAL,
    perfect_clear_rate REAL,
    ws_games_played INTEGER
) AS $$
DECLARE
    v_ws RECORD;
    v_completion REAL := 0;
    v_speed REAL := 0;
    v_level REAL := 0;
    v_bonus REAL := 0;
    v_perfect_rate REAL := 0;
    v_skill REAL := 0;
    v_confidence REAL := 0;
BEGIN
    -- Get WS stats
    SELECT * INTO v_ws
    FROM profile_word_search_stats ws
    WHERE ws.profile_id = p_profile_id;

    IF v_ws IS NULL OR v_ws.games_played < 1 THEN
        RETURN QUERY SELECT 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0;
        RETURN;
    END IF;

    -- ═══ VECTOR 1: COMPLETION RATE SCORE (0-100) ═══
    -- avg_completion_rate is 0-1 (fraction of placed words found on average)
    -- Perfect (1.0) → 100. Finding 80% on average → ~64. Finding 50% → ~25.
    -- Use power curve to heavily reward consistency near 100%
    v_completion := LEAST(100, POWER(v_ws.avg_completion_rate, 1.5) * 100);

    -- Bonus for perfect clear rate (what fraction of games are 100% clears)
    v_perfect_rate := CASE
        WHEN v_ws.games_played > 0
        THEN v_ws.perfect_clears::REAL / v_ws.games_played
        ELSE 0
    END;
    -- Add up to 20 bonus points for high perfect clear rate
    v_completion := LEAST(100, v_completion + v_perfect_rate * 20);

    -- ═══ VECTOR 2: SPEED EFFICIENCY SCORE (0-100) ═══
    -- avg_time_efficiency is 0-1 (fraction of time budget used, lower = faster)
    -- Invert: someone using 30% of time (0.3) is faster than 90% (0.9)
    -- Sigmoid mapping centered at 0.5 (using half the time = score 50)
    v_speed := LEAST(100, GREATEST(0,
        100 * (1.0 - v_ws.avg_time_efficiency)
    ));
    -- Bonus for having a fast clear time (sub-2-minute clear on any level)
    IF v_ws.fastest_clear_seconds IS NOT NULL AND v_ws.fastest_clear_seconds < 120 THEN
        v_speed := LEAST(100, v_speed + 15);
    ELSIF v_ws.fastest_clear_seconds IS NOT NULL AND v_ws.fastest_clear_seconds < 180 THEN
        v_speed := LEAST(100, v_speed + 8);
    END IF;

    -- ═══ VECTOR 3: LEVEL PROGRESSION SCORE (0-100) ═══
    -- Higher levels = larger grids + more directions + harder words
    -- Use log scale: level 10 ≈ 30, level 50 ≈ 55, level 100 ≈ 65,
    --               level 200 ≈ 75, level 500 ≈ 88, level 1000 ≈ 100
    v_level := LEAST(100, 14.5 * LN(1 + v_ws.highest_level_reached));

    -- ═══ VECTOR 4: BONUS WORD DISCOVERY SCORE (0-100) ═══
    -- Reward vocabulary breadth — finding non-placed dictionary words
    -- avg bonus per game (diminishing returns via log)
    -- Also rewards having found any bonus words at all
    IF v_ws.games_played > 0 THEN
        v_bonus := LEAST(100,
            30 * LN(1 + v_ws.total_bonus_words::REAL / v_ws.games_played) +
            20 * LN(1 + v_ws.best_bonus_words_single) +
            CASE WHEN v_ws.total_bonus_words > 0 THEN 10 ELSE 0 END
        );
    END IF;

    -- ═══ WEIGHTED COMBINATION ═══
    -- Completion rate: 30% (most important — finding all words is the objective)
    -- Speed efficiency: 25% (fast pattern recognition is a key skill signal)
    -- Level progression: 25% (harder levels = objectively harder puzzles)
    -- Bonus discovery: 20% (vocabulary breadth, spatial scanning mastery)
    v_skill := (
        v_completion * 0.30 +
        v_speed * 0.25 +
        v_level * 0.25 +
        v_bonus * 0.20
    );

    -- ═══ CONFIDENCE GATE ═══
    -- Need 10+ WS games for any contribution, full weight at 30 games
    v_confidence := LEAST(1.0, GREATEST(0, (v_ws.games_played - 5)::REAL / 25.0));
    v_skill := v_skill * v_confidence;

    RETURN QUERY SELECT
        v_skill,
        v_completion,
        v_speed,
        v_level,
        v_bonus,
        v_perfect_rate,
        v_ws.games_played;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 5. UPDATE compute_profile_skill TO INCLUDE WORD SEARCH
-- The WS component gets a 2.0× multiplier (above average difficulty)
-- and feeds into the challenge component.
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

    -- 5. CHALLENGE COMPONENT (0-100)
    -- Now includes Word Search with a 2.0× multiplier (above average)
    -- Other challenge types feed in from profile_challenge_stats
    SELECT LEAST(100, COALESCE(
        SUM(
            CASE cs.challenge_type
                WHEN 'speed-round' THEN 1.75
                WHEN 'target-word' THEN 1.5
                WHEN 'word-category' THEN 1.3
                WHEN 'word-search' THEN 2.0   -- above average: tough challenge
                ELSE 1.0
            END *
            20 * LN(1 + cs.high_score / 150.0) *
            LEAST(1, cs.games_played / 3.0)
        ) / NULLIF(COUNT(*), 0) * 3.0, 0))
    INTO v_challenge
    FROM profile_challenge_stats cs WHERE cs.profile_id = p_profile_id;

    -- Blend in the dedicated WS skill rating (which captures completion rate,
    -- speed, level progression, and bonus discovery — data not in challenge_stats)
    -- WS skill contributes up to 40% of the challenge component when
    -- the player has significant WS history
    IF v_ws_games >= 5 THEN
        DECLARE
            v_ws_blend REAL;
        BEGIN
            -- Blend factor: 0 at 5 games, maxes at 0.4 at 30+ games
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

    -- EXPAND TO 0-10000 SCALE
    v_skill := v_skill * v_skill / 100.0;

    -- GAMES-PLAYED CONFIDENCE GATE
    v_skill := v_skill * LEAST(1.0, v_total_games / 50.0);

    -- DETERMINE CLASS
    IF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_raw, v_grid, v_diff, v_time, v_challenge, v_consistency, v_versatility, v_progression, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 6. UPDATE refresh_challenge_leaderboards TO INCLUDE WORD SEARCH
-- Uses the dedicated compute_ws_skill for richer ranking
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_challenge_leaderboards()
RETURNS void AS $$
DECLARE
    acc RECORD;
    ctype TEXT;
    rec RECORD;
    rank_counter INTEGER;
    current_class TEXT;
    class_counter INTEGER;
BEGIN
    DELETE FROM challenge_leaderboards;

    FOR ctype IN SELECT unnest(ARRAY['target-word', 'speed-round', 'word-category', 'word-search']) LOOP
        IF ctype = 'word-search' THEN
            -- Word Search uses dedicated skill function
            FOR acc IN SELECT id FROM accounts WHERE is_banned = FALSE LOOP
                FOR rec IN
                    SELECT p.id as profile_id, p.username,
                           ws.ws_skill_rating as challenge_skill,
                           COALESCE(wss.high_score, 0) as high_score,
                           COALESCE(wss.games_played, 0) as games_played
                    FROM profiles p
                    CROSS JOIN LATERAL compute_ws_skill(p.id) ws
                    LEFT JOIN profile_word_search_stats wss ON wss.profile_id = p.id
                    WHERE p.account_id = acc.id AND COALESCE(wss.games_played, 0) > 0
                    ORDER BY ws.ws_skill_rating DESC
                    LIMIT 1
                LOOP
                    INSERT INTO challenge_leaderboards (
                        account_id, profile_id, username, challenge_type,
                        challenge_skill_rating, high_score, games_played,
                        skill_class
                    ) VALUES (
                        acc.id, rec.profile_id, rec.username, ctype,
                        rec.challenge_skill, rec.high_score, rec.games_played,
                        CASE
                            WHEN rec.challenge_skill >= 65 THEN 'high'
                            WHEN rec.challenge_skill >= 35 THEN 'medium'
                            ELSE 'low'
                        END
                    );
                END LOOP;
            END LOOP;
        ELSE
            -- Other challenge types use the existing formula
            FOR acc IN SELECT id FROM accounts WHERE is_banned = FALSE LOOP
                FOR rec IN
                    SELECT p.id as profile_id, p.username, cs.high_score, cs.games_played,
                        LEAST(100,
                            CASE ctype
                                WHEN 'speed-round' THEN 1.75
                                WHEN 'target-word' THEN 1.5
                                WHEN 'word-category' THEN 1.3
                                ELSE 1.0
                            END * 20 * LN(1 + cs.high_score / 150.0) *
                            LEAST(1, cs.games_played / 3.0) * 3.0
                        ) as challenge_skill
                    FROM profiles p
                    JOIN profile_challenge_stats cs ON cs.profile_id = p.id AND cs.challenge_type = ctype
                    WHERE p.account_id = acc.id
                    ORDER BY cs.high_score DESC
                    LIMIT 1
                LOOP
                    INSERT INTO challenge_leaderboards (
                        account_id, profile_id, username, challenge_type,
                        challenge_skill_rating, high_score, games_played,
                        skill_class
                    ) VALUES (
                        acc.id, rec.profile_id, rec.username, ctype,
                        rec.challenge_skill, rec.high_score, rec.games_played,
                        CASE
                            WHEN rec.challenge_skill >= 65 THEN 'high'
                            WHEN rec.challenge_skill >= 35 THEN 'medium'
                            ELSE 'low'
                        END
                    );
                END LOOP;
            END LOOP;
        END IF;

        -- Assign ranks for this challenge type
        rank_counter := 0;
        FOR rec IN SELECT id, skill_class FROM challenge_leaderboards WHERE challenge_type = ctype ORDER BY challenge_skill_rating DESC LOOP
            rank_counter := rank_counter + 1;
            UPDATE challenge_leaderboards SET global_rank = rank_counter WHERE id = rec.id;
        END LOOP;

        FOR current_class IN SELECT DISTINCT cl.skill_class FROM challenge_leaderboards cl WHERE cl.challenge_type = ctype LOOP
            class_counter := 0;
            FOR rec IN SELECT id FROM challenge_leaderboards WHERE challenge_type = ctype AND skill_class = current_class ORDER BY challenge_skill_rating DESC LOOP
                class_counter := class_counter + 1;
                UPDATE challenge_leaderboards SET class_rank = class_counter WHERE id = rec.id;
            END LOOP;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 7. RPC: GET WORD SEARCH STATS (for player analysis)
-- Returns rich WS performance data for a specific profile
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_ws_stats(p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_ws RECORD;
    v_skill RECORD;
BEGIN
    SELECT * INTO v_ws
    FROM profile_word_search_stats
    WHERE profile_id = p_profile_id;

    SELECT * INTO v_skill
    FROM compute_ws_skill(p_profile_id);

    RETURN jsonb_build_object(
        'games_played', COALESCE(v_ws.games_played, 0),
        'total_words_found', COALESCE(v_ws.total_words_found, 0),
        'total_bonus_words', COALESCE(v_ws.total_bonus_words, 0),
        'perfect_clears', COALESCE(v_ws.perfect_clears, 0),
        'high_score', COALESCE(v_ws.high_score, 0),
        'highest_level', COALESCE(v_ws.highest_level_reached, 1),
        'fastest_clear', v_ws.fastest_clear_seconds,
        'avg_completion_rate', COALESCE(v_ws.avg_completion_rate, 0),
        'avg_time_efficiency', COALESCE(v_ws.avg_time_efficiency, 0),
        'avg_score_per_game', COALESCE(v_ws.avg_score_per_game, 0),
        'skill_rating', COALESCE(v_skill.ws_skill_rating, 0),
        'completion_score', COALESCE(v_skill.completion_rate_score, 0),
        'speed_score', COALESCE(v_skill.speed_efficiency_score, 0),
        'level_score', COALESCE(v_skill.level_progression_score, 0),
        'bonus_score', COALESCE(v_skill.bonus_discovery_score, 0),
        'perfect_clear_rate', COALESCE(v_skill.perfect_clear_rate, 0)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────
-- 8. UPDATE get_player_analysis_data TO INCLUDE WS DATA
-- ────────────────────────────────────────

-- ────────────────────────────────────────
-- 8a. UPDATE update_my_challenge_rankings TO INCLUDE WORD SEARCH
-- This is the per-user function called after every game via update_my_ranking.
-- The original only looped over 3 challenge types — must add word-search.
-- ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_my_challenge_rankings(p_account_id UUID)
RETURNS void AS $$
DECLARE
    ctype TEXT;
    rec RECORD;
BEGIN
    -- Remove existing entries for this account
    DELETE FROM challenge_leaderboards WHERE account_id = p_account_id;

    -- Standard challenge types (target-word, speed-round, word-category)
    FOR ctype IN SELECT unnest(ARRAY['target-word', 'speed-round', 'word-category']) LOOP
        FOR rec IN
            SELECT p.id as profile_id, p.username, cs.high_score, cs.games_played,
                LEAST(100,
                    CASE ctype
                        WHEN 'speed-round' THEN 1.75
                        WHEN 'target-word' THEN 1.5
                        WHEN 'word-category' THEN 1.3
                        ELSE 1.0
                    END * 20 * LN(1 + cs.high_score / 150.0) *
                    LEAST(1, cs.games_played / 3.0) * 3.0
                ) as challenge_skill
            FROM profiles p
            JOIN profile_challenge_stats cs ON cs.profile_id = p.id AND cs.challenge_type = ctype
            WHERE p.account_id = p_account_id
            ORDER BY cs.high_score DESC
            LIMIT 1
        LOOP
            INSERT INTO challenge_leaderboards (
                account_id, profile_id, username, challenge_type,
                challenge_skill_rating, high_score, games_played,
                skill_class
            ) VALUES (
                p_account_id, rec.profile_id, rec.username, ctype,
                rec.challenge_skill, rec.high_score, rec.games_played,
                CASE
                    WHEN rec.challenge_skill >= 65 THEN 'high'
                    WHEN rec.challenge_skill >= 35 THEN 'medium'
                    ELSE 'low'
                END
            );
        END LOOP;

        -- Recompute ranks for this challenge type
        WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY challenge_skill_rating DESC) as rn
            FROM challenge_leaderboards WHERE challenge_type = ctype
        )
        UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
        FROM ranked WHERE cl.id = ranked.id;

        WITH class_ranked AS (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY challenge_skill_rating DESC) as rn
            FROM challenge_leaderboards WHERE challenge_type = ctype
        )
        UPDATE challenge_leaderboards cl SET class_rank = class_ranked.rn
        FROM class_ranked WHERE cl.id = class_ranked.id;
    END LOOP;

    -- Word Search: uses dedicated compute_ws_skill() for richer ranking
    FOR rec IN
        SELECT p.id as profile_id, p.username,
               ws.ws_skill_rating as challenge_skill,
               COALESCE(wss.high_score, 0) as high_score,
               COALESCE(wss.games_played, 0) as games_played
        FROM profiles p
        CROSS JOIN LATERAL compute_ws_skill(p.id) ws
        LEFT JOIN profile_word_search_stats wss ON wss.profile_id = p.id
        WHERE p.account_id = p_account_id AND COALESCE(wss.games_played, 0) > 0
        ORDER BY ws.ws_skill_rating DESC
        LIMIT 1
    LOOP
        INSERT INTO challenge_leaderboards (
            account_id, profile_id, username, challenge_type,
            challenge_skill_rating, high_score, games_played,
            skill_class
        ) VALUES (
            p_account_id, rec.profile_id, rec.username, 'word-search',
            rec.challenge_skill, rec.high_score, rec.games_played,
            CASE
                WHEN rec.challenge_skill >= 65 THEN 'high'
                WHEN rec.challenge_skill >= 35 THEN 'medium'
                ELSE 'low'
            END
        );
    END LOOP;

    -- Recompute ranks for word-search
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

-- Keep it internal-only (matches original REVOKE from 001)
REVOKE EXECUTE ON FUNCTION update_my_challenge_rankings(UUID) FROM authenticated, anon, public;

-- ────────────────────────────────────────
-- 8b. get_player_analysis_data WITH WS DATA
-- ────────────────────────────────────────
-- Note: This adds WS data to the existing analysis payload.
-- The existing function returns JSONB so we can extend it.
CREATE OR REPLACE FUNCTION get_player_analysis_data(p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_skill RECORD;
    v_ws_data JSONB;
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

    -- Get profile
    SELECT * INTO v_profile FROM profiles WHERE id = p_profile_id;
    IF v_profile IS NULL THEN RETURN NULL; END IF;

    -- Get skill components
    SELECT * INTO v_skill FROM compute_profile_skill(p_profile_id);

    -- Get WS-specific data
    v_ws_data := get_ws_stats(p_profile_id);

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
        'word_search', v_ws_data
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
