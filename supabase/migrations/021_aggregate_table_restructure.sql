-- ════════════════════════════════════════════════════════════════════════════
-- Migration 021: Create per-dimension aggregate tables (ADDITIVE — safe)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Creates fixed-size aggregate tables alongside the existing game_scores
-- event log. No existing tables are renamed or deleted. Old compute_*_skill
-- functions continue to work because game_scores + stat tables are untouched.
--
-- The only destructive change is dropping 2 triggers:
--   trg_auto_update_ranking  (prevents double ranking computation)
--   trg_game_scores_refresh_mv (MV refresh handled by record_game)
-- The 5 stat-update triggers STAY so old stat tables remain accurate.
--
-- record_game() inserts into game_scores (event log, triggers still fire)
-- AND upserts into the new aggregate tables.
--
-- Migration 022 will: rewrite skill functions, add game_history & skill
-- deltas, stop event-log inserts, and archive old tables.
--
-- NEW TABLES:
--   profile_game_stats            (1 row/profile — global aggregate)
--   sandbox_grid_stats            (profile, grid_size, difficulty)
--   timed_grid_stats              (profile, time_limit, grid_size, difficulty)
--   challenge_target_word_stats   (profile, grid_size)
--   challenge_speed_round_stats   (profile, grid_size)
--   challenge_word_category_stats (profile, grid_size, category_key)
--   challenge_word_search_stats   (profile)
--   challenge_word_runner_stats   (profile)
--   profile_inventory             (1 row/profile, JSONB items)  [replaces old]
--   profile_milestones            (1 row/profile, JSONB array)  [replaces old]
-- ════════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 1: Drop only the expensive/duplicate triggers                    ║
-- ║  Keep 5 stat triggers so old tables stay accurate for compute_*_skill  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

DROP TRIGGER IF EXISTS trg_auto_update_ranking   ON game_scores;
DROP TRIGGER IF EXISTS trg_game_scores_refresh_mv ON game_scores;

-- Fix category_key CHECK constraints: original 001 only had 6 categories,
-- client now has 11 categories.  Without this fix, the dual-write INSERT into
-- game_scores (and the trigger write to profile_category_stats) would reject
-- games with categories: home, clothing, body, music, science.
ALTER TABLE game_scores DROP CONSTRAINT IF EXISTS game_scores_category_key_check;
ALTER TABLE game_scores ADD CONSTRAINT game_scores_category_key_check
    CHECK (category_key IN (
        'adjectives', 'animals', 'sports', 'food', 'nature', 'technology',
        'home', 'clothing', 'body', 'music', 'science', NULL
    ));

ALTER TABLE profile_category_stats DROP CONSTRAINT IF EXISTS profile_category_stats_category_key_check;
ALTER TABLE profile_category_stats ADD CONSTRAINT profile_category_stats_category_key_check
    CHECK (category_key IN (
        'adjectives', 'animals', 'sports', 'food', 'nature', 'technology',
        'home', 'clothing', 'body', 'music', 'science'
    ));


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 2: Archive inventory & milestones (safe — not used by skill fns) ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE profile_inventory  RENAME TO profile_inventory_legacy;
ALTER TABLE profile_milestones RENAME TO profile_milestones_legacy;

ALTER INDEX IF EXISTS profile_inventory_pkey  RENAME TO profile_inventory_legacy_pkey;
ALTER INDEX IF EXISTS profile_milestones_pkey RENAME TO profile_milestones_legacy_pkey;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 3: Create new aggregate tables                                   ║
-- ║  All include game_history JSONB + skill_rating for migration 022       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── 3a. profile_game_stats — one row per profile (global aggregate) ──
CREATE TABLE profile_game_stats (
    profile_id          UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    games_played        INTEGER NOT NULL DEFAULT 0,
    high_score          INTEGER NOT NULL DEFAULT 0,
    total_score         BIGINT  NOT NULL DEFAULT 0,
    total_words         INTEGER NOT NULL DEFAULT 0,
    avg_score           REAL    NOT NULL DEFAULT 0,
    best_combo          INTEGER NOT NULL DEFAULT 0,
    best_longest_word   INTEGER NOT NULL DEFAULT 0,
    sum_score_squared   BIGINT  NOT NULL DEFAULT 0,
    score_variance      REAL    NOT NULL DEFAULT 0,
    recent_scores       JSONB   NOT NULL DEFAULT '[]',
    total_xp_earned     INTEGER NOT NULL DEFAULT 0,
    total_coins_earned  INTEGER NOT NULL DEFAULT 0,
    game_history        JSONB   NOT NULL DEFAULT '[]',
    skill_rating        REAL    NOT NULL DEFAULT 0,
    last_played_at      TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3b. sandbox_grid_stats ──
CREATE TABLE sandbox_grid_stats (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    grid_size           INTEGER NOT NULL CHECK (grid_size BETWEEN 3 AND 8),
    difficulty          TEXT NOT NULL CHECK (difficulty IN ('casual', 'hard')),
    games_played        INTEGER NOT NULL DEFAULT 0,
    high_score          INTEGER NOT NULL DEFAULT 0,
    total_score         BIGINT  NOT NULL DEFAULT 0,
    total_words         INTEGER NOT NULL DEFAULT 0,
    avg_score           REAL    NOT NULL DEFAULT 0,
    best_combo          INTEGER NOT NULL DEFAULT 0,
    best_longest_word   INTEGER NOT NULL DEFAULT 0,
    sum_score_squared   BIGINT  NOT NULL DEFAULT 0,
    score_variance      REAL    NOT NULL DEFAULT 0,
    recent_scores       JSONB   NOT NULL DEFAULT '[]',
    total_xp_earned     INTEGER NOT NULL DEFAULT 0,
    total_coins_earned  INTEGER NOT NULL DEFAULT 0,
    game_history        JSONB   NOT NULL DEFAULT '[]',
    skill_rating        REAL    NOT NULL DEFAULT 0,
    last_played_at      TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, grid_size, difficulty)
);

-- ── 3c. timed_grid_stats ──
CREATE TABLE timed_grid_stats (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    time_limit_minutes  INTEGER NOT NULL CHECK (time_limit_minutes IN (1, 3, 5, 8, 10, 15, 20)),
    grid_size           INTEGER NOT NULL CHECK (grid_size BETWEEN 3 AND 8),
    difficulty          TEXT NOT NULL CHECK (difficulty IN ('casual', 'hard')),
    games_played        INTEGER NOT NULL DEFAULT 0,
    high_score          INTEGER NOT NULL DEFAULT 0,
    total_score         BIGINT  NOT NULL DEFAULT 0,
    total_words         INTEGER NOT NULL DEFAULT 0,
    avg_score           REAL    NOT NULL DEFAULT 0,
    best_combo          INTEGER NOT NULL DEFAULT 0,
    best_longest_word   INTEGER NOT NULL DEFAULT 0,
    best_time_remaining INTEGER NOT NULL DEFAULT 0,
    sum_score_squared   BIGINT  NOT NULL DEFAULT 0,
    score_variance      REAL    NOT NULL DEFAULT 0,
    recent_scores       JSONB   NOT NULL DEFAULT '[]',
    total_xp_earned     INTEGER NOT NULL DEFAULT 0,
    total_coins_earned  INTEGER NOT NULL DEFAULT 0,
    game_history        JSONB   NOT NULL DEFAULT '[]',
    skill_rating        REAL    NOT NULL DEFAULT 0,
    last_played_at      TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, time_limit_minutes, grid_size, difficulty)
);

-- ── 3d. challenge_target_word_stats ──
CREATE TABLE challenge_target_word_stats (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id                UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    grid_size                 INTEGER NOT NULL CHECK (grid_size IN (6, 7, 8)),
    games_played              INTEGER NOT NULL DEFAULT 0,
    high_score                INTEGER NOT NULL DEFAULT 0,
    total_score               BIGINT  NOT NULL DEFAULT 0,
    total_words               INTEGER NOT NULL DEFAULT 0,
    avg_score                 REAL    NOT NULL DEFAULT 0,
    best_combo                INTEGER NOT NULL DEFAULT 0,
    best_longest_word         INTEGER NOT NULL DEFAULT 0,
    sum_score_squared         BIGINT  NOT NULL DEFAULT 0,
    score_variance            REAL    NOT NULL DEFAULT 0,
    recent_scores             JSONB   NOT NULL DEFAULT '[]',
    target_word_level         INTEGER NOT NULL DEFAULT 1,
    total_targets_completed   INTEGER NOT NULL DEFAULT 0,
    best_targets_in_game      INTEGER NOT NULL DEFAULT 0,
    total_xp_earned           INTEGER NOT NULL DEFAULT 0,
    total_coins_earned        INTEGER NOT NULL DEFAULT 0,
    game_history              JSONB   NOT NULL DEFAULT '[]',
    skill_rating              REAL    NOT NULL DEFAULT 0,
    last_played_at            TIMESTAMPTZ,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, grid_size)
);

-- ── 3e. challenge_speed_round_stats ──
CREATE TABLE challenge_speed_round_stats (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    grid_size             INTEGER NOT NULL CHECK (grid_size IN (6, 7, 8)),
    games_played          INTEGER NOT NULL DEFAULT 0,
    high_score            INTEGER NOT NULL DEFAULT 0,
    total_score           BIGINT  NOT NULL DEFAULT 0,
    total_words           INTEGER NOT NULL DEFAULT 0,
    avg_score             REAL    NOT NULL DEFAULT 0,
    best_combo            INTEGER NOT NULL DEFAULT 0,
    best_longest_word     INTEGER NOT NULL DEFAULT 0,
    sum_score_squared     BIGINT  NOT NULL DEFAULT 0,
    score_variance        REAL    NOT NULL DEFAULT 0,
    recent_scores         JSONB   NOT NULL DEFAULT '[]',
    total_time_used_seconds INTEGER NOT NULL DEFAULT 0,
    best_words_in_game    INTEGER NOT NULL DEFAULT 0,
    total_xp_earned       INTEGER NOT NULL DEFAULT 0,
    total_coins_earned    INTEGER NOT NULL DEFAULT 0,
    game_history          JSONB   NOT NULL DEFAULT '[]',
    skill_rating          REAL    NOT NULL DEFAULT 0,
    last_played_at        TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, grid_size)
);

