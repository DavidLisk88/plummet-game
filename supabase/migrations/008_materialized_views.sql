-- ============================================================
-- PLUMMET — Materialized Views for Pre-Computed Stats
-- Migration 008: Performance Optimization via Materialized Views
-- ============================================================
--
-- PURPOSE:
--   Pre-compute expensive aggregation queries that power leaderboards,
--   player statistics, and analytics dashboards. Materialized views
--   are refreshed periodically (via cron or after game completion)
--   instead of re-computing on every page load.
--
-- VIEWS CREATED:
--   1. mv_global_leaderboard — Top players ranked by composite skill
--   2. mv_challenge_rankings — Per-challenge-type leaderboards
--   3. mv_daily_active_stats — Daily active player metrics
--   4. mv_player_summary    — Per-profile aggregated game stats
--   5. mv_word_frequency     — Most commonly found words across all players
--
-- REFRESH STRATEGY:
--   - After each game_scores INSERT (via trigger, debounced)
--   - Periodic cron refresh every 5 minutes for global views
--   - On-demand via RPC function refresh_materialized_views()
--
-- ============================================================

-- ────────────────────────────────────────
-- 1. GLOBAL LEADERBOARD (top players by composite skill)
-- ────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_global_leaderboard AS
SELECT
    lr.profile_id,
    p.username,
    p.account_id,
    p.level,
    p.games_played,
    p.high_score,
    p.total_xp,
    lr.skill_rating,
    lr.skill_class,
    -- Composite rank score: skill rating weighted by activity
    lr.skill_rating * LEAST(1.0, p.games_played::REAL / 20.0) AS weighted_skill,
    -- Recent activity factor (games in last 30 days)
    COALESCE(recent.games_30d, 0) AS games_30d,
    COALESCE(recent.avg_score_30d, 0) AS avg_score_30d,
    -- Rank within each skill class
    RANK() OVER (PARTITION BY lr.skill_class ORDER BY lr.skill_rating DESC) AS class_rank,
    -- Global rank
    RANK() OVER (ORDER BY lr.skill_rating * LEAST(1.0, p.games_played::REAL / 20.0) DESC) AS global_rank
FROM leaderboard_rankings lr
JOIN profiles p ON p.id = lr.profile_id
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS games_30d,
        AVG(score) AS avg_score_30d
    FROM game_scores gs
    WHERE gs.profile_id = lr.profile_id
      AND gs.played_at >= NOW() - INTERVAL '30 days'
) recent ON TRUE
WHERE p.games_played >= 5
  AND NOT EXISTS (
    SELECT 1 FROM accounts a WHERE a.id = p.account_id AND a.is_banned = TRUE
  )
ORDER BY weighted_skill DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_global_lb_profile
    ON mv_global_leaderboard (profile_id);
CREATE INDEX IF NOT EXISTS idx_mv_global_lb_rank
    ON mv_global_leaderboard (global_rank);
CREATE INDEX IF NOT EXISTS idx_mv_global_lb_class
    ON mv_global_leaderboard (skill_class, class_rank);

-- ────────────────────────────────────────
-- 2. CHALLENGE RANKINGS (per challenge type)
-- ────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_challenge_rankings AS
SELECT
    gs.challenge_type,
    gs.profile_id,
    p.username,
    MAX(gs.score) AS high_score,
    COUNT(*) AS games_played,
    AVG(gs.score) AS avg_score,
    MAX(gs.words_found) AS best_words,
    MAX(gs.best_combo) AS best_combo,
    MAX(gs.target_words_completed) AS best_target_words,
    -- Word search specific
    MAX(gs.grid_size) AS max_grid_conquered,
    -- Consistency: std dev of scores (lower = more consistent)
    CASE WHEN COUNT(*) >= 3 THEN STDDEV_SAMP(gs.score) ELSE NULL END AS score_stddev,
    -- Rank within challenge type
    RANK() OVER (
        PARTITION BY gs.challenge_type
        ORDER BY MAX(gs.score) DESC
    ) AS challenge_rank
FROM game_scores gs
JOIN profiles p ON p.id = gs.profile_id
WHERE gs.is_challenge = TRUE
  AND gs.challenge_type IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounts a
    JOIN profiles p2 ON p2.account_id = a.id
    WHERE p2.id = gs.profile_id AND a.is_banned = TRUE
  )
GROUP BY gs.challenge_type, gs.profile_id, p.username
HAVING COUNT(*) >= 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_challenge_rank_pk
    ON mv_challenge_rankings (challenge_type, profile_id);
CREATE INDEX IF NOT EXISTS idx_mv_challenge_rank_type
    ON mv_challenge_rankings (challenge_type, challenge_rank);

