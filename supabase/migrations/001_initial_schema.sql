-- ============================================================
-- PLUMMET — Supabase Database Schema
-- Migration 001: Initial schema
-- ============================================================
-- Architecture:
--   accounts (1 per auth user, email/password)
--     └─ profiles (many per account, each a "sub-account")
--          ├─ game_scores (one row per completed game)
--          ├─ profile_high_scores (materialized bests per dimension)
--          ├─ profile_challenge_stats (per challenge type)
--          ├─ profile_category_stats (per word category)
--          ├─ profile_inventory (owned shop items)
--          └─ leaderboard_rankings (computed skill/class)
-- ============================================================

-- ────────────────────────────────────────
-- 1. ACCOUNTS (1:1 with supabase auth.users)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    ban_reason TEXT
);

CREATE INDEX idx_accounts_email ON accounts(email);

-- ────────────────────────────────────────
-- 2. PROFILES (many per account)
-- Each profile is an independent "player" with its own stats.
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    -- Game state
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    total_xp BIGINT NOT NULL DEFAULT 0,
    high_score INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    total_words INTEGER NOT NULL DEFAULT 0,
    -- Currency
    coins INTEGER NOT NULL DEFAULT 0,
    total_coins_earned INTEGER NOT NULL DEFAULT 0,
    -- Preferences
    preferred_grid_size INTEGER NOT NULL DEFAULT 5,
    preferred_difficulty TEXT NOT NULL DEFAULT 'casual' CHECK (preferred_difficulty IN ('casual', 'hard')),
    preferred_game_mode TEXT NOT NULL DEFAULT 'sandbox' CHECK (preferred_game_mode IN ('sandbox', 'timed')),
    -- Cosmetics
    equipped_theme TEXT NOT NULL DEFAULT 'theme_default',
    equipped_block_style TEXT NOT NULL DEFAULT 'block_default',
    bonus_slot_contents JSONB NOT NULL DEFAULT '[null, null, null]'::jsonb,
    perks JSONB NOT NULL DEFAULT '{}'::jsonb,
    unlocked_grids JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Streak
    last_play_date DATE,
    play_streak INTEGER NOT NULL DEFAULT 0,
    claimed_milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Unique words (stored as array for now, could be separate table)
    unique_words_found TEXT[] NOT NULL DEFAULT '{}',
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_account ON profiles(account_id);
CREATE INDEX idx_profiles_username ON profiles(username);

-- ────────────────────────────────────────
-- 3. GAME SCORES (every completed game)
-- One row per game — the raw event log for all score calculations.
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    -- Game type dimensions
    game_mode TEXT NOT NULL CHECK (game_mode IN ('sandbox', 'timed')),
    is_challenge BOOLEAN NOT NULL DEFAULT FALSE,
    challenge_type TEXT CHECK (challenge_type IN ('target-word', 'speed-round', 'word-category', NULL)),
    category_key TEXT CHECK (category_key IN ('adjectives', 'animals', 'sports', 'food', 'nature', 'technology', NULL)),
    grid_size INTEGER NOT NULL CHECK (grid_size BETWEEN 3 AND 8),
    difficulty TEXT NOT NULL CHECK (difficulty IN ('casual', 'hard')),
    time_limit_seconds INTEGER, -- NULL for sandbox
    -- Results (CHECK constraints prevent client-side score tampering)
    score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100000),
    words_found INTEGER NOT NULL DEFAULT 0 CHECK (words_found >= 0 AND words_found <= 5000),
    longest_word_length INTEGER NOT NULL DEFAULT 0 CHECK (longest_word_length >= 0 AND longest_word_length <= 50),
    best_combo INTEGER NOT NULL DEFAULT 0 CHECK (best_combo >= 0 AND best_combo <= 500),
    target_words_completed INTEGER NOT NULL DEFAULT 0 CHECK (target_words_completed >= 0),
    bonus_words_completed INTEGER NOT NULL DEFAULT 0 CHECK (bonus_words_completed >= 0),
    time_remaining_seconds INTEGER CHECK (time_remaining_seconds IS NULL OR time_remaining_seconds >= 0),
    -- XP/coins awarded
    xp_earned INTEGER NOT NULL DEFAULT 0,
    coins_earned INTEGER NOT NULL DEFAULT 0,
    -- Computed factors (stored for audit/analysis)
    grid_factor REAL,
    difficulty_multiplier REAL,
    mode_multiplier REAL,
    -- Metadata
    played_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_game_scores_profile ON game_scores(profile_id);