-- ── 3f. challenge_word_category_stats ──
CREATE TABLE challenge_word_category_stats (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    grid_size                   INTEGER NOT NULL CHECK (grid_size IN (6, 7, 8)),
    category_key                TEXT NOT NULL CHECK (category_key IN ('adjectives','animals','sports','home','clothing','food','body','music','nature','technology','science')),
    games_played                INTEGER NOT NULL DEFAULT 0,
    high_score                  INTEGER NOT NULL DEFAULT 0,
    total_score                 BIGINT  NOT NULL DEFAULT 0,
    total_words                 INTEGER NOT NULL DEFAULT 0,
    avg_score                   REAL    NOT NULL DEFAULT 0,
    best_combo                  INTEGER NOT NULL DEFAULT 0,
    best_longest_word           INTEGER NOT NULL DEFAULT 0,
    sum_score_squared           BIGINT  NOT NULL DEFAULT 0,
    score_variance              REAL    NOT NULL DEFAULT 0,
    recent_scores               JSONB   NOT NULL DEFAULT '[]',
    total_category_words        INTEGER NOT NULL DEFAULT 0,
    best_category_words_per_game INTEGER NOT NULL DEFAULT 0,
    total_xp_earned             INTEGER NOT NULL DEFAULT 0,
    total_coins_earned          INTEGER NOT NULL DEFAULT 0,
    game_history                JSONB   NOT NULL DEFAULT '[]',
    skill_rating                REAL    NOT NULL DEFAULT 0,
    last_played_at              TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, grid_size, category_key)
);