-- ────────────────────────────────────────
-- 3. DAILY ACTIVE STATS (analytics dashboard)
-- ────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_active_stats AS
SELECT
    DATE(gs.played_at) AS play_date,
    COUNT(DISTINCT gs.profile_id) AS unique_players,
    COUNT(*) AS total_games,
    AVG(gs.score) AS avg_score,
    MAX(gs.score) AS top_score,
    AVG(gs.words_found) AS avg_words,
    -- Game mode breakdown
    COUNT(*) FILTER (WHERE gs.game_mode = 'sandbox' AND NOT gs.is_challenge) AS sandbox_games,
    COUNT(*) FILTER (WHERE gs.game_mode = 'timed' AND NOT gs.is_challenge) AS timed_games,
    COUNT(*) FILTER (WHERE gs.is_challenge) AS challenge_games,
    -- Challenge type breakdown
    COUNT(*) FILTER (WHERE gs.challenge_type = 'target-word') AS target_word_games,
    COUNT(*) FILTER (WHERE gs.challenge_type = 'speed-round') AS speed_round_games,
    COUNT(*) FILTER (WHERE gs.challenge_type = 'word-category') AS word_category_games,
    COUNT(*) FILTER (WHERE gs.challenge_type = 'word-search') AS word_search_games,
    COUNT(*) FILTER (WHERE gs.challenge_type = 'word-runner') AS word_runner_games,
    -- XP and coins
    SUM(gs.xp_earned) AS total_xp_awarded,
    SUM(gs.coins_earned) AS total_coins_awarded,
    -- Grid size distribution
    AVG(gs.grid_size) AS avg_grid_size
FROM game_scores gs
GROUP BY DATE(gs.played_at)
ORDER BY play_date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_stats_date
    ON mv_daily_active_stats (play_date);

-- ────────────────────────────────────────
-- 4. PLAYER SUMMARY (per-profile aggregated stats)
-- ────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_player_summary AS
SELECT
    gs.profile_id,
    p.username,
    p.level,
    p.total_xp,
    p.coins,
    -- Overall stats
    COUNT(*) AS total_games,
    MAX(gs.score) AS all_time_high,
    AVG(gs.score)::INTEGER AS avg_score,
    SUM(gs.words_found) AS total_words_found,
    MAX(gs.best_combo) AS best_combo_ever,
    MAX(gs.longest_word_length) AS longest_word_ever,
    -- Recent performance (last 10 games)
    (SELECT AVG(sub.score)::INTEGER
     FROM (SELECT score FROM game_scores WHERE profile_id = gs.profile_id
           ORDER BY played_at DESC LIMIT 10) sub
    ) AS recent_avg_score,
    -- Trending: compare recent 10 games vs previous 10
    (SELECT AVG(sub.score)::INTEGER
     FROM (SELECT score FROM game_scores WHERE profile_id = gs.profile_id
           ORDER BY played_at DESC LIMIT 10) sub
    ) - (SELECT COALESCE(AVG(sub2.score)::INTEGER, 0)
     FROM (SELECT score FROM game_scores WHERE profile_id = gs.profile_id
           ORDER BY played_at DESC OFFSET 10 LIMIT 10) sub2
    ) AS score_trend,
    -- Favorite game mode
    MODE() WITHIN GROUP (ORDER BY gs.game_mode) AS favorite_mode,
    -- Favorite grid size
    MODE() WITHIN GROUP (ORDER BY gs.grid_size) AS favorite_grid,
    -- Challenge participation
    COUNT(*) FILTER (WHERE gs.is_challenge) AS challenge_games,
    -- First and last game timestamps
    MIN(gs.played_at) AS first_game_at,
    MAX(gs.played_at) AS last_game_at,
    -- Streak estimate: consecutive days with games in last 30 days
    (SELECT COUNT(DISTINCT DATE(sub.played_at))
     FROM game_scores sub
     WHERE sub.profile_id = gs.profile_id
       AND sub.played_at >= NOW() - INTERVAL '30 days'
    ) AS active_days_30d
FROM game_scores gs
JOIN profiles p ON p.id = gs.profile_id
GROUP BY gs.profile_id, p.username, p.level, p.total_xp, p.coins;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_player_summary_profile
    ON mv_player_summary (profile_id);
CREATE INDEX IF NOT EXISTS idx_mv_player_summary_score
    ON mv_player_summary (all_time_high DESC);

-- ────────────────────────────────────────
-- 5. WORD FREQUENCY (most commonly found words)
-- ────────────────────────────────────────
-- NOTE: Requires game_scores to store word lists, or build from
-- profile unique_words_found arrays. Here we aggregate from profiles.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_word_frequency AS
SELECT
    word,
    COUNT(DISTINCT id) AS players_found,
    COUNT(DISTINCT id)::REAL /
        NULLIF((SELECT COUNT(*) FROM profiles WHERE games_played > 0), 0) AS discovery_rate