CREATE INDEX idx_game_scores_mode ON game_scores(game_mode, difficulty, grid_size);
CREATE INDEX idx_game_scores_challenge ON game_scores(challenge_type) WHERE is_challenge = TRUE;
CREATE INDEX idx_game_scores_timed ON game_scores(time_limit_seconds) WHERE game_mode = 'timed';
CREATE INDEX idx_game_scores_played ON game_scores(played_at DESC);

-- ────────────────────────────────────────
-- 4. PROFILE HIGH SCORES (materialized)
-- One row per unique combination of dimensions.
-- Updated via trigger after each game_scores INSERT.
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_high_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    -- Dimension key (composite unique)
    game_mode TEXT NOT NULL,
    is_challenge BOOLEAN NOT NULL DEFAULT FALSE,
    challenge_type TEXT,
    category_key TEXT,
    grid_size INTEGER NOT NULL,
    difficulty TEXT NOT NULL,
    time_limit_seconds INTEGER, -- NULL for sandbox / untimed
    -- Scores
    high_score INTEGER NOT NULL DEFAULT 0,
    best_words_found INTEGER NOT NULL DEFAULT 0,
    best_combo INTEGER NOT NULL DEFAULT 0,
    best_longest_word INTEGER NOT NULL DEFAULT 0,
    best_target_words INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    total_score BIGINT NOT NULL DEFAULT 0,
    avg_score REAL NOT NULL DEFAULT 0,
    -- Timestamps
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Unique constraint per dimension combo (NULLS NOT DISTINCT treats NULLs as equal for uniqueness)
    UNIQUE NULLS NOT DISTINCT (profile_id, game_mode, is_challenge, challenge_type, category_key, grid_size, difficulty, time_limit_seconds)
);

CREATE INDEX idx_high_scores_profile ON profile_high_scores(profile_id);
CREATE INDEX idx_high_scores_lookup ON profile_high_scores(game_mode, difficulty, grid_size, time_limit_seconds);

-- ────────────────────────────────────────
-- 5. PROFILE CHALLENGE STATS (per challenge type)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_challenge_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    challenge_type TEXT NOT NULL CHECK (challenge_type IN ('target-word', 'speed-round', 'word-category')),
    high_score INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    total_words INTEGER NOT NULL DEFAULT 0,
    target_word_level INTEGER NOT NULL DEFAULT 1,
    unique_words_found TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, challenge_type)
);

-- ────────────────────────────────────────
-- 6. PROFILE CATEGORY STATS (per word category)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_category_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category_key TEXT NOT NULL CHECK (category_key IN ('adjectives', 'animals', 'sports', 'food', 'nature', 'technology')),
    high_score INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    total_category_words INTEGER NOT NULL DEFAULT 0,
    best_category_words_per_game INTEGER NOT NULL DEFAULT 0,
    -- Per grid size high scores within this category
    high_score_grid_3 INTEGER NOT NULL DEFAULT 0,
    high_score_grid_4 INTEGER NOT NULL DEFAULT 0,
    high_score_grid_5 INTEGER NOT NULL DEFAULT 0,
    high_score_grid_6 INTEGER NOT NULL DEFAULT 0,
    high_score_grid_7 INTEGER NOT NULL DEFAULT 0,
    high_score_grid_8 INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, category_key)
);

-- ────────────────────────────────────────
-- 7. PROFILE INVENTORY (shop items owned)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, item_id)
);

CREATE INDEX idx_inventory_profile ON profile_inventory(profile_id);

-- ────────────────────────────────────────
-- 8. LEADERBOARD RANKINGS (computed periodically)
-- Only the best profile per account is ranked.
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaderboard_rankings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    -- Skill calculation results
    skill_rating REAL NOT NULL DEFAULT 0,
    -- Sub-scores (all 0-100 normalized)
    raw_score_component REAL NOT NULL DEFAULT 0,
    grid_mastery_component REAL NOT NULL DEFAULT 0,
    difficulty_component REAL NOT NULL DEFAULT 0,
    time_pressure_component REAL NOT NULL DEFAULT 0,
    challenge_component REAL NOT NULL DEFAULT 0,
    consistency_component REAL NOT NULL DEFAULT 0,
    versatility_component REAL NOT NULL DEFAULT 0,
    progression_component REAL NOT NULL DEFAULT 0,
    -- Class ranking
    skill_class TEXT NOT NULL DEFAULT 'low' CHECK (skill_class IN ('high', 'medium', 'low')),
    -- Position within class (lower = better)
    class_rank INTEGER NOT NULL DEFAULT 0,
    -- Global rank
    global_rank INTEGER NOT NULL DEFAULT 0,
    -- Strengths/weaknesses (AI-generated text)
    analysis_text TEXT,
    analysis_generated_at TIMESTAMPTZ,
    -- Timestamps
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id)
);