-- ── 3g. challenge_word_search_stats ──
CREATE TABLE challenge_word_search_stats (
    profile_id              UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    games_played            INTEGER NOT NULL DEFAULT 0,
    high_score              INTEGER NOT NULL DEFAULT 0,
    total_score             BIGINT  NOT NULL DEFAULT 0,
    total_words             INTEGER NOT NULL DEFAULT 0,
    avg_score               REAL    NOT NULL DEFAULT 0,
    best_combo              INTEGER NOT NULL DEFAULT 0,
    sum_score_squared       BIGINT  NOT NULL DEFAULT 0,
    score_variance          REAL    NOT NULL DEFAULT 0,
    recent_scores           JSONB   NOT NULL DEFAULT '[]',
    highest_level_reached   INTEGER NOT NULL DEFAULT 1,
    avg_completion_rate     REAL    NOT NULL DEFAULT 0,
    perfect_clears          INTEGER NOT NULL DEFAULT 0,
    avg_time_efficiency     REAL    NOT NULL DEFAULT 0,
    total_bonus_words       INTEGER NOT NULL DEFAULT 0,
    best_bonus_words_single INTEGER NOT NULL DEFAULT 0,
    total_placed_words      INTEGER NOT NULL DEFAULT 0,
    fastest_clear_seconds   REAL,
    total_xp_earned         INTEGER NOT NULL DEFAULT 0,
    total_coins_earned      INTEGER NOT NULL DEFAULT 0,
    game_history            JSONB   NOT NULL DEFAULT '[]',
    skill_rating            REAL    NOT NULL DEFAULT 0,
    last_played_at          TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3h. challenge_word_runner_stats ──
CREATE TABLE challenge_word_runner_stats (
    profile_id          UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    games_played        INTEGER NOT NULL DEFAULT 0,
    high_score          INTEGER NOT NULL DEFAULT 0,
    total_score         BIGINT  NOT NULL DEFAULT 0,
    total_words         INTEGER NOT NULL DEFAULT 0,
    avg_score           REAL    NOT NULL DEFAULT 0,
    best_combo          INTEGER NOT NULL DEFAULT 0,
    sum_score_squared   BIGINT  NOT NULL DEFAULT 0,
    score_variance      REAL    NOT NULL DEFAULT 0,
    recent_scores       JSONB   NOT NULL DEFAULT '[]',
    best_distance       INTEGER NOT NULL DEFAULT 0,
    total_xp_earned     INTEGER NOT NULL DEFAULT 0,
    total_coins_earned  INTEGER NOT NULL DEFAULT 0,
    game_history        JSONB   NOT NULL DEFAULT '[]',
    skill_rating        REAL    NOT NULL DEFAULT 0,
    last_played_at      TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 4: New inventory & milestones (JSONB, 1 row per profile)         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE profile_inventory (
    profile_id  UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    items       JSONB NOT NULL DEFAULT '[]',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE profile_milestones (
    profile_id  UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    milestones  JSONB NOT NULL DEFAULT '[]',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 5: Backfill all new tables from game_scores event log            ║
-- ║  game_history + skill_rating stay at defaults (populated by 022)       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── 5a. profile_game_stats ──
INSERT INTO profile_game_stats (
    profile_id, games_played, high_score, total_score, total_words,
    avg_score, best_combo, best_longest_word, sum_score_squared,
    score_variance, recent_scores, total_xp_earned, total_coins_earned,
    last_played_at
)
SELECT
    agg.profile_id, agg.games_played, agg.high_score, agg.total_score,
    agg.total_words, agg.avg_score, agg.best_combo, agg.best_longest_word,
    agg.sum_sq,
    CASE WHEN agg.games_played > 1
         THEN GREATEST(0, (agg.sum_sq::REAL / agg.games_played) - POWER(agg.avg_score, 2))
         ELSE 0 END,
    COALESCE(recent.scores, '[]'),
    agg.total_xp, agg.total_coins, agg.last_played
FROM (
    SELECT
        g.profile_id,
        COUNT(*)::INTEGER                       AS games_played,
        MAX(g.score)::INTEGER                   AS high_score,
        SUM(g.score)::BIGINT                    AS total_score,
        SUM(COALESCE(g.words_found, 0))::INTEGER AS total_words,
        AVG(g.score)::REAL                      AS avg_score,
        MAX(COALESCE(g.best_combo, 0))::INTEGER AS best_combo,
        MAX(COALESCE(g.longest_word_length, 0))::INTEGER AS best_longest_word,
        SUM(g.score::BIGINT * g.score::BIGINT)  AS sum_sq,
        SUM(COALESCE(g.xp_earned, 0))::INTEGER  AS total_xp,
        SUM(COALESCE(g.coins_earned, 0))::INTEGER AS total_coins,
        MAX(g.played_at)                        AS last_played
    FROM game_scores g
    GROUP BY g.profile_id
) agg
LEFT JOIN LATERAL (
    SELECT jsonb_agg(sub.score) AS scores
    FROM (
        SELECT g2.score FROM game_scores g2
        WHERE g2.profile_id = agg.profile_id
        ORDER BY g2.played_at DESC LIMIT 30
    ) sub
) recent ON TRUE;

-- ── 5b. sandbox_grid_stats ──
INSERT INTO sandbox_grid_stats (
    profile_id, grid_size, difficulty,
    games_played, high_score, total_score, total_words, avg_score,
    best_combo, best_longest_word, sum_score_squared, score_variance,
    recent_scores, total_xp_earned, total_coins_earned, last_played_at
)
SELECT
    agg.profile_id, agg.grid_size, agg.difficulty,
    agg.games_played, agg.high_score, agg.total_score, agg.total_words,
    agg.avg_score, agg.best_combo, agg.best_longest_word, agg.sum_sq,
    CASE WHEN agg.games_played > 1
         THEN GREATEST(0, (agg.sum_sq::REAL / agg.games_played) - POWER(agg.avg_score, 2))
         ELSE 0 END,
    COALESCE(recent.scores, '[]'),
    agg.total_xp, agg.total_coins, agg.last_played
FROM (
    SELECT
        g.profile_id, g.grid_size, g.difficulty,
        COUNT(*)::INTEGER AS games_played,
        MAX(g.score)::INTEGER AS high_score,
        SUM(g.score)::BIGINT AS total_score,
        SUM(COALESCE(g.words_found, 0))::INTEGER AS total_words,
        AVG(g.score)::REAL AS avg_score,
        MAX(COALESCE(g.best_combo, 0))::INTEGER AS best_combo,
        MAX(COALESCE(g.longest_word_length, 0))::INTEGER AS best_longest_word,
        SUM(g.score::BIGINT * g.score::BIGINT) AS sum_sq,
        SUM(COALESCE(g.xp_earned, 0))::INTEGER AS total_xp,
        SUM(COALESCE(g.coins_earned, 0))::INTEGER AS total_coins,
        MAX(g.played_at) AS last_played
    FROM game_scores g
    WHERE g.is_challenge = FALSE
      AND (g.time_limit_seconds IS NULL OR g.time_limit_seconds = 0)
      AND g.grid_size IS NOT NULL AND g.difficulty IS NOT NULL
    GROUP BY g.profile_id, g.grid_size, g.difficulty
) agg
LEFT JOIN LATERAL (
    SELECT jsonb_agg(sub.score) AS scores
    FROM (
        SELECT g2.score FROM game_scores g2
        WHERE g2.profile_id = agg.profile_id
          AND g2.is_challenge = FALSE
          AND (g2.time_limit_seconds IS NULL OR g2.time_limit_seconds = 0)
          AND g2.grid_size = agg.grid_size AND g2.difficulty = agg.difficulty
        ORDER BY g2.played_at DESC LIMIT 30
    ) sub
) recent ON TRUE;

-- ── 5c. timed_grid_stats ──
INSERT INTO timed_grid_stats (
    profile_id, time_limit_minutes, grid_size, difficulty,
    games_played, high_score, total_score, total_words, avg_score,
    best_combo, best_longest_word, best_time_remaining, sum_score_squared,
    score_variance, recent_scores, total_xp_earned, total_coins_earned,
    last_played_at
)
SELECT
    agg.profile_id, agg.tlm, agg.grid_size, agg.difficulty,
    agg.games_played, agg.high_score, agg.total_score, agg.total_words,
    agg.avg_score, agg.best_combo, agg.best_longest_word, agg.best_time_rem,
    agg.sum_sq,
    CASE WHEN agg.games_played > 1
         THEN GREATEST(0, (agg.sum_sq::REAL / agg.games_played) - POWER(agg.avg_score, 2))
         ELSE 0 END,
    COALESCE(recent.scores, '[]'),
    agg.total_xp, agg.total_coins, agg.last_played
FROM (
    SELECT
        g.profile_id,
        ROUND(g.time_limit_seconds / 60.0)::INTEGER AS tlm,
        g.grid_size, g.difficulty,
        COUNT(*)::INTEGER AS games_played,
        MAX(g.score)::INTEGER AS high_score,
        SUM(g.score)::BIGINT AS total_score,
        SUM(COALESCE(g.words_found, 0))::INTEGER AS total_words,
        AVG(g.score)::REAL AS avg_score,
        MAX(COALESCE(g.best_combo, 0))::INTEGER AS best_combo,
        MAX(COALESCE(g.longest_word_length, 0))::INTEGER AS best_longest_word,
        MAX(COALESCE(g.time_remaining_seconds, 0))::INTEGER AS best_time_rem,
        SUM(g.score::BIGINT * g.score::BIGINT) AS sum_sq,
        SUM(COALESCE(g.xp_earned, 0))::INTEGER AS total_xp,
        SUM(COALESCE(g.coins_earned, 0))::INTEGER AS total_coins,
        MAX(g.played_at) AS last_played
    FROM game_scores g
    WHERE g.is_challenge = FALSE
      AND g.time_limit_seconds IS NOT NULL AND g.time_limit_seconds > 0
      AND g.grid_size IS NOT NULL AND g.difficulty IS NOT NULL
      AND ROUND(g.time_limit_seconds / 60.0)::INTEGER IN (1, 3, 5, 8, 10, 15, 20)
    GROUP BY g.profile_id, tlm, g.grid_size, g.difficulty
) agg
LEFT JOIN LATERAL (
    SELECT jsonb_agg(sub.score) AS scores
    FROM (
        SELECT g2.score FROM game_scores g2
        WHERE g2.profile_id = agg.profile_id
          AND g2.is_challenge = FALSE
          AND g2.time_limit_seconds IS NOT NULL AND g2.time_limit_seconds > 0
          AND ROUND(g2.time_limit_seconds / 60.0)::INTEGER = agg.tlm
          AND g2.grid_size = agg.grid_size AND g2.difficulty = agg.difficulty
        ORDER BY g2.played_at DESC LIMIT 30
    ) sub
) recent ON TRUE;

-- ── 5d. challenge_target_word_stats ──
INSERT INTO challenge_target_word_stats (
    profile_id, grid_size,
    games_played, high_score, total_score, total_words, avg_score,
    best_combo, best_longest_word, sum_score_squared, score_variance,
    recent_scores, target_word_level, total_targets_completed,
    best_targets_in_game, total_xp_earned, total_coins_earned, last_played_at
)
SELECT
    agg.profile_id, agg.grid_size,
    agg.games_played, agg.high_score, agg.total_score, agg.total_words,
    agg.avg_score, agg.best_combo, agg.best_longest_word, agg.sum_sq,
    CASE WHEN agg.games_played > 1
         THEN GREATEST(0, (agg.sum_sq::REAL / agg.games_played) - POWER(agg.avg_score, 2))
         ELSE 0 END,
    COALESCE(recent.scores, '[]'),
    1 + COALESCE(agg.total_targets, 0), agg.total_targets, agg.best_targets,
    agg.total_xp, agg.total_coins, agg.last_played
FROM (
    SELECT
        g.profile_id, COALESCE(g.grid_size, 6) AS grid_size,
        COUNT(*)::INTEGER AS games_played,
        MAX(g.score)::INTEGER AS high_score,
        SUM(g.score)::BIGINT AS total_score,
        SUM(COALESCE(g.words_found, 0))::INTEGER AS total_words,
        AVG(g.score)::REAL AS avg_score,
        MAX(COALESCE(g.best_combo, 0))::INTEGER AS best_combo,
        MAX(COALESCE(g.longest_word_length, 0))::INTEGER AS best_longest_word,
        SUM(g.score::BIGINT * g.score::BIGINT) AS sum_sq,
        MAX(COALESCE(g.target_words_completed, 0))::INTEGER AS max_targets,
        SUM(COALESCE(g.target_words_completed, 0))::INTEGER AS total_targets,
        MAX(COALESCE(g.target_words_completed, 0))::INTEGER AS best_targets,
        SUM(COALESCE(g.xp_earned, 0))::INTEGER AS total_xp,
        SUM(COALESCE(g.coins_earned, 0))::INTEGER AS total_coins,
        MAX(g.played_at) AS last_played
    FROM game_scores g
    WHERE g.is_challenge = TRUE AND g.challenge_type = 'target-word'
    GROUP BY g.profile_id, COALESCE(g.grid_size, 6)
) agg
LEFT JOIN LATERAL (
    SELECT jsonb_agg(sub.score) AS scores
    FROM (
        SELECT g2.score FROM game_scores g2
        WHERE g2.profile_id = agg.profile_id
          AND g2.is_challenge = TRUE AND g2.challenge_type = 'target-word'
          AND COALESCE(g2.grid_size, 6) = agg.grid_size
        ORDER BY g2.played_at DESC LIMIT 30
    ) sub
) recent ON TRUE;

-- ── 5e. challenge_speed_round_stats ──
INSERT INTO challenge_speed_round_stats (
    profile_id, grid_size,
    games_played, high_score, total_score, total_words, avg_score,
    best_combo, best_longest_word, sum_score_squared, score_variance,
    recent_scores, total_time_used_seconds, best_words_in_game,
    total_xp_earned, total_coins_earned, last_played_at
)
SELECT
    agg.profile_id, agg.grid_size,
    agg.games_played, agg.high_score, agg.total_score, agg.total_words,
    agg.avg_score, agg.best_combo, agg.best_longest_word, agg.sum_sq,
    CASE WHEN agg.games_played > 1
         THEN GREATEST(0, (agg.sum_sq::REAL / agg.games_played) - POWER(agg.avg_score, 2))
         ELSE 0 END,
    COALESCE(recent.scores, '[]'),
    agg.total_time_used, agg.best_words,
    agg.total_xp, agg.total_coins, agg.last_played
FROM (
    SELECT
        g.profile_id, COALESCE(g.grid_size, 6) AS grid_size,
        COUNT(*)::INTEGER AS games_played,
        MAX(g.score)::INTEGER AS high_score,
        SUM(g.score)::BIGINT AS total_score,
        SUM(COALESCE(g.words_found, 0))::INTEGER AS total_words,
        AVG(g.score)::REAL AS avg_score,
        MAX(COALESCE(g.best_combo, 0))::INTEGER AS best_combo,
        MAX(COALESCE(g.longest_word_length, 0))::INTEGER AS best_longest_word,
        SUM(g.score::BIGINT * g.score::BIGINT) AS sum_sq,
        SUM(COALESCE(g.time_limit_seconds, 0) - COALESCE(g.time_remaining_seconds, 0))::INTEGER AS total_time_used,
        MAX(COALESCE(g.words_found, 0))::INTEGER AS best_words,
        SUM(COALESCE(g.xp_earned, 0))::INTEGER AS total_xp,
        SUM(COALESCE(g.coins_earned, 0))::INTEGER AS total_coins,
        MAX(g.played_at) AS last_played
    FROM game_scores g
    WHERE g.is_challenge = TRUE AND g.challenge_type = 'speed-round'
    GROUP BY g.profile_id, COALESCE(g.grid_size, 6)
) agg
LEFT JOIN LATERAL (
    SELECT jsonb_agg(sub.score) AS scores
    FROM (
        SELECT g2.score FROM game_scores g2
        WHERE g2.profile_id = agg.profile_id
          AND g2.is_challenge = TRUE AND g2.challenge_type = 'speed-round'
          AND COALESCE(g2.grid_size, 6) = agg.grid_size
        ORDER BY g2.played_at DESC LIMIT 30
    ) sub
) recent ON TRUE;

-- ── 5f. challenge_word_category_stats ──
INSERT INTO challenge_word_category_stats (
    profile_id, grid_size, category_key,
    games_played, high_score, total_score, total_words, avg_score,
    best_combo, best_longest_word, sum_score_squared, score_variance,
    recent_scores, total_category_words, best_category_words_per_game,
    total_xp_earned, total_coins_earned, last_played_at
)
SELECT
    agg.profile_id, agg.grid_size, agg.category_key,
    agg.games_played, agg.high_score, agg.total_score, agg.total_words,
    agg.avg_score, agg.best_combo, agg.best_longest_word, agg.sum_sq,
    CASE WHEN agg.games_played > 1
         THEN GREATEST(0, (agg.sum_sq::REAL / agg.games_played) - POWER(agg.avg_score, 2))
         ELSE 0 END,
    COALESCE(recent.scores, '[]'),
    agg.total_cat_words, agg.best_cat_words,
    agg.total_xp, agg.total_coins, agg.last_played
FROM (
    SELECT
        g.profile_id,
        COALESCE(g.grid_size, 6) AS grid_size,
        COALESCE(g.category_key, 'animals') AS category_key,
        COUNT(*)::INTEGER AS games_played,
        MAX(g.score)::INTEGER AS high_score,
        SUM(g.score)::BIGINT AS total_score,
        SUM(COALESCE(g.words_found, 0))::INTEGER AS total_words,
        AVG(g.score)::REAL AS avg_score,
        MAX(COALESCE(g.best_combo, 0))::INTEGER AS best_combo,
        MAX(COALESCE(g.longest_word_length, 0))::INTEGER AS best_longest_word,
        SUM(g.score::BIGINT * g.score::BIGINT) AS sum_sq,
        SUM(COALESCE(g.bonus_words_completed, 0))::INTEGER AS total_cat_words,
        MAX(COALESCE(g.bonus_words_completed, 0))::INTEGER AS best_cat_words,
        SUM(COALESCE(g.xp_earned, 0))::INTEGER AS total_xp,
        SUM(COALESCE(g.coins_earned, 0))::INTEGER AS total_coins,
        MAX(g.played_at) AS last_played
    FROM game_scores g
    WHERE g.is_challenge = TRUE AND g.challenge_type = 'word-category'
      AND g.category_key IS NOT NULL
    GROUP BY g.profile_id, COALESCE(g.grid_size, 6), g.category_key
) agg
LEFT JOIN LATERAL (
    SELECT jsonb_agg(sub.score) AS scores
    FROM (
        SELECT g2.score FROM game_scores g2
        WHERE g2.profile_id = agg.profile_id
          AND g2.is_challenge = TRUE AND g2.challenge_type = 'word-category'
          AND COALESCE(g2.grid_size, 6) = agg.grid_size
          AND g2.category_key = agg.category_key
        ORDER BY g2.played_at DESC LIMIT 30
    ) sub
) recent ON TRUE;

-- ── 5g. challenge_word_search_stats ──
INSERT INTO challenge_word_search_stats (
    profile_id, games_played, high_score, total_score, total_words,
    avg_score, best_combo, sum_score_squared, score_variance, recent_scores,
    highest_level_reached, avg_completion_rate, perfect_clears,
    avg_time_efficiency, total_bonus_words, best_bonus_words_single,
    total_placed_words, fastest_clear_seconds,
    total_xp_earned, total_coins_earned, last_played_at
)
SELECT
    COALESCE(gs.profile_id, ws.profile_id),
    COALESCE(gs.games_played, COALESCE(ws.games_played, 0)),
    GREATEST(COALESCE(gs.high_score, 0), COALESCE(ws.high_score, 0)),
    COALESCE(gs.total_score, 0),
    COALESCE(gs.total_words, COALESCE(ws.total_words_found, 0)),
    COALESCE(gs.avg_score, 0),
    COALESCE(gs.best_combo, 0),
    COALESCE(gs.sum_sq, 0),
    CASE WHEN COALESCE(gs.games_played, 0) > 1
         THEN GREATEST(0, (COALESCE(gs.sum_sq, 0)::REAL / gs.games_played) - POWER(COALESCE(gs.avg_score, 0), 2))
         ELSE 0 END,
    COALESCE(gs.recent_scores, '[]'),
    COALESCE(ws.highest_level_reached, 1),
    COALESCE(ws.avg_completion_rate, 0),
    COALESCE(ws.perfect_clears, 0),
    COALESCE(ws.avg_time_efficiency, 0),
    COALESCE(ws.total_bonus_words, 0),
    COALESCE(ws.best_bonus_words_single, 0),
    COALESCE(ws.total_placed_words, 0),
    ws.fastest_clear_seconds,
    COALESCE(gs.total_xp, 0),
    COALESCE(gs.total_coins, 0),
    COALESCE(gs.last_played, ws.updated_at)
FROM (
    SELECT
        g.profile_id,
        COUNT(*)::INTEGER AS games_played,
        MAX(g.score)::INTEGER AS high_score,
        SUM(g.score)::BIGINT AS total_score,
        SUM(COALESCE(g.words_found, 0))::INTEGER AS total_words,
        AVG(g.score)::REAL AS avg_score,
        MAX(COALESCE(g.best_combo, 0))::INTEGER AS best_combo,
        SUM(g.score::BIGINT * g.score::BIGINT) AS sum_sq,
        (SELECT jsonb_agg(sub.score) FROM (
            SELECT g2.score FROM game_scores g2
            WHERE g2.profile_id = g.profile_id
              AND g2.is_challenge = TRUE AND g2.challenge_type = 'word-search'
            ORDER BY g2.played_at DESC LIMIT 30
        ) sub) AS recent_scores,
        SUM(COALESCE(g.xp_earned, 0))::INTEGER AS total_xp,
        SUM(COALESCE(g.coins_earned, 0))::INTEGER AS total_coins,
        MAX(g.played_at) AS last_played
    FROM game_scores g
    WHERE g.is_challenge = TRUE AND g.challenge_type = 'word-search'
    GROUP BY g.profile_id
) gs
FULL OUTER JOIN profile_word_search_stats ws
    ON gs.profile_id = ws.profile_id;

-- ── 5h. challenge_word_runner_stats ──
INSERT INTO challenge_word_runner_stats (
    profile_id, games_played, high_score, total_score, total_words,
    avg_score, best_combo, sum_score_squared, score_variance, recent_scores,
    best_distance, total_xp_earned, total_coins_earned, last_played_at
)
SELECT
    agg.profile_id,
    agg.games_played, agg.high_score, agg.total_score, agg.total_words,
    agg.avg_score, agg.best_combo, agg.sum_sq,
    CASE WHEN agg.games_played > 1
         THEN GREATEST(0, (agg.sum_sq::REAL / agg.games_played) - POWER(agg.avg_score, 2))
         ELSE 0 END,
    COALESCE(recent.scores, '[]'),
    agg.high_score,
    agg.total_xp, agg.total_coins, agg.last_played
FROM (
    SELECT
        g.profile_id,
        COUNT(*)::INTEGER AS games_played,
        MAX(g.score)::INTEGER AS high_score,
        SUM(g.score)::BIGINT AS total_score,
        SUM(COALESCE(g.words_found, 0))::INTEGER AS total_words,
        AVG(g.score)::REAL AS avg_score,
        MAX(COALESCE(g.best_combo, 0))::INTEGER AS best_combo,
        SUM(g.score::BIGINT * g.score::BIGINT) AS sum_sq,
        SUM(COALESCE(g.xp_earned, 0))::INTEGER AS total_xp,
        SUM(COALESCE(g.coins_earned, 0))::INTEGER AS total_coins,
        MAX(g.played_at) AS last_played
    FROM game_scores g
    WHERE g.challenge_type = 'word-runner'
    GROUP BY g.profile_id
) agg
LEFT JOIN LATERAL (
    SELECT jsonb_agg(sub.score) AS scores
    FROM (
        SELECT g2.score FROM game_scores g2
        WHERE g2.profile_id = agg.profile_id AND g2.challenge_type = 'word-runner'
        ORDER BY g2.played_at DESC LIMIT 30
    ) sub
) recent ON TRUE;

-- ── 5i. profile_inventory ──
INSERT INTO profile_inventory (profile_id, items)
SELECT
    il.profile_id,
    COALESCE(jsonb_agg(
        jsonb_build_object('item_id', il.item_id, 'purchased_at', il.purchased_at)
        ORDER BY il.purchased_at
    ), '[]')
FROM profile_inventory_legacy il
GROUP BY il.profile_id;

-- ── 5j. profile_milestones ──
INSERT INTO profile_milestones (profile_id, milestones)
SELECT
    ml.profile_id,
    COALESCE(jsonb_agg(
        jsonb_build_object('id', ml.milestone_id, 'earned_at', ml.earned_at, 'coins_awarded', ml.coins_awarded)
        ORDER BY ml.earned_at
    ), '[]')
FROM profile_milestones_legacy ml
GROUP BY ml.profile_id;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 6: RLS policies                                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE profile_game_stats            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_grid_stats            ENABLE ROW LEVEL SECURITY;
ALTER TABLE timed_grid_stats              ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_target_word_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_speed_round_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_word_category_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_word_search_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_word_runner_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_inventory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_milestones            ENABLE ROW LEVEL SECURITY;

CREATE POLICY pgs_select_own ON profile_game_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY sandbox_stats_select_own ON sandbox_grid_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY timed_stats_select_own ON timed_grid_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY tw_stats_select_own ON challenge_target_word_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY sr_stats_select_own ON challenge_speed_round_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY wc_stats_select_own ON challenge_word_category_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY ws_stats_select_own ON challenge_word_search_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY wr_stats_select_own ON challenge_word_runner_stats FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY inventory_select_own ON profile_inventory FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));
CREATE POLICY milestones_select_own ON profile_milestones FOR SELECT
    USING (profile_id IN (SELECT id FROM profiles WHERE account_id = auth.uid()));


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 7: Indexes                                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE INDEX idx_sandbox_stats_profile ON sandbox_grid_stats(profile_id);
CREATE INDEX idx_timed_stats_profile   ON timed_grid_stats(profile_id);
CREATE INDEX idx_tw_stats_profile      ON challenge_target_word_stats(profile_id);
CREATE INDEX idx_sr_stats_profile      ON challenge_speed_round_stats(profile_id);
CREATE INDEX idx_wc_stats_profile      ON challenge_word_category_stats(profile_id);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 8: record_game() RPC                                             ║
-- ║  Inserts into game_scores event log (triggers fire for old stat compat) ║
-- ║  AND upserts into the new aggregate tables.                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION record_game(
    p_profile_id             UUID,
    p_game_mode              TEXT,
    p_is_challenge           BOOLEAN,
    p_challenge_type         TEXT,
    p_category_key           TEXT,
    p_grid_size              INTEGER,
    p_difficulty             TEXT,
    p_time_limit_seconds     INTEGER,
    p_score                  INTEGER,
    p_words_found            INTEGER,
    p_longest_word_length    INTEGER,
    p_best_combo             INTEGER,
    p_target_words_completed INTEGER DEFAULT 0,
    p_bonus_words_completed  INTEGER DEFAULT 0,
    p_time_remaining_seconds INTEGER DEFAULT NULL,
    p_xp_earned              INTEGER DEFAULT 0,
    p_coins_earned           INTEGER DEFAULT 0,
    p_grid_factor            REAL DEFAULT 1.0,
    p_difficulty_multiplier  REAL DEFAULT 1.0,
    p_mode_multiplier        REAL DEFAULT 1.0,
    p_ws_placed_words        INTEGER DEFAULT NULL,
    p_ws_level               INTEGER DEFAULT NULL,
    p_ws_is_perfect_clear    BOOLEAN DEFAULT FALSE,
    p_ws_clear_seconds       REAL DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_account_id UUID;
    v_is_new_high BOOLEAN := FALSE;
    v_time_limit_min INTEGER;
    v_time_used INTEGER;
    v_completion_rate REAL;
BEGIN
    -- Verify ownership
    SELECT account_id INTO v_account_id
    FROM profiles WHERE id = p_profile_id;
    IF v_account_id IS NULL OR v_account_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
    END IF;

    -- ════════════════════════════════════════════════════════════════
    -- SECURITY: Clamp all numeric inputs to sane ranges
    -- ════════════════════════════════════════════════════════════════
    p_score                  := LEAST(GREATEST(p_score, 0), 100000);
    p_words_found            := LEAST(GREATEST(p_words_found, 0), 5000);
    p_longest_word_length    := LEAST(GREATEST(p_longest_word_length, 0), 50);
    p_best_combo             := LEAST(GREATEST(p_best_combo, 0), 500);
    p_target_words_completed := LEAST(GREATEST(COALESCE(p_target_words_completed, 0), 0), 500);
    p_bonus_words_completed  := LEAST(GREATEST(COALESCE(p_bonus_words_completed, 0), 0), 500);
    p_xp_earned              := LEAST(GREATEST(COALESCE(p_xp_earned, 0), 0), 50000);
    p_coins_earned           := LEAST(GREATEST(COALESCE(p_coins_earned, 0), 0), 10000);
    p_grid_factor            := LEAST(GREATEST(COALESCE(p_grid_factor, 1.0), 0.1), 10.0);
    p_difficulty_multiplier  := LEAST(GREATEST(COALESCE(p_difficulty_multiplier, 1.0), 0.1), 10.0);
    p_mode_multiplier        := LEAST(GREATEST(COALESCE(p_mode_multiplier, 1.0), 0.1), 10.0);
    IF p_time_remaining_seconds IS NOT NULL THEN
        p_time_remaining_seconds := LEAST(GREATEST(p_time_remaining_seconds, 0), 7200);
    END IF;

    -- ════════════════════════════════════════════════════════════════
    -- A. INSERT into game_scores event log (stat triggers still fire)
    -- ════════════════════════════════════════════════════════════════
    INSERT INTO game_scores (
        id, profile_id, game_mode, is_challenge, challenge_type, category_key,
        grid_size, difficulty, time_limit_seconds, score, words_found,
        longest_word_length, best_combo, target_words_completed,
        bonus_words_completed, time_remaining_seconds, xp_earned,
        coins_earned, grid_factor, difficulty_multiplier, mode_multiplier,
        played_at
    ) VALUES (
        gen_random_uuid(), p_profile_id, p_game_mode, p_is_challenge,
        p_challenge_type, p_category_key, p_grid_size, p_difficulty,
        p_time_limit_seconds, p_score, p_words_found, p_longest_word_length,
        p_best_combo, p_target_words_completed, p_bonus_words_completed,
        p_time_remaining_seconds, p_xp_earned, p_coins_earned,
        p_grid_factor, p_difficulty_multiplier, p_mode_multiplier, NOW()
    );

    -- ════════════════════════════════════════════════════════════════
    -- B. UPSERT dimension-specific aggregate table
    -- ════════════════════════════════════════════════════════════════

    IF p_is_challenge AND p_challenge_type = 'target-word' THEN
        INSERT INTO challenge_target_word_stats (
            profile_id, grid_size, games_played, high_score, total_score,
            total_words, avg_score, best_combo, best_longest_word,
            sum_score_squared, score_variance, recent_scores,
            target_word_level, total_targets_completed, best_targets_in_game,
            total_xp_earned, total_coins_earned, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 6), 1, p_score, p_score,
            p_words_found, p_score, p_best_combo, p_longest_word_length,
            p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
            1 + COALESCE(p_target_words_completed, 0), COALESCE(p_target_words_completed, 0),
            COALESCE(p_target_words_completed, 0),
            p_xp_earned, p_coins_earned, NOW()
        )
        ON CONFLICT (profile_id, grid_size) DO UPDATE SET
            games_played    = challenge_target_word_stats.games_played + 1,
            high_score      = GREATEST(challenge_target_word_stats.high_score, p_score),
            total_score     = challenge_target_word_stats.total_score + p_score,
            total_words     = challenge_target_word_stats.total_words + p_words_found,
            avg_score       = (challenge_target_word_stats.total_score + p_score)::REAL / (challenge_target_word_stats.games_played + 1),
            best_combo      = GREATEST(challenge_target_word_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(challenge_target_word_stats.best_longest_word, p_longest_word_length),
            sum_score_squared = challenge_target_word_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_target_word_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_target_word_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_target_word_stats.games_played + 1))
                     - POWER((challenge_target_word_stats.total_score + p_score)::REAL / (challenge_target_word_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_target_word_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            target_word_level = 1 + challenge_target_word_stats.total_targets_completed + COALESCE(p_target_words_completed, 0),
            total_targets_completed = challenge_target_word_stats.total_targets_completed + COALESCE(p_target_words_completed, 0),
            best_targets_in_game = GREATEST(challenge_target_word_stats.best_targets_in_game, COALESCE(p_target_words_completed, 0)),
            total_xp_earned = challenge_target_word_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_target_word_stats.total_coins_earned + p_coins_earned,
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'speed-round' THEN
        v_time_used := COALESCE(p_time_limit_seconds, 0) - COALESCE(p_time_remaining_seconds, 0);
        INSERT INTO challenge_speed_round_stats (
            profile_id, grid_size, games_played, high_score, total_score,
            total_words, avg_score, best_combo, best_longest_word,
            sum_score_squared, score_variance, recent_scores,
            total_time_used_seconds, best_words_in_game,
            total_xp_earned, total_coins_earned, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 6), 1, p_score, p_score,
            p_words_found, p_score, p_best_combo, p_longest_word_length,
            p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
            GREATEST(0, v_time_used), p_words_found,
            p_xp_earned, p_coins_earned, NOW()
        )
        ON CONFLICT (profile_id, grid_size) DO UPDATE SET
            games_played    = challenge_speed_round_stats.games_played + 1,
            high_score      = GREATEST(challenge_speed_round_stats.high_score, p_score),
            total_score     = challenge_speed_round_stats.total_score + p_score,
            total_words     = challenge_speed_round_stats.total_words + p_words_found,
            avg_score       = (challenge_speed_round_stats.total_score + p_score)::REAL / (challenge_speed_round_stats.games_played + 1),
            best_combo      = GREATEST(challenge_speed_round_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(challenge_speed_round_stats.best_longest_word, p_longest_word_length),
            sum_score_squared = challenge_speed_round_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_speed_round_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_speed_round_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_speed_round_stats.games_played + 1))
                     - POWER((challenge_speed_round_stats.total_score + p_score)::REAL / (challenge_speed_round_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_speed_round_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            total_time_used_seconds = challenge_speed_round_stats.total_time_used_seconds + GREATEST(0, v_time_used),
            best_words_in_game = GREATEST(challenge_speed_round_stats.best_words_in_game, p_words_found),
            total_xp_earned = challenge_speed_round_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_speed_round_stats.total_coins_earned + p_coins_earned,
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'word-category' THEN
        INSERT INTO challenge_word_category_stats (
            profile_id, grid_size, category_key,
            games_played, high_score, total_score, total_words, avg_score,
            best_combo, best_longest_word, sum_score_squared, score_variance,
            recent_scores, total_category_words, best_category_words_per_game,
            total_xp_earned, total_coins_earned, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 6), COALESCE(p_category_key, 'animals'),
            1, p_score, p_score, p_words_found, p_score, p_best_combo,
            p_longest_word_length, p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score),
            COALESCE(p_bonus_words_completed, 0), COALESCE(p_bonus_words_completed, 0),
            p_xp_earned, p_coins_earned, NOW()
        )
        ON CONFLICT (profile_id, grid_size, category_key) DO UPDATE SET
            games_played    = challenge_word_category_stats.games_played + 1,
            high_score      = GREATEST(challenge_word_category_stats.high_score, p_score),
            total_score     = challenge_word_category_stats.total_score + p_score,
            total_words     = challenge_word_category_stats.total_words + p_words_found,
            avg_score       = (challenge_word_category_stats.total_score + p_score)::REAL / (challenge_word_category_stats.games_played + 1),
            best_combo      = GREATEST(challenge_word_category_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(challenge_word_category_stats.best_longest_word, p_longest_word_length),
            sum_score_squared = challenge_word_category_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_word_category_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_word_category_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_word_category_stats.games_played + 1))
                     - POWER((challenge_word_category_stats.total_score + p_score)::REAL / (challenge_word_category_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_word_category_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            total_category_words = challenge_word_category_stats.total_category_words + COALESCE(p_bonus_words_completed, 0),
            best_category_words_per_game = GREATEST(challenge_word_category_stats.best_category_words_per_game, COALESCE(p_bonus_words_completed, 0)),
            total_xp_earned = challenge_word_category_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_word_category_stats.total_coins_earned + p_coins_earned,
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'word-search' THEN
        v_completion_rate := CASE
            WHEN COALESCE(p_ws_placed_words, 0) > 0
            THEN LEAST(1.0, p_words_found::REAL / p_ws_placed_words)
            ELSE 0 END;

        INSERT INTO challenge_word_search_stats (
            profile_id, games_played, high_score, total_score, total_words,
            avg_score, best_combo, sum_score_squared, score_variance,
            recent_scores, highest_level_reached, avg_completion_rate,
            perfect_clears, avg_time_efficiency, total_bonus_words,
            best_bonus_words_single, total_placed_words, fastest_clear_seconds,
            total_xp_earned, total_coins_earned, last_played_at
        ) VALUES (
            p_profile_id, 1, p_score, p_score, p_words_found,
            p_score, COALESCE(p_best_combo, 0), p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score),
            COALESCE(p_ws_level, 1), v_completion_rate,
            CASE WHEN p_ws_is_perfect_clear THEN 1 ELSE 0 END,
            CASE WHEN COALESCE(p_time_limit_seconds, 0) > 0
                 THEN (COALESCE(p_time_limit_seconds, 0) - COALESCE(p_time_remaining_seconds, 0))::REAL / p_time_limit_seconds
                 ELSE 0 END,
            COALESCE(p_bonus_words_completed, 0),
            COALESCE(p_bonus_words_completed, 0),
            COALESCE(p_ws_placed_words, 0),
            CASE WHEN p_ws_is_perfect_clear THEN p_ws_clear_seconds ELSE NULL END,
            p_xp_earned, p_coins_earned, NOW()
        )
        ON CONFLICT (profile_id) DO UPDATE SET
            games_played    = challenge_word_search_stats.games_played + 1,
            high_score      = GREATEST(challenge_word_search_stats.high_score, p_score),
            total_score     = challenge_word_search_stats.total_score + p_score,
            total_words     = challenge_word_search_stats.total_words + p_words_found,
            avg_score       = (challenge_word_search_stats.total_score + p_score)::REAL / (challenge_word_search_stats.games_played + 1),
            best_combo      = GREATEST(challenge_word_search_stats.best_combo, COALESCE(p_best_combo, 0)),
            sum_score_squared = challenge_word_search_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_word_search_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_word_search_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_word_search_stats.games_played + 1))
                     - POWER((challenge_word_search_stats.total_score + p_score)::REAL / (challenge_word_search_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_word_search_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            highest_level_reached = GREATEST(challenge_word_search_stats.highest_level_reached, COALESCE(p_ws_level, 1)),
            avg_completion_rate = (challenge_word_search_stats.avg_completion_rate * challenge_word_search_stats.games_played + v_completion_rate) / (challenge_word_search_stats.games_played + 1),
            perfect_clears  = challenge_word_search_stats.perfect_clears + CASE WHEN p_ws_is_perfect_clear THEN 1 ELSE 0 END,
            avg_time_efficiency = CASE WHEN COALESCE(p_time_limit_seconds, 0) > 0
                THEN (challenge_word_search_stats.avg_time_efficiency * challenge_word_search_stats.games_played
                      + (COALESCE(p_time_limit_seconds, 0) - COALESCE(p_time_remaining_seconds, 0))::REAL / p_time_limit_seconds)
                     / (challenge_word_search_stats.games_played + 1)
                ELSE challenge_word_search_stats.avg_time_efficiency END,
            total_bonus_words = challenge_word_search_stats.total_bonus_words + COALESCE(p_bonus_words_completed, 0),
            best_bonus_words_single = GREATEST(challenge_word_search_stats.best_bonus_words_single, COALESCE(p_bonus_words_completed, 0)),
            total_placed_words = challenge_word_search_stats.total_placed_words + COALESCE(p_ws_placed_words, 0),
            fastest_clear_seconds = CASE
                WHEN p_ws_is_perfect_clear AND p_ws_clear_seconds IS NOT NULL
                THEN LEAST(COALESCE(challenge_word_search_stats.fastest_clear_seconds, p_ws_clear_seconds), p_ws_clear_seconds)
                ELSE challenge_word_search_stats.fastest_clear_seconds END,
            total_xp_earned = challenge_word_search_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_word_search_stats.total_coins_earned + p_coins_earned,
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF p_is_challenge AND p_challenge_type = 'word-runner' THEN
        INSERT INTO challenge_word_runner_stats (
            profile_id, games_played, high_score, total_score, total_words,
            avg_score, best_combo, sum_score_squared, score_variance,
            recent_scores, best_distance,
            total_xp_earned, total_coins_earned, last_played_at
        ) VALUES (
            p_profile_id, 1, p_score, p_score, p_words_found,
            p_score, p_best_combo, p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score), p_score,
            p_xp_earned, p_coins_earned, NOW()
        )
        ON CONFLICT (profile_id) DO UPDATE SET
            games_played    = challenge_word_runner_stats.games_played + 1,
            high_score      = GREATEST(challenge_word_runner_stats.high_score, p_score),
            total_score     = challenge_word_runner_stats.total_score + p_score,
            total_words     = challenge_word_runner_stats.total_words + p_words_found,
            avg_score       = (challenge_word_runner_stats.total_score + p_score)::REAL / (challenge_word_runner_stats.games_played + 1),
            best_combo      = GREATEST(challenge_word_runner_stats.best_combo, p_best_combo),
            sum_score_squared = challenge_word_runner_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN challenge_word_runner_stats.games_played + 1 > 1
                THEN GREATEST(0, ((challenge_word_runner_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (challenge_word_runner_stats.games_played + 1))
                     - POWER((challenge_word_runner_stats.total_score + p_score)::REAL / (challenge_word_runner_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || challenge_word_runner_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            best_distance   = GREATEST(challenge_word_runner_stats.best_distance, p_score),
            total_xp_earned = challenge_word_runner_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = challenge_word_runner_stats.total_coins_earned + p_coins_earned,
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF NOT p_is_challenge AND (p_time_limit_seconds IS NULL OR p_time_limit_seconds = 0) THEN
        -- SANDBOX
        INSERT INTO sandbox_grid_stats (
            profile_id, grid_size, difficulty,
            games_played, high_score, total_score, total_words, avg_score,
            best_combo, best_longest_word, sum_score_squared, score_variance,
            recent_scores, total_xp_earned, total_coins_earned, last_played_at
        ) VALUES (
            p_profile_id, COALESCE(p_grid_size, 5), COALESCE(p_difficulty, 'casual'),
            1, p_score, p_score, p_words_found, p_score, p_best_combo,
            p_longest_word_length, p_score::BIGINT * p_score, 0,
            jsonb_build_array(p_score), p_xp_earned, p_coins_earned, NOW()
        )
        ON CONFLICT (profile_id, grid_size, difficulty) DO UPDATE SET
            games_played    = sandbox_grid_stats.games_played + 1,
            high_score      = GREATEST(sandbox_grid_stats.high_score, p_score),
            total_score     = sandbox_grid_stats.total_score + p_score,
            total_words     = sandbox_grid_stats.total_words + p_words_found,
            avg_score       = (sandbox_grid_stats.total_score + p_score)::REAL / (sandbox_grid_stats.games_played + 1),
            best_combo      = GREATEST(sandbox_grid_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(sandbox_grid_stats.best_longest_word, p_longest_word_length),
            sum_score_squared = sandbox_grid_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN sandbox_grid_stats.games_played + 1 > 1
                THEN GREATEST(0, ((sandbox_grid_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (sandbox_grid_stats.games_played + 1))
                     - POWER((sandbox_grid_stats.total_score + p_score)::REAL / (sandbox_grid_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || sandbox_grid_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            total_xp_earned = sandbox_grid_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = sandbox_grid_stats.total_coins_earned + p_coins_earned,
            last_played_at  = NOW(),
            updated_at      = NOW();

    ELSIF NOT p_is_challenge AND p_time_limit_seconds IS NOT NULL AND p_time_limit_seconds > 0 THEN
        -- TIMED
        v_time_limit_min := ROUND(p_time_limit_seconds / 60.0)::INTEGER;
        INSERT INTO timed_grid_stats (
            profile_id, time_limit_minutes, grid_size, difficulty,
            games_played, high_score, total_score, total_words, avg_score,
            best_combo, best_longest_word, best_time_remaining,
            sum_score_squared, score_variance, recent_scores,
            total_xp_earned, total_coins_earned, last_played_at
        ) VALUES (
            p_profile_id, v_time_limit_min, COALESCE(p_grid_size, 5),
            COALESCE(p_difficulty, 'casual'),
            1, p_score, p_score, p_words_found, p_score, p_best_combo,
            p_longest_word_length, COALESCE(p_time_remaining_seconds, 0),
            p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
            p_xp_earned, p_coins_earned, NOW()
        )
        ON CONFLICT (profile_id, time_limit_minutes, grid_size, difficulty) DO UPDATE SET
            games_played    = timed_grid_stats.games_played + 1,
            high_score      = GREATEST(timed_grid_stats.high_score, p_score),
            total_score     = timed_grid_stats.total_score + p_score,
            total_words     = timed_grid_stats.total_words + p_words_found,
            avg_score       = (timed_grid_stats.total_score + p_score)::REAL / (timed_grid_stats.games_played + 1),
            best_combo      = GREATEST(timed_grid_stats.best_combo, p_best_combo),
            best_longest_word = GREATEST(timed_grid_stats.best_longest_word, p_longest_word_length),
            best_time_remaining = GREATEST(timed_grid_stats.best_time_remaining, COALESCE(p_time_remaining_seconds, 0)),
            sum_score_squared = timed_grid_stats.sum_score_squared + p_score::BIGINT * p_score,
            score_variance  = CASE WHEN timed_grid_stats.games_played + 1 > 1
                THEN GREATEST(0, ((timed_grid_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (timed_grid_stats.games_played + 1))
                     - POWER((timed_grid_stats.total_score + p_score)::REAL / (timed_grid_stats.games_played + 1), 2))
                ELSE 0 END,
            recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
                SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || timed_grid_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
                WHERE idx <= 30) sub),
            total_xp_earned = timed_grid_stats.total_xp_earned + p_xp_earned,
            total_coins_earned = timed_grid_stats.total_coins_earned + p_coins_earned,
            last_played_at  = NOW(),
            updated_at      = NOW();
    END IF;

    -- ════════════════════════════════════════════════════════════════
    -- C. UPSERT profile_game_stats (global per-profile aggregate)
    -- ════════════════════════════════════════════════════════════════
    INSERT INTO profile_game_stats (
        profile_id, games_played, high_score, total_score, total_words,
        avg_score, best_combo, best_longest_word, sum_score_squared,
        score_variance, recent_scores, total_xp_earned, total_coins_earned,
        last_played_at
    ) VALUES (
        p_profile_id, 1, p_score, p_score, p_words_found,
        p_score, p_best_combo, p_longest_word_length,
        p_score::BIGINT * p_score, 0, jsonb_build_array(p_score),
        p_xp_earned, p_coins_earned, NOW()
    )
    ON CONFLICT (profile_id) DO UPDATE SET
        games_played    = profile_game_stats.games_played + 1,
        high_score      = GREATEST(profile_game_stats.high_score, p_score),
        total_score     = profile_game_stats.total_score + p_score,
        total_words     = profile_game_stats.total_words + p_words_found,
        avg_score       = (profile_game_stats.total_score + p_score)::REAL / (profile_game_stats.games_played + 1),
        best_combo      = GREATEST(profile_game_stats.best_combo, p_best_combo),
        best_longest_word = GREATEST(profile_game_stats.best_longest_word, p_longest_word_length),
        sum_score_squared = profile_game_stats.sum_score_squared + p_score::BIGINT * p_score,
        score_variance  = CASE WHEN profile_game_stats.games_played + 1 > 1
            THEN GREATEST(0, ((profile_game_stats.sum_score_squared + p_score::BIGINT * p_score)::REAL / (profile_game_stats.games_played + 1))
                 - POWER((profile_game_stats.total_score + p_score)::REAL / (profile_game_stats.games_played + 1), 2))
            ELSE 0 END,
        recent_scores   = (SELECT COALESCE(jsonb_agg(elem), '[]') FROM (
            SELECT elem FROM jsonb_array_elements(jsonb_build_array(p_score) || profile_game_stats.recent_scores) WITH ORDINALITY AS t(elem, idx)
            WHERE idx <= 30) sub),
        total_xp_earned = profile_game_stats.total_xp_earned + p_xp_earned,
        total_coins_earned = profile_game_stats.total_coins_earned + p_coins_earned,
        last_played_at  = NOW(),
        updated_at      = NOW();

    -- Check if new high score
    SELECT (p_score >= pgs.high_score) INTO v_is_new_high
    FROM profile_game_stats pgs WHERE pgs.profile_id = p_profile_id;

    -- ════════════════════════════════════════════════════════════════
    -- D. Keep profiles in sync (for MVs + old compute functions)
    -- ════════════════════════════════════════════════════════════════
    UPDATE profiles SET
        games_played = profiles.games_played + 1,
        high_score = GREATEST(profiles.high_score, p_score),
        total_words = profiles.total_words + p_words_found,
        updated_at = NOW()
    WHERE id = p_profile_id;

    -- ════════════════════════════════════════════════════════════════
    -- E. Recompute rankings (old compute functions still work)
    -- ════════════════════════════════════════════════════════════════
    BEGIN
        PERFORM update_ranking_for_account(v_account_id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'record_game: ranking update failed for %: %', v_account_id, SQLERRM;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'games_played', (SELECT pgs.games_played FROM profile_game_stats pgs WHERE pgs.profile_id = p_profile_id),
        'high_score', (SELECT pgs.high_score FROM profile_game_stats pgs WHERE pgs.profile_id = p_profile_id),
        'total_words', (SELECT pgs.total_words FROM profile_game_stats pgs WHERE pgs.profile_id = p_profile_id),
        'is_new_high_score', COALESCE(v_is_new_high, false)
    );

EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'record_game failed for profile %: %', p_profile_id, SQLERRM;
    RETURN jsonb_build_object('success', false, 'error', 'internal_error');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 9: Analytics RPCs (read from new aggregate tables)               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION get_challenge_analysis_data(
    p_profile_id UUID,
    p_challenge_type TEXT
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_cl RECORD;
    v_games INTEGER := 0;
    v_high_score INTEGER := 0;
    v_total_words INTEGER := 0;
    v_avg_score REAL := 0;
    v_score_variance REAL := 0;
    v_best_combo INTEGER := 0;
    v_avg_words REAL := 0;
    v_recent_scores JSONB := '[]';
    v_recent_trend REAL := 0;
    v_total_score BIGINT := 0;
BEGIN
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

    IF p_challenge_type = 'target-word' THEN
        SELECT
            COALESCE(SUM(t.games_played), 0),
            COALESCE(MAX(t.high_score), 0),
            COALESCE(SUM(t.total_words), 0),
            CASE WHEN SUM(t.games_played) > 0
                 THEN SUM(t.total_score)::REAL / SUM(t.games_played) ELSE 0 END,
            COALESCE(MAX(t.best_combo), 0),
            CASE WHEN SUM(t.games_played) > 0
                 THEN SUM(t.total_words)::REAL / SUM(t.games_played) ELSE 0 END,
            COALESCE(SUM(t.total_score), 0)
        INTO v_games, v_high_score, v_total_words, v_avg_score,
             v_best_combo, v_avg_words, v_total_score
        FROM challenge_target_word_stats t WHERE t.profile_id = p_profile_id;

        SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]') INTO v_recent_scores
        FROM (
            SELECT elem, ROW_NUMBER() OVER () AS ord
            FROM challenge_target_word_stats t,
                 jsonb_array_elements(t.recent_scores) WITH ORDINALITY AS arr(elem, pos)
            WHERE t.profile_id = p_profile_id
            ORDER BY pos LIMIT 20
        ) sub;

    ELSIF p_challenge_type = 'speed-round' THEN
        SELECT
            COALESCE(SUM(t.games_played), 0),
            COALESCE(MAX(t.high_score), 0),
            COALESCE(SUM(t.total_words), 0),
            CASE WHEN SUM(t.games_played) > 0
                 THEN SUM(t.total_score)::REAL / SUM(t.games_played) ELSE 0 END,
            COALESCE(MAX(t.best_combo), 0),
            CASE WHEN SUM(t.games_played) > 0
                 THEN SUM(t.total_words)::REAL / SUM(t.games_played) ELSE 0 END,
            COALESCE(SUM(t.total_score), 0)
        INTO v_games, v_high_score, v_total_words, v_avg_score,
             v_best_combo, v_avg_words, v_total_score
        FROM challenge_speed_round_stats t WHERE t.profile_id = p_profile_id;

        SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]') INTO v_recent_scores
        FROM (
            SELECT elem, ROW_NUMBER() OVER () AS ord
            FROM challenge_speed_round_stats t,
                 jsonb_array_elements(t.recent_scores) WITH ORDINALITY AS arr(elem, pos)
            WHERE t.profile_id = p_profile_id
            ORDER BY pos LIMIT 20
        ) sub;

    ELSIF p_challenge_type = 'word-category' THEN
        SELECT
            COALESCE(SUM(t.games_played), 0),
            COALESCE(MAX(t.high_score), 0),
            COALESCE(SUM(t.total_words), 0),
            CASE WHEN SUM(t.games_played) > 0
                 THEN SUM(t.total_score)::REAL / SUM(t.games_played) ELSE 0 END,
            COALESCE(MAX(t.best_combo), 0),
            CASE WHEN SUM(t.games_played) > 0
                 THEN SUM(t.total_words)::REAL / SUM(t.games_played) ELSE 0 END,
            COALESCE(SUM(t.total_score), 0)
        INTO v_games, v_high_score, v_total_words, v_avg_score,
             v_best_combo, v_avg_words, v_total_score
        FROM challenge_word_category_stats t WHERE t.profile_id = p_profile_id;

        SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]') INTO v_recent_scores
        FROM (
            SELECT elem, ROW_NUMBER() OVER () AS ord
            FROM challenge_word_category_stats t,
                 jsonb_array_elements(t.recent_scores) WITH ORDINALITY AS arr(elem, pos)
            WHERE t.profile_id = p_profile_id
            ORDER BY pos LIMIT 20
        ) sub;

    ELSIF p_challenge_type = 'word-search' THEN
        SELECT
            t.games_played, t.high_score, t.total_words,
            t.avg_score, t.best_combo,
            CASE WHEN t.games_played > 0 THEN t.total_words::REAL / t.games_played ELSE 0 END,
            t.total_score, t.recent_scores
        INTO v_games, v_high_score, v_total_words, v_avg_score,
             v_best_combo, v_avg_words, v_total_score, v_recent_scores
        FROM challenge_word_search_stats t WHERE t.profile_id = p_profile_id;

    ELSIF p_challenge_type = 'word-runner' THEN
        SELECT
            t.games_played, t.high_score, t.total_words,
            t.avg_score, t.best_combo,
            CASE WHEN t.games_played > 0 THEN t.total_words::REAL / t.games_played ELSE 0 END,
            t.total_score, t.recent_scores
        INTO v_games, v_high_score, v_total_words, v_avg_score,
             v_best_combo, v_avg_words, v_total_score, v_recent_scores
        FROM challenge_word_runner_stats t WHERE t.profile_id = p_profile_id;
    END IF;

    v_games := COALESCE(v_games, 0);
    v_high_score := COALESCE(v_high_score, 0);
    v_total_words := COALESCE(v_total_words, 0);
    v_avg_score := COALESCE(v_avg_score, 0);
    v_best_combo := COALESCE(v_best_combo, 0);
    v_avg_words := COALESCE(v_avg_words, 0);
    v_recent_scores := COALESCE(v_recent_scores, '[]');

    -- Score consistency from variance
    v_score_variance := CASE
        WHEN v_avg_score > 0 THEN
            ROUND((1 - LEAST(1, SQRT(COALESCE(
                (SELECT SUM(t.score_variance * t.games_played) / NULLIF(SUM(t.games_played), 0)
                 FROM (
                    SELECT score_variance, games_played FROM challenge_target_word_stats WHERE profile_id = p_profile_id AND p_challenge_type = 'target-word'
                    UNION ALL SELECT score_variance, games_played FROM challenge_speed_round_stats WHERE profile_id = p_profile_id AND p_challenge_type = 'speed-round'
                    UNION ALL SELECT score_variance, games_played FROM challenge_word_category_stats WHERE profile_id = p_profile_id AND p_challenge_type = 'word-category'
                    UNION ALL SELECT score_variance, games_played FROM challenge_word_search_stats WHERE profile_id = p_profile_id AND p_challenge_type = 'word-search'
                    UNION ALL SELECT score_variance, games_played FROM challenge_word_runner_stats WHERE profile_id = p_profile_id AND p_challenge_type = 'word-runner'
                 ) t
                ), 0)) / GREATEST(v_avg_score, 1)))::NUMERIC, 2)
        ELSE 0
    END;

    v_recent_trend := COALESCE((
        SELECT ROUND((
            (SELECT AVG(val::REAL) FROM (SELECT val FROM jsonb_array_elements(v_recent_scores) AS val LIMIT 5) r)
            -
            COALESCE((SELECT AVG(val::REAL) FROM (SELECT val FROM jsonb_array_elements(v_recent_scores) AS val LIMIT 5 OFFSET 5) o), 0)
        )::NUMERIC, 1)
    ), 0);

    result := jsonb_build_object(
        'username', v_profile.username,
        'level', v_profile.level,
        'challenge_type', p_challenge_type,
        'skill_rating', COALESCE(v_cl.challenge_skill_rating, 0),
        'skill_class', COALESCE(v_cl.skill_class, 'low'),
        'global_rank', COALESCE(v_cl.global_rank, 0),
        'high_score', v_high_score,
        'games_played', v_games,
        'total_words', v_total_words,
        'avg_score', ROUND(v_avg_score::NUMERIC, 1),
        'score_consistency', v_score_variance,
        'best_combo', v_best_combo,
        'avg_words_per_game', ROUND(v_avg_words::NUMERIC, 1),
        'recent_trend', v_recent_trend,
        'recent_scores', v_recent_scores
    );

    IF p_challenge_type = 'target-word' THEN
        result := result || jsonb_build_object(
            'target_word_level', COALESCE((SELECT 1 + SUM(t.total_targets_completed) FROM challenge_target_word_stats t WHERE t.profile_id = p_profile_id), 1),
            'avg_targets_per_game', COALESCE((
                SELECT ROUND((SUM(t.total_targets_completed)::REAL / NULLIF(SUM(t.games_played), 0))::NUMERIC, 1)
                FROM challenge_target_word_stats t WHERE t.profile_id = p_profile_id
            ), 0),
            'best_targets_in_game', COALESCE((SELECT MAX(t.best_targets_in_game) FROM challenge_target_word_stats t WHERE t.profile_id = p_profile_id), 0)
        );
    ELSIF p_challenge_type = 'speed-round' THEN
        result := result || jsonb_build_object(
            'avg_words_per_minute', COALESCE((
                SELECT ROUND((SUM(t.total_words)::REAL / GREATEST(1, SUM(t.total_time_used_seconds)) * 60)::NUMERIC, 2)
                FROM challenge_speed_round_stats t WHERE t.profile_id = p_profile_id
            ), 0),
            'best_words_in_game', COALESCE((SELECT MAX(t.best_words_in_game) FROM challenge_speed_round_stats t WHERE t.profile_id = p_profile_id), 0)
        );
    ELSIF p_challenge_type = 'word-category' THEN
        result := result || jsonb_build_object(
            'avg_category_words', COALESCE((
                SELECT ROUND((SUM(t.total_category_words)::REAL / NULLIF(SUM(t.games_played), 0))::NUMERIC, 1)
                FROM challenge_word_category_stats t WHERE t.profile_id = p_profile_id
            ), 0),
            'best_category_words', COALESCE((SELECT MAX(t.best_category_words_per_game) FROM challenge_word_category_stats t WHERE t.profile_id = p_profile_id), 0)
        );
    ELSIF p_challenge_type = 'word-runner' THEN
        result := result || jsonb_build_object(
            'avg_distance', ROUND(v_avg_score::NUMERIC, 1),
            'best_distance', COALESCE((SELECT t.best_distance FROM challenge_word_runner_stats t WHERE t.profile_id = p_profile_id), 0)
        );
    ELSIF p_challenge_type = 'word-search' THEN
        result := result || jsonb_build_object(
            'word_search', (
                SELECT jsonb_build_object(
                    'games_played', t.games_played,
                    'avg_completion_rate', t.avg_completion_rate,
                    'perfect_clear_rate', CASE WHEN t.games_played > 0
                        THEN ROUND((t.perfect_clears::REAL / t.games_played)::NUMERIC, 3) ELSE 0 END,
                    'avg_time_efficiency', t.avg_time_efficiency,
                    'highest_level', t.highest_level_reached,
                    'total_bonus_words', t.total_bonus_words
                )
                FROM challenge_word_search_stats t WHERE t.profile_id = p_profile_id
            )
        );
    END IF;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ── get_player_analysis_data reads from profile_game_stats ──
CREATE OR REPLACE FUNCTION get_player_analysis_data(p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_pgs RECORD;
    v_skill RECORD;
    v_class TEXT;
    v_total_in_class INTEGER;
    v_percentiles JSONB;
    v_class_avgs JSONB;
    v_delta JSONB;
    v_notables JSONB;
    v_recent JSONB;
    v_recent_avg REAL;
    v_older_avg REAL;
    v_recent_high INTEGER;
    v_all_time_high INTEGER;
    v_streak INTEGER := 0;
    v_improving BOOLEAN := FALSE;
    v_new_pb BOOLEAN := FALSE;
    v_total_games INTEGER;
    v_next_milestone INTEGER;
    v_games_to_milestone INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM leaderboard_rankings WHERE profile_id = p_profile_id
    ) AND NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = p_profile_id AND account_id = auth.uid()
    ) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_profile FROM profiles WHERE id = p_profile_id;
    IF v_profile IS NULL THEN RETURN NULL; END IF;

    SELECT * INTO v_pgs FROM profile_game_stats WHERE profile_id = p_profile_id;

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

    v_recent := COALESCE(v_pgs.recent_scores, '[]');
    v_total_games := COALESCE(v_pgs.games_played, v_profile.games_played);

    SELECT COALESCE(AVG(val::TEXT::REAL), 0) INTO v_recent_avg
    FROM (SELECT val FROM jsonb_array_elements(v_recent) AS val LIMIT 10) sub;

    SELECT COALESCE(AVG(val::TEXT::REAL), 0) INTO v_older_avg
    FROM (SELECT val FROM jsonb_array_elements(v_recent) AS val LIMIT 20 OFFSET 10) sub;

    v_delta := jsonb_build_object(
        'score_change_pct', CASE WHEN v_older_avg > 0 THEN ROUND(((v_recent_avg - v_older_avg) / v_older_avg * 100)::NUMERIC, 1) ELSE 0 END,
        'words_change_pct', 0,
        'recent_avg', ROUND(v_recent_avg::NUMERIC, 1),
        'older_avg', ROUND(v_older_avg::NUMERIC, 1)
    );

    v_all_time_high := COALESCE(v_pgs.high_score, v_profile.high_score);
    SELECT COALESCE(MAX(val::TEXT::INTEGER), 0) INTO v_recent_high
    FROM (SELECT val FROM jsonb_array_elements(v_recent) AS val LIMIT 5) sub;
    v_new_pb := (v_recent_high >= v_all_time_high AND v_total_games > 5);

    SELECT COUNT(*) INTO v_streak
    FROM (
        SELECT val::TEXT::INTEGER AS score,
               LAG(val::TEXT::INTEGER) OVER (ORDER BY ord) AS prev_score
        FROM jsonb_array_elements(v_recent) WITH ORDINALITY AS t(val, ord)
        WHERE ord <= 6
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
        'games_played', v_total_games,
        'high_score', COALESCE(v_pgs.high_score, v_profile.high_score),
        'total_words', COALESCE(v_pgs.total_words, v_profile.total_words),
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 10: Inventory & Milestone helper RPCs                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION add_inventory_item(p_profile_id UUID, p_item_id TEXT, p_cost INTEGER DEFAULT 0)
RETURNS JSONB AS $$
DECLARE
    v_account_id UUID;
    v_coins INTEGER;
BEGIN
    SELECT account_id INTO v_account_id FROM profiles WHERE id = p_profile_id;
    IF v_account_id IS NULL OR v_account_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
    END IF;
    -- Verify the player can afford the item
    IF COALESCE(p_cost, 0) > 0 THEN
        SELECT coins INTO v_coins FROM profiles WHERE id = p_profile_id;
        IF v_coins < p_cost THEN
            RETURN jsonb_build_object('success', false, 'error', 'insufficient_coins');
        END IF;
        UPDATE profiles SET coins = coins - p_cost, updated_at = NOW() WHERE id = p_profile_id;
    END IF;
    INSERT INTO profile_inventory (profile_id, items, updated_at)
    VALUES (p_profile_id, jsonb_build_array(jsonb_build_object('item_id', p_item_id, 'purchased_at', NOW())), NOW())
    ON CONFLICT (profile_id) DO UPDATE SET
        items = CASE
            WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(profile_inventory.items) AS elem WHERE elem->>'item_id' = p_item_id)
            THEN profile_inventory.items || jsonb_build_array(jsonb_build_object('item_id', p_item_id, 'purchased_at', NOW()))
            ELSE profile_inventory.items END,
        updated_at = NOW();
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION record_milestone(p_profile_id UUID, p_milestone_id TEXT, p_coins_awarded INTEGER DEFAULT 0)
RETURNS JSONB AS $$
DECLARE v_account_id UUID;
DECLARE v_safe_coins INTEGER;
BEGIN
    SELECT account_id INTO v_account_id FROM profiles WHERE id = p_profile_id;
    IF v_account_id IS NULL OR v_account_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
    END IF;
    -- Clamp coins to prevent inflation (max 5000 per milestone)
    v_safe_coins := LEAST(GREATEST(COALESCE(p_coins_awarded, 0), 0), 5000);
    INSERT INTO profile_milestones (profile_id, milestones, updated_at)
    VALUES (p_profile_id, jsonb_build_array(jsonb_build_object('id', p_milestone_id, 'earned_at', NOW(), 'coins_awarded', v_safe_coins)), NOW())
    ON CONFLICT (profile_id) DO UPDATE SET
        milestones = CASE
            WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(profile_milestones.milestones) AS elem WHERE elem->>'id' = p_milestone_id)
            THEN profile_milestones.milestones || jsonb_build_array(jsonb_build_object('id', p_milestone_id, 'earned_at', NOW(), 'coins_awarded', v_safe_coins))
            ELSE profile_milestones.milestones END,
        updated_at = NOW();
    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_inventory(p_profile_id UUID)
RETURNS JSONB AS $$
BEGIN
    -- Verify profile belongs to caller
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile_id AND account_id = auth.uid()) THEN
        RETURN '[]'::JSONB;
    END IF;
    RETURN COALESCE(
        (SELECT jsonb_agg(elem->>'item_id')
         FROM profile_inventory pi, jsonb_array_elements(pi.items) AS elem
         WHERE pi.profile_id = p_profile_id), '[]');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_milestones(p_profile_id UUID)
RETURNS JSONB AS $$
BEGIN
    -- Verify profile belongs to caller
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_profile_id AND account_id = auth.uid()) THEN
        RETURN '[]'::JSONB;
    END IF;
    RETURN COALESCE(
        (SELECT milestones FROM profile_milestones WHERE profile_id = p_profile_id), '[]');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DONE — Migration 021 Summary                                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- CREATED: 8 aggregate tables + 2 JSONB tables (inventory/milestones)
-- PRESERVED: game_scores event log + all old stat tables (untouched)
-- TRIGGERS: Dropped 2 (auto_ranking, MV refresh). Kept 5 stat triggers.
-- record_game: Inserts game_scores + upserts aggregate tables
-- Analytics: get_challenge_analysis_data + get_player_analysis_data rewritten
--
-- game_history + skill_rating columns exist but are empty (defaults).
-- Migration 022 will populate them and rewrite skill functions.
--
-- Client code: Update TIMED_MODE_OPTIONS_MINUTES to [1,3,5,8,10,15,20]