FROM profiles, UNNEST(unique_words_found) AS word
WHERE array_length(unique_words_found, 1) > 0
GROUP BY word
HAVING COUNT(DISTINCT id) >= 2
ORDER BY players_found DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_word_freq_word
    ON mv_word_frequency (word);
CREATE INDEX IF NOT EXISTS idx_mv_word_freq_count
    ON mv_word_frequency (players_found DESC);

-- ────────────────────────────────────────
-- 6. REFRESH FUNCTION
-- Call this via cron job or after game completion to keep views fresh.
-- ────────────────────────────────────────

CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_global_leaderboard;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_challenge_rankings;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_active_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_player_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_word_frequency;
END;
$$;

-- Grant execute to authenticated users (for RPC calls)
GRANT EXECUTE ON FUNCTION refresh_materialized_views() TO authenticated;

-- ────────────────────────────────────────
-- 7. DEBOUNCED REFRESH TRIGGER
-- Refreshes views after game_scores INSERT, but only if the last
-- refresh was more than 60 seconds ago (prevents excessive refreshes
-- during rapid play sessions).
-- ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _mv_refresh_log (
    id INTEGER PRIMARY KEY DEFAULT 1,
    last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01'::TIMESTAMPTZ
);
INSERT INTO _mv_refresh_log (id, last_refreshed_at) VALUES (1, '1970-01-01')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION trigger_debounced_mv_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    last_refresh TIMESTAMPTZ;
BEGIN
    SELECT last_refreshed_at INTO last_refresh FROM _mv_refresh_log WHERE id = 1;
    IF last_refresh IS NULL OR NOW() - last_refresh > INTERVAL '60 seconds' THEN
        UPDATE _mv_refresh_log SET last_refreshed_at = NOW() WHERE id = 1;
        PERFORM refresh_materialized_views();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_game_scores_refresh_mv ON game_scores;
CREATE TRIGGER trg_game_scores_refresh_mv
    AFTER INSERT ON game_scores
    FOR EACH STATEMENT
    EXECUTE FUNCTION trigger_debounced_mv_refresh();

-- ────────────────────────────────────────
-- 8. RLS POLICIES for materialized views
-- Materialized views don't support RLS directly, so we use
-- wrapper functions that check auth.
-- ────────────────────────────────────────

-- Global leaderboard: readable by anyone authenticated
CREATE OR REPLACE FUNCTION get_global_leaderboard(p_limit INTEGER DEFAULT 100, p_offset INTEGER DEFAULT 0)
RETURNS TABLE (
    profile_id UUID,
    username TEXT,
    level INTEGER,
    skill_rating REAL,
    skill_class TEXT,
    global_rank BIGINT,
    games_30d BIGINT,
    avg_score_30d REAL
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT
        profile_id, username, level,
        skill_rating::REAL, skill_class,
        global_rank, games_30d, avg_score_30d::REAL
    FROM mv_global_leaderboard
    ORDER BY global_rank
    LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_global_leaderboard(INTEGER, INTEGER) TO authenticated;

-- Challenge rankings: readable by anyone authenticated
CREATE OR REPLACE FUNCTION get_challenge_rankings(
    p_challenge_type TEXT,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    profile_id UUID,
    username TEXT,
    high_score INTEGER,
    games_played BIGINT,
    avg_score REAL,
    challenge_rank BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT
        profile_id, username, high_score,
        games_played, avg_score::REAL, challenge_rank
    FROM mv_challenge_rankings
    WHERE challenge_type = p_challenge_type
    ORDER BY challenge_rank
    LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_challenge_rankings(TEXT, INTEGER, INTEGER) TO authenticated;

-- Player summary: own profile or public info
CREATE OR REPLACE FUNCTION get_player_summary(p_profile_id UUID)
RETURNS TABLE (
    profile_id UUID,
    username TEXT,
    level INTEGER,
    total_games BIGINT,
    all_time_high INTEGER,
    avg_score INTEGER,
    total_words_found BIGINT,
    best_combo_ever INTEGER,
    recent_avg_score INTEGER,
    score_trend INTEGER,
    favorite_mode TEXT,
    active_days_30d BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT
        ps.profile_id, ps.username, ps.level,
        ps.total_games, ps.all_time_high, ps.avg_score,
        ps.total_words_found, ps.best_combo_ever,
        ps.recent_avg_score, ps.score_trend,
        ps.favorite_mode, ps.active_days_30d
    FROM mv_player_summary ps
    WHERE ps.profile_id = p_profile_id;
$$;

GRANT EXECUTE ON FUNCTION get_player_summary(UUID) TO authenticated;

-- ────────────────────────────────────────
-- 9. INITIAL REFRESH
-- ────────────────────────────────────────

SELECT refresh_materialized_views();