CREATE INDEX idx_leaderboard_skill ON leaderboard_rankings(skill_rating DESC);
CREATE INDEX idx_leaderboard_class ON leaderboard_rankings(skill_class, class_rank);
CREATE INDEX idx_leaderboard_global ON leaderboard_rankings(global_rank);

-- ────────────────────────────────────────
-- 9. CHALLENGE LEADERBOARDS (per challenge type)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_leaderboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    challenge_type TEXT NOT NULL CHECK (challenge_type IN ('target-word', 'speed-round', 'word-category')),
    -- Skill for this specific challenge
    challenge_skill_rating REAL NOT NULL DEFAULT 0,
    high_score INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    skill_class TEXT NOT NULL DEFAULT 'low' CHECK (skill_class IN ('high', 'medium', 'low')),
    class_rank INTEGER NOT NULL DEFAULT 0,
    global_rank INTEGER NOT NULL DEFAULT 0,
    analysis_text TEXT,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, challenge_type)
);

CREATE INDEX idx_challenge_lb_type ON challenge_leaderboards(challenge_type, challenge_skill_rating DESC);

-- ============================================================
-- TRIGGERS: Auto-update high scores after game completion
-- ============================================================

-- Function: Update profile_high_scores after a game_scores INSERT
CREATE OR REPLACE FUNCTION update_high_scores()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profile_high_scores (
        profile_id, game_mode, is_challenge, challenge_type, category_key,
        grid_size, difficulty, time_limit_seconds,
        high_score, best_words_found, best_combo, best_longest_word,
        best_target_words, games_played, total_score, avg_score,
        achieved_at, updated_at
    )
    VALUES (
        NEW.profile_id, NEW.game_mode, NEW.is_challenge, NEW.challenge_type, NEW.category_key,
        NEW.grid_size, NEW.difficulty, NEW.time_limit_seconds,
        NEW.score, NEW.words_found, NEW.best_combo, NEW.longest_word_length,
        NEW.target_words_completed, 1, NEW.score, NEW.score,
        NOW(), NOW()
    )
    ON CONFLICT (profile_id, game_mode, is_challenge, challenge_type, category_key, grid_size, difficulty, time_limit_seconds)
    DO UPDATE SET
        high_score = GREATEST(profile_high_scores.high_score, NEW.score),
        best_words_found = GREATEST(profile_high_scores.best_words_found, NEW.words_found),
        best_combo = GREATEST(profile_high_scores.best_combo, NEW.best_combo),
        best_longest_word = GREATEST(profile_high_scores.best_longest_word, NEW.longest_word_length),
        best_target_words = GREATEST(profile_high_scores.best_target_words, NEW.target_words_completed),
        games_played = profile_high_scores.games_played + 1,
        total_score = profile_high_scores.total_score + NEW.score,
        avg_score = (profile_high_scores.total_score + NEW.score)::REAL / (profile_high_scores.games_played + 1),
        achieved_at = CASE WHEN NEW.score > profile_high_scores.high_score THEN NOW() ELSE profile_high_scores.achieved_at END,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_high_scores
AFTER INSERT ON game_scores
FOR EACH ROW EXECUTE FUNCTION update_high_scores();

-- Function: Update profile aggregate stats after game
CREATE OR REPLACE FUNCTION update_profile_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE profiles SET
        games_played = profiles.games_played + 1,
        total_words = profiles.total_words + NEW.words_found,
        high_score = GREATEST(profiles.high_score, NEW.score),
        updated_at = NOW()
    WHERE id = NEW.profile_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_profile_stats
AFTER INSERT ON game_scores
FOR EACH ROW EXECUTE FUNCTION update_profile_stats();

-- Function: Update challenge stats after challenge game
CREATE OR REPLACE FUNCTION update_challenge_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_challenge AND NEW.challenge_type IS NOT NULL THEN
        INSERT INTO profile_challenge_stats (profile_id, challenge_type, high_score, games_played, total_words)
        VALUES (NEW.profile_id, NEW.challenge_type, NEW.score, 1, NEW.words_found)
        ON CONFLICT (profile_id, challenge_type)
        DO UPDATE SET
            high_score = GREATEST(profile_challenge_stats.high_score, NEW.score),
            games_played = profile_challenge_stats.games_played + 1,
            total_words = profile_challenge_stats.total_words + NEW.words_found,
            updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_challenge_stats
AFTER INSERT ON game_scores
FOR EACH ROW EXECUTE FUNCTION update_challenge_stats();

-- Function: Update category stats after category challenge game
CREATE OR REPLACE FUNCTION update_category_stats()
RETURNS TRIGGER AS $$
DECLARE
    grid_col TEXT;
