-- ════════════════════════════════════════════════════════════════════════
-- Migration 029: Fix progression_component for ALL profiles + games_played
--
-- ROOT CAUSE 1 — Progression stuck at 0:
--   update_ranking_for_account() ratchets skill_rating (monotonic ↑) but
--   ALSO freezes ALL components when the new computed skill_rating < stored
--   peak.  After formula changes in 013→020→022→025 the recomputed total
--   was always lower than the old peak, so components (including progression)
--   got locked at their stale values (0 for progression, which wasn't
--   calculated properly in earlier formula versions).
--
--   FIX: Components should always reflect CURRENT computed values — they
--   drive the radar chart and percentiles.  Only skill_rating itself should
--   be ratcheted.
--
-- ROOT CAUSE 2 — games_played still wrong (92 vs 99):
--   get_player_analysis_data() uses COALESCE(pgs.games_played, profiles.games_played)
--   which only falls back on NULL.  If profile_game_stats has 92 (non-NULL)
--   it uses 92, ignoring profiles.games_played = 99.
--
--   FIX: Use GREATEST across both sources for games_played, high_score,
--   and total_words.  Also one-time sync of profile_game_stats from profiles
--   so the authoritative source has the correct value going forward.
--
-- ACTIONS:
--   1. Fix update_ranking_for_account — always update components
--   2. Fix get_player_analysis_data — GREATEST for stats
--   3. One-time data sync: profile_game_stats ← GREATEST(pgs, profiles)
--   4. Recompute ALL leaderboard rankings (unlocks progression for everyone)
-- ════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PART 1: Fix update_ranking_for_account                             ║
-- ║  Components ALWAYS update to current values.                        ║
-- ║  Only skill_rating is ratcheted (monotonic).                        ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION update_ranking_for_account(p_account_id UUID)
RETURNS void AS $$
DECLARE
    v_best_profile_id UUID;
    v_best_username TEXT;
    v_skill RECORD;
    v_pgs_floor REAL;
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
        DELETE FROM leaderboard_rankings WHERE account_id = p_account_id;
        RETURN;
    END IF;

    -- Compute skill for the best profile
    SELECT * INTO v_skill FROM compute_profile_skill(v_best_profile_id);

    -- Use profile_game_stats.skill_rating as floor (includes guaranteed bumps)
    SELECT COALESCE(pgs.skill_rating, 0) INTO v_pgs_floor
    FROM profile_game_stats pgs WHERE pgs.profile_id = v_best_profile_id;
    v_skill.skill_rating := GREATEST(v_skill.skill_rating, COALESCE(v_pgs_floor, 0));

    -- Upsert into leaderboard
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
        -- skill_rating: RATCHET (monotonic — never decreases for same profile)
        skill_rating = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id
            THEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating)
            ELSE EXCLUDED.skill_rating
        END,
        -- COMPONENTS: ALWAYS update to current computed values.
        -- These drive the radar chart and percentiles — they should reflect
        -- current performance, not a frozen snapshot from a peak moment.
        raw_score_component     = EXCLUDED.raw_score_component,
        grid_mastery_component  = EXCLUDED.grid_mastery_component,
        difficulty_component    = EXCLUDED.difficulty_component,
        time_pressure_component = EXCLUDED.time_pressure_component,
        challenge_component     = EXCLUDED.challenge_component,
        consistency_component   = EXCLUDED.consistency_component,
        versatility_component   = EXCLUDED.versatility_component,
        progression_component   = EXCLUDED.progression_component,
        -- skill_class: follows the ratcheted rating
        skill_class = CASE
            WHEN leaderboard_rankings.profile_id = EXCLUDED.profile_id
            THEN CASE
                WHEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating) >= 10000 THEN 'master'
                WHEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating) >= 5000  THEN 'high'
                WHEN GREATEST(leaderboard_rankings.skill_rating, EXCLUDED.skill_rating) >= 1500  THEN 'medium'
                ELSE 'low'
            END
            ELSE EXCLUDED.skill_class
        END,
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PART 2: Fix get_player_analysis_data                               ║
-- ║  Use GREATEST across profile_game_stats + profiles for stats.       ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION get_player_analysis_data(p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_pgs RECORD;
    v_lr RECORD;
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
    v_streak INTEGER := 0;
    v_improving BOOLEAN := FALSE;
    v_new_pb BOOLEAN := FALSE;
    v_total_games INTEGER;
    v_next_milestone INTEGER;
    v_games_to_milestone INTEGER;
    v_score_arr JSONB;
BEGIN
    -- Access control
    IF NOT EXISTS (
        SELECT 1 FROM leaderboard_rankings lr WHERE lr.profile_id = p_profile_id
    ) AND NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = p_profile_id AND account_id = auth.uid()
    ) THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_profile FROM profiles WHERE id = p_profile_id;
    IF v_profile IS NULL THEN RETURN NULL; END IF;

    -- ══ READ FROM AUTHORITATIVE SOURCES ══
    SELECT * INTO v_pgs FROM profile_game_stats WHERE profile_id = p_profile_id;

    -- Read rating, class, rank, components from leaderboard_rankings
    SELECT * INTO v_lr FROM leaderboard_rankings WHERE profile_id = p_profile_id;

    -- Use stored class from leaderboard_rankings (matches what the entry row shows)
    v_class := COALESCE(v_lr.skill_class, 'low');

    -- ══ Percentiles from STORED component values (no N+1 compute calls) ══
    WITH class_players AS (
        SELECT lr.raw_score_component, lr.grid_mastery_component,
               lr.difficulty_component, lr.time_pressure_component,
               lr.challenge_component, lr.consistency_component,
               lr.versatility_component, lr.progression_component
        FROM leaderboard_rankings lr
        WHERE lr.skill_class = v_class
    )
    SELECT
        COUNT(*),
        jsonb_build_object(
            'raw_score',     ROUND((COUNT(*) FILTER (WHERE cp.raw_score_component     <= COALESCE(v_lr.raw_score_component, 0))::REAL     / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'grid_mastery',  ROUND((COUNT(*) FILTER (WHERE cp.grid_mastery_component  <= COALESCE(v_lr.grid_mastery_component, 0))::REAL  / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'difficulty',    ROUND((COUNT(*) FILTER (WHERE cp.difficulty_component    <= COALESCE(v_lr.difficulty_component, 0))::REAL    / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'time_pressure', ROUND((COUNT(*) FILTER (WHERE cp.time_pressure_component <= COALESCE(v_lr.time_pressure_component, 0))::REAL / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'challenge',     ROUND((COUNT(*) FILTER (WHERE cp.challenge_component     <= COALESCE(v_lr.challenge_component, 0))::REAL     / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'consistency',   ROUND((COUNT(*) FILTER (WHERE cp.consistency_component   <= COALESCE(v_lr.consistency_component, 0))::REAL   / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'versatility',   ROUND((COUNT(*) FILTER (WHERE cp.versatility_component   <= COALESCE(v_lr.versatility_component, 0))::REAL   / GREATEST(COUNT(*), 1) * 100)::NUMERIC),
            'progression',   ROUND((COUNT(*) FILTER (WHERE cp.progression_component   <= COALESCE(v_lr.progression_component, 0))::REAL   / GREATEST(COUNT(*), 1) * 100)::NUMERIC)
        ),
        jsonb_build_object(
            'raw_score',     ROUND(AVG(cp.raw_score_component)::NUMERIC, 1),
            'grid_mastery',  ROUND(AVG(cp.grid_mastery_component)::NUMERIC, 1),
            'difficulty',    ROUND(AVG(cp.difficulty_component)::NUMERIC, 1),
            'time_pressure', ROUND(AVG(cp.time_pressure_component)::NUMERIC, 1),
            'challenge',     ROUND(AVG(cp.challenge_component)::NUMERIC, 1),
            'consistency',   ROUND(AVG(cp.consistency_component)::NUMERIC, 1),
            'versatility',   ROUND(AVG(cp.versatility_component)::NUMERIC, 1),
            'progression',   ROUND(AVG(cp.progression_component)::NUMERIC, 1)
        )
    INTO v_total_in_class, v_percentiles, v_class_avgs
    FROM class_players cp;

    -- ══ FIX: Use GREATEST across both tables for stats ══
    -- profile_game_stats and profiles can diverge; take the higher value.
    v_total_games   := GREATEST(COALESCE(v_pgs.games_played, 0), COALESCE(v_profile.games_played, 0));
    v_all_time_high := GREATEST(COALESCE(v_pgs.high_score, 0),   COALESCE(v_profile.high_score, 0));

    -- ══ Delta and streak from profile_game_stats.recent_scores ══
    v_score_arr := COALESCE(v_pgs.recent_scores, '[]'::JSONB);

    -- Recent avg (first 10 scores)
    SELECT COALESCE(AVG(s::REAL), 0) INTO v_recent_avg
    FROM (SELECT jsonb_array_elements(v_score_arr) AS s LIMIT 10) sub;

    -- Older avg (scores 11-20)
    SELECT COALESCE(AVG(s::REAL), 0) INTO v_older_avg
    FROM (SELECT s FROM (
        SELECT s, idx FROM jsonb_array_elements(v_score_arr) WITH ORDINALITY AS t(s, idx)
    ) q WHERE q.idx > 10 AND q.idx <= 20) sub;

    v_delta := jsonb_build_object(
        'score_change_pct', CASE WHEN v_older_avg > 0 THEN ROUND(((v_recent_avg - v_older_avg) / v_older_avg * 100)::NUMERIC, 1) ELSE 0 END,
        'words_change_pct', 0,
        'recent_avg', ROUND(v_recent_avg::NUMERIC, 1),
        'older_avg', ROUND(v_older_avg::NUMERIC, 1)
    );

    -- Recent high (first 5 scores)
    SELECT COALESCE(MAX(s::INTEGER), 0) INTO v_recent_high
    FROM (SELECT jsonb_array_elements(v_score_arr) AS s LIMIT 5) sub;

    v_new_pb := (v_recent_high > 0 AND v_recent_high >= v_all_time_high AND v_total_games > 5);

    -- Improvement streak
    SELECT COUNT(*) INTO v_streak
    FROM (
        SELECT s::INTEGER AS score,
               LEAD(s::INTEGER) OVER (ORDER BY idx) AS prev_score
        FROM (
            SELECT s, idx FROM jsonb_array_elements(v_score_arr) WITH ORDINALITY AS t(s, idx)
        ) q
        WHERE q.idx <= 6
    ) sub
    WHERE sub.prev_score IS NOT NULL AND sub.score >= sub.prev_score;

    v_improving := (v_streak >= 3);

    -- Milestones
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
        'high_score', v_all_time_high,
        'total_words', GREATEST(COALESCE(v_pgs.total_words, 0), COALESCE(v_profile.total_words, 0)),
        'play_streak', COALESCE(v_profile.play_streak, 0),
        'skill_class', v_class,
        'skill_rating', COALESCE(v_lr.skill_rating, COALESCE(v_pgs.skill_rating, 0)),
        'class_rank', COALESCE(v_lr.class_rank, 0),
        'components', jsonb_build_object(
            'raw_score',     COALESCE(v_lr.raw_score_component, 0),
            'grid_mastery',  COALESCE(v_lr.grid_mastery_component, 0),
            'difficulty',    COALESCE(v_lr.difficulty_component, 0),
            'time_pressure', COALESCE(v_lr.time_pressure_component, 0),
            'challenge',     COALESCE(v_lr.challenge_component, 0),
            'consistency',   COALESCE(v_lr.consistency_component, 0),
            'versatility',   COALESCE(v_lr.versatility_component, 0),
            'progression',   COALESCE(v_lr.progression_component, 0)
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

GRANT EXECUTE ON FUNCTION get_player_analysis_data(UUID) TO authenticated;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PART 2b: refresh_my_stats()                                        ║
-- ║  Client-callable RPC that refreshes PGS skill_rating THEN           ║
-- ║  recomputes leaderboard ranking. Ensures a player can un-stale      ║
-- ║  themselves without playing a game.                                  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION refresh_my_stats()
RETURNS JSONB AS $$
DECLARE
    v_account_id UUID;
    v_profile RECORD;
    v_fresh_skill REAL;
    v_pgs_current REAL;
    v_updated INTEGER := 0;
BEGIN
    v_account_id := auth.uid();
    IF v_account_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
    END IF;

    -- Step 1: Refresh profile_game_stats.skill_rating for ALL profiles on this account
    FOR v_profile IN
        SELECT p.id AS profile_id
        FROM profiles p
        JOIN profile_game_stats pgs ON pgs.profile_id = p.id
        WHERE p.account_id = v_account_id AND pgs.games_played > 0
    LOOP
        SELECT s.skill_rating INTO v_fresh_skill
        FROM compute_profile_skill(v_profile.profile_id) s;

        SELECT pgs.skill_rating INTO v_pgs_current
        FROM profile_game_stats pgs WHERE pgs.profile_id = v_profile.profile_id;

        -- Ratchet up only
        IF COALESCE(v_fresh_skill, 0) > COALESCE(v_pgs_current, 0) THEN
            UPDATE profile_game_stats SET
                skill_rating = v_fresh_skill,
                updated_at = NOW()
            WHERE profile_id = v_profile.profile_id;
            v_updated := v_updated + 1;
        END IF;
    END LOOP;

    -- Step 2: Recompute leaderboard ranking with fresh PGS floor + current components
    PERFORM update_ranking_for_account(v_account_id);

    RETURN jsonb_build_object('success', true, 'profiles_updated', v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION refresh_my_stats() TO authenticated;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PART 3: One-time data sync                                         ║
-- ║  Ensure profile_game_stats has the HIGHEST value from both tables.  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Sync games_played, high_score, total_words from profiles → profile_game_stats
-- (only bump UP, never down)
UPDATE profile_game_stats pgs SET
    games_played = GREATEST(pgs.games_played, p.games_played),
    high_score   = GREATEST(pgs.high_score,   p.high_score),
    total_words  = GREATEST(pgs.total_words,  p.total_words),
    updated_at   = NOW()
FROM profiles p
WHERE p.id = pgs.profile_id
  AND (pgs.games_played < p.games_played
       OR pgs.high_score < p.high_score
       OR pgs.total_words < p.total_words);

-- Also ensure profile_game_stats rows exist for any profiles that have
-- games in the profiles table but no profile_game_stats row yet
INSERT INTO profile_game_stats (
    profile_id, games_played, high_score, total_score, total_words,
    avg_score, best_combo, best_longest_word,
    sum_score_squared, score_variance, recent_scores,
    total_xp_earned, total_coins_earned, game_history, last_played_at
)
SELECT
    p.id, p.games_played, p.high_score, 0, p.total_words,
    0, 0, 0,
    0, 0, '[]'::JSONB,
    0, 0, '[]'::JSONB, NOW()
FROM profiles p
WHERE p.games_played > 0
  AND NOT EXISTS (SELECT 1 FROM profile_game_stats WHERE profile_id = p.id)
ON CONFLICT (profile_id) DO NOTHING;


-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PART 4: Refresh profile_game_stats.skill_rating for ALL profiles   ║
-- ║  Then recompute ALL leaderboard rankings.                           ║
-- ║                                                                     ║
-- ║  Why both steps:                                                    ║
-- ║  - PGS.skill_rating is used as a FLOOR in update_ranking_for_account║
-- ║  - If PGS.skill_rating fell behind (stale), the floor is too low    ║
-- ║    and the leaderboard rating stays stuck at its old ratcheted peak. ║
-- ║  - Refreshing PGS first ensures the floor reflects current play.    ║
-- ║  - Then the leaderboard recompute picks up the correct floor AND    ║
-- ║    fresh components (progression etc.).                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝

DO $$
DECLARE
    v_prof RECORD;
    v_acct RECORD;
    v_fresh_skill REAL;
    v_pgs_count INTEGER := 0;
    v_lr_count INTEGER := 0;
    v_errors INTEGER := 0;
BEGIN
    -- ── STEP A: Refresh profile_game_stats.skill_rating for every profile ──
    -- Recompute from formula and ratchet UP (never decrease).
    FOR v_prof IN
        SELECT pgs.profile_id, pgs.skill_rating AS current_rating
        FROM profile_game_stats pgs
        WHERE pgs.games_played > 0
    LOOP
        BEGIN
            SELECT s.skill_rating INTO v_fresh_skill
            FROM compute_profile_skill(v_prof.profile_id) s;

            -- Only bump up, never down (preserve guaranteed bumps from past games)
            IF COALESCE(v_fresh_skill, 0) > COALESCE(v_prof.current_rating, 0) THEN
                UPDATE profile_game_stats SET
                    skill_rating = v_fresh_skill,
                    updated_at = NOW()
                WHERE profile_id = v_prof.profile_id;
            END IF;

            v_pgs_count := v_pgs_count + 1;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE WARNING '029 PGS refresh failed for profile %: %', v_prof.profile_id, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE '029 step A: Refreshed PGS skill_rating for % profiles (% errors)', v_pgs_count, v_errors;
    v_errors := 0;

    -- ── STEP B: Recompute ALL leaderboard rankings ──
    -- Uses the freshly-updated PGS floors + unlocked components.
    FOR v_acct IN
        SELECT DISTINCT account_id
        FROM profiles
        WHERE games_played > 0 AND account_id IS NOT NULL
    LOOP
        BEGIN
            PERFORM update_ranking_for_account(v_acct.account_id);
            v_lr_count := v_lr_count + 1;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE WARNING '029 LR recompute failed for account %: %', v_acct.account_id, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE '029 step B: Recomputed % accounts (% errors)', v_lr_count, v_errors;
END $$;