BEGIN
    IF NEW.challenge_type = 'word-category' AND NEW.category_key IS NOT NULL THEN
        grid_col := 'high_score_grid_' || NEW.grid_size;

        INSERT INTO profile_category_stats (
            profile_id, category_key, high_score, games_played,
            total_category_words, best_category_words_per_game
        )
        VALUES (
            NEW.profile_id, NEW.category_key, NEW.score, 1,
            NEW.bonus_words_completed, NEW.bonus_words_completed
        )
        ON CONFLICT (profile_id, category_key)
        DO UPDATE SET
            high_score = GREATEST(profile_category_stats.high_score, NEW.score),
            games_played = profile_category_stats.games_played + 1,
            total_category_words = profile_category_stats.total_category_words + NEW.bonus_words_completed,
            best_category_words_per_game = GREATEST(profile_category_stats.best_category_words_per_game, NEW.bonus_words_completed),
            updated_at = NOW();

        -- Update per-grid high score via dynamic column
        -- We use CASE since dynamic column names aren't easy in plpgsql
        UPDATE profile_category_stats SET
            high_score_grid_3 = CASE WHEN NEW.grid_size = 3 THEN GREATEST(high_score_grid_3, NEW.score) ELSE high_score_grid_3 END,
            high_score_grid_4 = CASE WHEN NEW.grid_size = 4 THEN GREATEST(high_score_grid_4, NEW.score) ELSE high_score_grid_4 END,
            high_score_grid_5 = CASE WHEN NEW.grid_size = 5 THEN GREATEST(high_score_grid_5, NEW.score) ELSE high_score_grid_5 END,
            high_score_grid_6 = CASE WHEN NEW.grid_size = 6 THEN GREATEST(high_score_grid_6, NEW.score) ELSE high_score_grid_6 END,
            high_score_grid_7 = CASE WHEN NEW.grid_size = 7 THEN GREATEST(high_score_grid_7, NEW.score) ELSE high_score_grid_7 END,
            high_score_grid_8 = CASE WHEN NEW.grid_size = 8 THEN GREATEST(high_score_grid_8, NEW.score) ELSE high_score_grid_8 END
        WHERE profile_id = NEW.profile_id AND category_key = NEW.category_key;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_category_stats
AFTER INSERT ON game_scores
FOR EACH ROW EXECUTE FUNCTION update_category_stats();

-- ============================================================
-- ACCOUNT ROW CREATION
-- ============================================================
-- NOTE: Account rows are created CLIENT-SIDE after signUp (not via trigger).
-- A trigger on auth.users can block ALL user creation if it errors.
-- The client upserts into accounts after successful auth.signUp().

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_high_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_challenge_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_category_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_leaderboards ENABLE ROW LEVEL SECURITY;

-- Accounts: users can read/insert/update/delete their own
CREATE POLICY accounts_select ON accounts FOR SELECT USING (id = auth.uid());
CREATE POLICY accounts_insert ON accounts FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY accounts_update ON accounts FOR UPDATE USING (id = auth.uid());
CREATE POLICY accounts_delete ON accounts FOR DELETE USING (id = auth.uid());

-- Profiles: users can CRUD their own profiles
CREATE POLICY profiles_select ON profiles FOR SELECT USING (account_id = auth.uid());
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (account_id = auth.uid());
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (account_id = auth.uid());
CREATE POLICY profiles_delete ON profiles FOR DELETE USING (account_id = auth.uid());

-- Game scores: users can read/insert their own
CREATE POLICY game_scores_select ON game_scores FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY game_scores_insert ON game_scores FOR INSERT
    WITH CHECK (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));

-- High scores: users read their own
CREATE POLICY high_scores_select ON profile_high_scores FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));

-- Challenge stats: users read their own
CREATE POLICY challenge_stats_select ON profile_challenge_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));

-- Category stats: users read their own
CREATE POLICY category_stats_select ON profile_category_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));

-- Inventory: users CRUD their own
CREATE POLICY inventory_select ON profile_inventory FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY inventory_insert ON profile_inventory FOR INSERT
    WITH CHECK (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY inventory_delete ON profile_inventory FOR DELETE
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));

-- Leaderboard: everyone can READ (it's public), only system writes
CREATE POLICY leaderboard_select ON leaderboard_rankings FOR SELECT USING (TRUE);
CREATE POLICY challenge_lb_select ON challenge_leaderboards FOR SELECT USING (TRUE);

-- ============================================================
-- REALTIME
-- ============================================================
ALTER TABLE leaderboard_rankings REPLICA IDENTITY FULL;
ALTER TABLE challenge_leaderboards REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE leaderboard_rankings, challenge_leaderboards;

-- ============================================================
-- RPC: COMPUTE SKILL RATING FOR A PROFILE
-- Advanced multi-factor weighted skill calculation
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
    -- Get total games for this profile
    SELECT COUNT(*) INTO v_total_games FROM game_scores WHERE game_scores.profile_id = p_profile_id;
    IF v_total_games < 1 THEN
        RETURN QUERY SELECT 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 0::REAL, 'low'::TEXT;
        RETURN;
    END IF;

    -- ═══ 1. RAW SCORE COMPONENT (0-100) ═══
    -- Weighted average of top scores across all modes with diminishing returns
    -- Uses log scaling so a score of 10000 maps to ~100
    SELECT LEAST(100, 25 * LN(1 + GREATEST(0, AVG(sub.top_score)) / 100))
    INTO v_raw
    FROM (
        SELECT MAX(score) as top_score
        FROM game_scores WHERE game_scores.profile_id = p_profile_id
        GROUP BY game_mode, difficulty, grid_size
        ORDER BY top_score DESC
        LIMIT 20
    ) sub;

    -- ═══ 2. GRID MASTERY COMPONENT (0-100) ═══
    -- Measures performance on harder (smaller) grids.
    -- Scoring on 3x3 is worth 6× more than 8x8. Weighted Bayesian average.
    SELECT LEAST(100, COALESCE(
        SUM(
            (6.0 / gs.grid_size) *                     -- grid weight (3x3=2.0, 8x8=0.75)
            25 * LN(1 + gs.high_score / 200.0) *       -- score contribution (log scale)
            LEAST(1, gs.games_played / 3.0)             -- confidence: need 3+ games
        ) / NULLIF(COUNT(*), 0) * 2.5, 0))
    INTO v_grid
    FROM profile_high_scores gs WHERE gs.profile_id = p_profile_id;

    -- ═══ 3. DIFFICULTY COMPONENT (0-100) ═══
    -- Hard mode performance vs casual, with emphasis on hard mode scores
    SELECT LEAST(100, COALESCE(
        (
            -- Hard mode contribution (weighted 70%)
            (SELECT COALESCE(AVG(25 * LN(1 + score / 150.0)), 0)
             FROM game_scores WHERE game_scores.profile_id = p_profile_id AND difficulty = 'hard') * 0.7
            +
            -- Hard mode game ratio bonus (weighted 30%)
            (SELECT COUNT(*)::REAL / NULLIF(v_total_games, 0) * 100
             FROM game_scores WHERE game_scores.profile_id = p_profile_id AND difficulty = 'hard') * 0.3
        ), 0))
    INTO v_diff;

    -- ═══ 4. TIME PRESSURE COMPONENT (0-100) ═══
    -- Performance under shorter time constraints.
    -- Shorter timers get exponentially more weight.
    -- 60s = weight 5.0, 180s = 1.67, 300s = 1.0, 600s = 0.5
    SELECT LEAST(100, COALESCE(
        SUM(
            (300.0 / GREATEST(gs.time_limit_seconds, 60)) *  -- time weight
            20 * LN(1 + gs.high_score / 100.0) *             -- score contribution
            LEAST(1, gs.games_played / 2.0)                   -- confidence
        ) / NULLIF(COUNT(*), 0) * 3.0, 0))
    INTO v_time
    FROM profile_high_scores gs
    WHERE gs.profile_id = p_profile_id AND gs.game_mode = 'timed' AND gs.time_limit_seconds IS NOT NULL;

    -- ═══ 5. CHALLENGE COMPONENT (0-100) ═══
    -- Performance across all challenge types, weighted by difficulty
    SELECT LEAST(100, COALESCE(
        SUM(
            CASE cs.challenge_type
                WHEN 'speed-round' THEN 1.75  -- hardest challenge
                WHEN 'target-word' THEN 1.5
                WHEN 'word-category' THEN 1.3
                ELSE 1.0
            END *
            20 * LN(1 + cs.high_score / 150.0) *
            LEAST(1, cs.games_played / 3.0)
        ) / NULLIF(COUNT(*), 0) * 3.0, 0))
    INTO v_challenge
    FROM profile_challenge_stats cs WHERE cs.profile_id = p_profile_id;

    -- ═══ 6. CONSISTENCY COMPONENT (0-100) ═══
    -- Low coefficient of variation across recent games = consistent player
    -- Uses last 30 games to measure stability
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

    -- ═══ 7. VERSATILITY COMPONENT (0-100) ═══
    -- How many different game configurations has the player excelled at?
    -- Counts unique (mode, grid, difficulty, time) combos with decent scores
    SELECT LEAST(100, COALESCE(
        (
            -- Number of distinct configurations played (out of possible ~60)
            (SELECT COUNT(DISTINCT (game_mode, grid_size, difficulty, COALESCE(time_limit_seconds, 0), COALESCE(challenge_type, '')))
             FROM game_scores WHERE game_scores.profile_id = p_profile_id)::REAL
            / 30.0 * 50  -- 30 unique configs = 50 points
            +
            -- Number of configs with high scores (sigmoid bonus)
            (SELECT COUNT(*)::REAL FROM profile_high_scores
             WHERE profile_high_scores.profile_id = p_profile_id AND high_score > 500)
            / 10.0 * 50  -- 10 high-score configs = 50 points
        ), 0))
    INTO v_versatility;

    -- ═══ 8. PROGRESSION COMPONENT (0-100) ═══
    -- Recent improvement trend — are scores getting better over time?
    -- Compares average of last 10 games vs previous 10 games
    SELECT LEAST(100, COALESCE(
        CASE
            WHEN (SELECT COUNT(*) FROM game_scores WHERE game_scores.profile_id = p_profile_id) < 5 THEN 30 -- baseline
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

    -- ═══ FINAL WEIGHTED SKILL RATING ═══
    -- Weights emphasize skilled play over raw grinding:
    --   Grid mastery (20%) + Time pressure (18%) + Difficulty (15%) +
    --   Challenge (15%) + Consistency (12%) + Versatility (10%) +
    --   Raw score (5%) + Progression (5%)
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

    -- ═══ EXPAND TO 0-10000 SCALE ═══
    -- Square the 0-100 internal score to create a wide competitive range
    v_skill := v_skill * v_skill / 100.0;

    -- ═══ GAMES-PLAYED CONFIDENCE GATE ═══
    -- Scale down rating for players with few games to prevent inflated ranks
    -- Full rating requires 50+ games
    v_skill := v_skill * LEAST(1.0, v_total_games / 50.0);

    -- ═══ DETERMINE CLASS ═══
    -- Wide thresholds requiring sustained skilled play:
    --   High Class:   5000+ (needs ~71 internal + 50 games)
    --   Medium Class: 1500-4999
    --   Low Class:    0-1499
    IF v_skill >= 5000 THEN v_class := 'high';
    ELSIF v_skill >= 1500 THEN v_class := 'medium';
    ELSE v_class := 'low';
    END IF;

    RETURN QUERY SELECT v_skill, v_raw, v_grid, v_diff, v_time, v_challenge, v_consistency, v_versatility, v_progression, v_class;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: REFRESH ALL LEADERBOARD RANKINGS
-- Called periodically (e.g., every 5 minutes via cron or after games)
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS void AS $$
DECLARE
    acc RECORD;
    best_profile RECORD;
    skill_data RECORD;
    rec RECORD;
    rank_counter INTEGER := 0;
    current_class TEXT := '';
    class_counter INTEGER := 0;
BEGIN
    -- Clear existing rankings
    DELETE FROM leaderboard_rankings;

    -- For each account, find the best profile and compute skill
    FOR acc IN SELECT id FROM accounts WHERE is_banned = FALSE LOOP
        -- Find the profile with the highest skill rating for this account
        best_profile := NULL;
        skill_data := NULL;

        FOR rec IN
            SELECT p.id as profile_id, p.username, s.*
            FROM profiles p
            CROSS JOIN LATERAL compute_profile_skill(p.id) s
            WHERE p.account_id = acc.id
            ORDER BY s.skill_rating DESC
            LIMIT 1
        LOOP
            -- Insert the best profile into leaderboard
            INSERT INTO leaderboard_rankings (
                account_id, profile_id, username,
                skill_rating, raw_score_component, grid_mastery_component,
                difficulty_component, time_pressure_component, challenge_component,
                consistency_component, versatility_component, progression_component,
                skill_class
            ) VALUES (
                acc.id, rec.profile_id, rec.username,
                rec.skill_rating, rec.raw_score_component, rec.grid_mastery_component,
                rec.difficulty_component, rec.time_pressure_component, rec.challenge_component,
                rec.consistency_component, rec.versatility_component, rec.progression_component,
                rec.skill_class
            );
        END LOOP;
    END LOOP;

    -- Assign global ranks by skill_rating DESC
    rank_counter := 0;
    FOR rec IN SELECT id, skill_class FROM leaderboard_rankings ORDER BY skill_rating DESC LOOP
        rank_counter := rank_counter + 1;
        UPDATE leaderboard_rankings SET global_rank = rank_counter WHERE id = rec.id;
    END LOOP;

    -- Assign class ranks (rank within each class)
    FOR current_class IN SELECT DISTINCT lr.skill_class FROM leaderboard_rankings lr LOOP
        class_counter := 0;
        FOR rec IN SELECT id FROM leaderboard_rankings WHERE skill_class = current_class ORDER BY skill_rating DESC LOOP
            class_counter := class_counter + 1;
            UPDATE leaderboard_rankings SET class_rank = class_counter WHERE id = rec.id;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: REFRESH CHALLENGE LEADERBOARDS
-- ============================================================
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

    FOR ctype IN SELECT unnest(ARRAY['target-word', 'speed-round', 'word-category']) LOOP
        FOR acc IN SELECT id FROM accounts WHERE is_banned = FALSE LOOP
            -- Find best profile for this challenge type
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

-- ============================================================
-- RPC: GET LEADERBOARD PAGE (paginated)
-- ============================================================
CREATE OR REPLACE FUNCTION get_leaderboard(
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0,
    p_class_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
    global_rank INTEGER,
    profile_id UUID,
    username TEXT,
    skill_class TEXT,
    class_rank INTEGER,
    skill_rating REAL,
    raw_score_component REAL,
    grid_mastery_component REAL,
    difficulty_component REAL,
    time_pressure_component REAL,
    challenge_component REAL,
    consistency_component REAL,
    versatility_component REAL,
    progression_component REAL,
    analysis_text TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT lr.global_rank, lr.profile_id, lr.username, lr.skill_class, lr.class_rank,
           lr.skill_rating, lr.raw_score_component, lr.grid_mastery_component,
           lr.difficulty_component, lr.time_pressure_component, lr.challenge_component,
           lr.consistency_component, lr.versatility_component, lr.progression_component,
           lr.analysis_text
    FROM leaderboard_rankings lr
    WHERE (p_class_filter IS NULL OR lr.skill_class = p_class_filter)
    ORDER BY lr.global_rank ASC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: GET CHALLENGE LEADERBOARD (paginated)
-- ============================================================
CREATE OR REPLACE FUNCTION get_challenge_leaderboard(
    p_challenge_type TEXT,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    global_rank INTEGER,
    profile_id UUID,
    username TEXT,
    skill_class TEXT,
    class_rank INTEGER,
    challenge_skill_rating REAL,
    high_score INTEGER,
    analysis_text TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT cl.global_rank, cl.profile_id, cl.username, cl.skill_class, cl.class_rank,
           cl.challenge_skill_rating, cl.high_score, cl.analysis_text
    FROM challenge_leaderboards cl
    WHERE cl.challenge_type = p_challenge_type
    ORDER BY cl.global_rank ASC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: GET MY RANK (for current user)
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_rank()
RETURNS TABLE (
    global_rank INTEGER,
    skill_class TEXT,
    class_rank INTEGER,
    skill_rating REAL,
    username TEXT,
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
           lr.username, lr.raw_score_component, lr.grid_mastery_component,
           lr.difficulty_component, lr.time_pressure_component, lr.challenge_component,
           lr.consistency_component, lr.versatility_component, lr.progression_component
    FROM leaderboard_rankings lr
    WHERE lr.account_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: GET PLAYER ANALYSIS DATA (for AI generation)
-- Returns all the data needed to generate strengths/weaknesses text
-- ============================================================
CREATE OR REPLACE FUNCTION get_player_analysis_data(p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_skill RECORD;
BEGIN
    -- Access control: profile must be on the public leaderboard, or belong to the caller
    IF NOT EXISTS (
        SELECT 1 FROM leaderboard_rankings WHERE leaderboard_rankings.profile_id = p_profile_id
        UNION ALL
        SELECT 1 FROM challenge_leaderboards WHERE challenge_leaderboards.profile_id = p_profile_id
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM profiles WHERE id = p_profile_id AND account_id = auth.uid()
        ) THEN
            RETURN '{}'::JSONB;
        END IF;
    END IF;

    SELECT * INTO v_profile FROM profiles WHERE id = p_profile_id;
    IF v_profile IS NULL THEN RETURN '{}'::JSONB; END IF;

    -- Get skill components
    SELECT * INTO v_skill FROM compute_profile_skill(p_profile_id);

    result := jsonb_build_object(
        'username', v_profile.username,
        'level', v_profile.level,
        'games_played', v_profile.games_played,
        'total_words', v_profile.total_words,
        'skill_rating', v_skill.skill_rating,
        'skill_class', v_skill.skill_class,
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
        'top_scores', (
            SELECT COALESCE(jsonb_agg(t), '[]'::JSONB) FROM (
                SELECT jsonb_build_object(
                    'game_mode', hs.game_mode,
                    'grid_size', hs.grid_size,
                    'difficulty', hs.difficulty,
                    'time_limit', hs.time_limit_seconds,
                    'challenge_type', hs.challenge_type,
                    'high_score', hs.high_score,
                    'games_played', hs.games_played,
                    'avg_score', hs.avg_score
                ) AS t
                FROM profile_high_scores hs WHERE hs.profile_id = p_profile_id
                ORDER BY hs.high_score DESC LIMIT 15
            ) sub
        ),
        'challenge_stats', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'type', cs.challenge_type,
                'high_score', cs.high_score,
                'games_played', cs.games_played,
                'target_level', cs.target_word_level
            )), '[]'::JSONB)
            FROM profile_challenge_stats cs WHERE cs.profile_id = p_profile_id
        ),
        'category_stats', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'category', cat.category_key,
                'high_score', cat.high_score,
                'games_played', cat.games_played,
                'best_words', cat.best_category_words_per_game
            )), '[]'::JSONB)
            FROM profile_category_stats cat WHERE cat.profile_id = p_profile_id
        )
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RESTRICT BULK REFRESH TO SERVICE ROLE ONLY (prevents DoS)
-- ============================================================
REVOKE EXECUTE ON FUNCTION refresh_leaderboard() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION refresh_challenge_leaderboards() FROM authenticated, anon, public;

-- ============================================================
-- RPC: UPDATE MY RANKING (lightweight per-user update)
-- Called by clients after each game — only recomputes the caller's ranking
-- ============================================================
CREATE OR REPLACE FUNCTION update_my_ranking()
RETURNS void AS $$
DECLARE
    v_account_id UUID;
    v_best_profile_id UUID;
    v_best_username TEXT;
    v_skill RECORD;
BEGIN
    v_account_id := auth.uid();
    IF v_account_id IS NULL THEN RETURN; END IF;

    -- Check if account is banned
    IF EXISTS (SELECT 1 FROM accounts WHERE id = v_account_id AND is_banned = TRUE) THEN RETURN; END IF;

    -- Find the best-skilled profile for this account
    SELECT p.id, p.username INTO v_best_profile_id, v_best_username
    FROM profiles p
    CROSS JOIN LATERAL compute_profile_skill(p.id) s
    WHERE p.account_id = v_account_id AND p.games_played > 0
    ORDER BY s.skill_rating DESC
    LIMIT 1;

    IF v_best_profile_id IS NULL THEN
        -- No profiles with games — remove from leaderboard if present
        DELETE FROM leaderboard_rankings WHERE account_id = v_account_id;
        RETURN;
    END IF;

    -- Compute skill for the best profile
    SELECT * INTO v_skill FROM compute_profile_skill(v_best_profile_id);

    -- Upsert into leaderboard
    INSERT INTO leaderboard_rankings (
        account_id, profile_id, username,
        skill_rating, raw_score_component, grid_mastery_component,
        difficulty_component, time_pressure_component, challenge_component,
        consistency_component, versatility_component, progression_component,
        skill_class, computed_at
    ) VALUES (
        v_account_id, v_best_profile_id, v_best_username,
        v_skill.skill_rating, v_skill.raw_score_component, v_skill.grid_mastery_component,
        v_skill.difficulty_component, v_skill.time_pressure_component, v_skill.challenge_component,
        v_skill.consistency_component, v_skill.versatility_component, v_skill.progression_component,
        v_skill.skill_class, NOW()
    )
    ON CONFLICT (account_id) DO UPDATE SET
        profile_id = EXCLUDED.profile_id,
        username = EXCLUDED.username,
        skill_rating = EXCLUDED.skill_rating,
        raw_score_component = EXCLUDED.raw_score_component,
        grid_mastery_component = EXCLUDED.grid_mastery_component,
        difficulty_component = EXCLUDED.difficulty_component,
        time_pressure_component = EXCLUDED.time_pressure_component,
        challenge_component = EXCLUDED.challenge_component,
        consistency_component = EXCLUDED.consistency_component,
        versatility_component = EXCLUDED.versatility_component,
        progression_component = EXCLUDED.progression_component,
        skill_class = EXCLUDED.skill_class,
        analysis_text = NULL,
        computed_at = NOW();

    -- Recompute global ranks (efficient: single UPDATE with window function)
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

    -- Also update challenge leaderboards for this user
    PERFORM update_my_challenge_rankings(v_account_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: UPDATE MY CHALLENGE RANKINGS (helper, called by update_my_ranking)
-- ============================================================
CREATE OR REPLACE FUNCTION update_my_challenge_rankings(p_account_id UUID)
RETURNS void AS $$
DECLARE
    ctype TEXT;
    rec RECORD;
BEGIN
    -- Remove existing entries for this account
    DELETE FROM challenge_leaderboards WHERE account_id = p_account_id;

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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Internal helper: don't expose update_my_challenge_rankings directly
REVOKE EXECUTE ON FUNCTION update_my_challenge_rankings(UUID) FROM authenticated, anon, public;
