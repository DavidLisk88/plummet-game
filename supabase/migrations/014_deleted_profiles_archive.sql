-- ────────────────────────────────────────────────────────────────
-- Migration 014: Deleted Profiles Archive
-- ────────────────────────────────────────────────────────────────
-- Archives profiles and all associated data before deletion so
-- they can be restored within 14 days. After 14 days the archive
-- row is permanently purged to save storage.
--
-- On deletion the username is freed (row leaves profiles table).
-- On restore, if the original username was taken by another live
-- profile, a random "userXXXXX" username is assigned instead.
-- ────────────────────────────────────────────────────────────────

-- ════════════════════════════════════════
-- 1. Archive table
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS deleted_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Original identifiers
    original_profile_id UUID NOT NULL,
    account_id UUID NOT NULL,
    username TEXT NOT NULL,
    -- Full snapshot of profile row
    profile_data JSONB NOT NULL,
    -- Child table snapshots (all rows belonging to this profile)
    game_scores_data JSONB NOT NULL DEFAULT '[]'::JSONB,
    high_scores_data JSONB NOT NULL DEFAULT '[]'::JSONB,
    challenge_stats_data JSONB NOT NULL DEFAULT '[]'::JSONB,
    category_stats_data JSONB NOT NULL DEFAULT '[]'::JSONB,
    inventory_data JSONB NOT NULL DEFAULT '[]'::JSONB,
    word_search_stats_data JSONB NOT NULL DEFAULT '[]'::JSONB,
    -- Metadata
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
    deleted_by UUID, -- account that performed the deletion
    restored_at TIMESTAMPTZ, -- set if/when restored
    restored_by UUID
);

-- Add expires_at if table was created before this column existed
ALTER TABLE deleted_profiles ADD COLUMN IF NOT EXISTS expires_at
    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days');

CREATE INDEX IF NOT EXISTS idx_deleted_profiles_account ON deleted_profiles(account_id);
CREATE INDEX IF NOT EXISTS idx_deleted_profiles_username ON deleted_profiles(username);
CREATE INDEX IF NOT EXISTS idx_deleted_profiles_deleted_at ON deleted_profiles(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_profiles_expires_at ON deleted_profiles(expires_at)
    WHERE restored_at IS NULL;

-- RLS: only service role can access (admin-only table)
ALTER TABLE deleted_profiles ENABLE ROW LEVEL SECURITY;
-- No RLS policies = no access for authenticated/anon users.
-- Service role bypasses RLS.

-- ════════════════════════════════════════
-- 2. BEFORE DELETE trigger to archive profile data
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION archive_deleted_profile()
RETURNS TRIGGER AS $$
DECLARE
    v_game_scores JSONB;
    v_high_scores JSONB;
    v_challenge_stats JSONB;
    v_category_stats JSONB;
    v_inventory JSONB;
    v_ws_stats JSONB;
BEGIN
    -- Snapshot all child tables before CASCADE deletes them

    SELECT COALESCE(jsonb_agg(row_to_json(gs)::JSONB), '[]'::JSONB)
    INTO v_game_scores
    FROM game_scores gs WHERE gs.profile_id = OLD.id;

    SELECT COALESCE(jsonb_agg(row_to_json(hs)::JSONB), '[]'::JSONB)
    INTO v_high_scores
    FROM profile_high_scores hs WHERE hs.profile_id = OLD.id;

    SELECT COALESCE(jsonb_agg(row_to_json(cs)::JSONB), '[]'::JSONB)
    INTO v_challenge_stats
    FROM profile_challenge_stats cs WHERE cs.profile_id = OLD.id;

    SELECT COALESCE(jsonb_agg(row_to_json(cat)::JSONB), '[]'::JSONB)
    INTO v_category_stats
    FROM profile_category_stats cat WHERE cat.profile_id = OLD.id;

    SELECT COALESCE(jsonb_agg(row_to_json(inv)::JSONB), '[]'::JSONB)
    INTO v_inventory
    FROM profile_inventory inv WHERE inv.profile_id = OLD.id;

    SELECT COALESCE(jsonb_agg(row_to_json(wss)::JSONB), '[]'::JSONB)
    INTO v_ws_stats
    FROM profile_word_search_stats wss WHERE wss.profile_id = OLD.id;

    INSERT INTO deleted_profiles (
        original_profile_id, account_id, username,
        profile_data,
        game_scores_data, high_scores_data,
        challenge_stats_data, category_stats_data,
        inventory_data, word_search_stats_data,
        deleted_by
    ) VALUES (
        OLD.id, OLD.account_id, OLD.username,
        row_to_json(OLD)::JSONB,
        v_game_scores, v_high_scores,
        v_challenge_stats, v_category_stats,
        v_inventory, v_ws_stats,
        auth.uid()
    );

    RETURN OLD; -- allow the DELETE to proceed
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_archive_deleted_profile ON profiles;
CREATE TRIGGER trg_archive_deleted_profile
    BEFORE DELETE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION archive_deleted_profile();

-- After the profile (and its CASCADE children) are gone,
-- recompute leaderboard for the account so the next-best
-- profile takes the slot at its own rating.
CREATE OR REPLACE FUNCTION refresh_rankings_after_profile_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- Only refresh if the account still exists (it won't during account deletion)
    IF EXISTS (SELECT 1 FROM accounts WHERE id = OLD.account_id) THEN
        PERFORM update_ranking_for_account(OLD.account_id);
    END IF;
    RETURN NULL; -- AFTER trigger, return value ignored
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_refresh_rankings_after_profile_delete ON profiles;
CREATE TRIGGER trg_refresh_rankings_after_profile_delete
    AFTER DELETE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION refresh_rankings_after_profile_delete();

-- ════════════════════════════════════════
-- 3. Purge expired archives (14-day TTL)
-- ════════════════════════════════════════
CREATE OR REPLACE FUNCTION purge_expired_deleted_profiles()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM deleted_profiles
    WHERE restored_at IS NULL
      AND expires_at < NOW();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule daily purge via pg_cron (runs at 3 AM UTC)
-- pg_cron must be enabled in your Supabase project dashboard first.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'purge-expired-deleted-profiles',
            '0 3 * * *',
            $cron$ SELECT purge_expired_deleted_profiles(); $cron$
        );
    END IF;
END;
$$;

-- ════════════════════════════════════════
-- 4. Restore function (service-role / admin only)
-- ════════════════════════════════════════
-- Restores a deleted profile and all its child data back into
-- the live tables. The profile gets a new UUID but all stats
-- are preserved. If the original username was taken by another
-- live profile, assigns a random "userXXXXX" username.
-- Only callable by service role.
CREATE OR REPLACE FUNCTION restore_deleted_profile(p_deleted_id UUID)
RETURNS UUID AS $$
DECLARE
    v_archive RECORD;
    v_new_profile_id UUID;
    v_profile JSONB;
    v_username TEXT;
    v_attempts INTEGER := 0;
    rec JSONB;
BEGIN
    SELECT * INTO v_archive FROM deleted_profiles
    WHERE id = p_deleted_id AND restored_at IS NULL;

    IF v_archive IS NULL THEN
        RAISE EXCEPTION 'Deleted profile not found or already restored: %', p_deleted_id;
    END IF;

    -- Reject if the 14-day window has passed
    IF v_archive.expires_at < NOW() THEN
        RAISE EXCEPTION 'Archive expired on % — profile can no longer be restored', v_archive.expires_at;
    END IF;

    -- Verify the account still exists
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_archive.account_id) THEN
        RAISE EXCEPTION 'Account % no longer exists — cannot restore profile', v_archive.account_id;
    END IF;

    v_profile := v_archive.profile_data;

    -- Check if the original username is still available
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE LOWER(username) = LOWER(v_archive.username)
    ) THEN
        v_username := v_archive.username;
    ELSE
        -- Username taken — generate a random "userXXXXX" username
        LOOP
            v_username := 'user' || LPAD(FLOOR(RANDOM() * 100000)::TEXT, 5, '0');
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM profiles WHERE LOWER(username) = LOWER(v_username)
            );
            v_attempts := v_attempts + 1;
            IF v_attempts > 50 THEN
                RAISE EXCEPTION 'Could not generate unique username after 50 attempts';
            END IF;
        END LOOP;
    END IF;

    -- Re-insert profile with a new ID
    INSERT INTO profiles (
        account_id, username,
        level, xp, total_xp, high_score, games_played, total_words,
        coins, total_coins_earned,
        preferred_grid_size, preferred_difficulty, preferred_game_mode,
        equipped_theme, equipped_block_style, bonus_slot_contents, perks, unlocked_grids,
        last_play_date, play_streak, claimed_milestones, unique_words_found,
        created_at
    ) VALUES (
        v_archive.account_id,
        v_username,
        (v_profile->>'level')::INTEGER,
        (v_profile->>'xp')::INTEGER,
        (v_profile->>'total_xp')::BIGINT,
        (v_profile->>'high_score')::INTEGER,
        (v_profile->>'games_played')::INTEGER,
        (v_profile->>'total_words')::INTEGER,
        (v_profile->>'coins')::INTEGER,
        (v_profile->>'total_coins_earned')::INTEGER,
        (v_profile->>'preferred_grid_size')::INTEGER,
        v_profile->>'preferred_difficulty',
        v_profile->>'preferred_game_mode',
        v_profile->>'equipped_theme',
        v_profile->>'equipped_block_style',
        COALESCE(v_profile->'bonus_slot_contents', '[null, null, null]'::JSONB),
        COALESCE(v_profile->'perks', '{}'::JSONB),
        COALESCE(v_profile->'unlocked_grids', '{}'::JSONB),
        (v_profile->>'last_play_date')::DATE,
        (v_profile->>'play_streak')::INTEGER,
        COALESCE(v_profile->'claimed_milestones', '[]'::JSONB),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_profile->'unique_words_found')), '{}'),
        COALESCE((v_profile->>'created_at')::TIMESTAMPTZ, NOW())
    )
    RETURNING id INTO v_new_profile_id;

    -- ── Restore game_scores ──
    FOR rec IN SELECT * FROM jsonb_array_elements(v_archive.game_scores_data) LOOP
        INSERT INTO game_scores (
            profile_id, game_mode, is_challenge, challenge_type, category_key,
            grid_size, difficulty, time_limit_seconds,
            score, words_found, longest_word_length, best_combo,
            target_words_completed, bonus_words_completed, time_remaining_seconds,
            xp_earned, coins_earned, grid_factor, difficulty_multiplier, mode_multiplier,
            played_at
        ) VALUES (
            v_new_profile_id,
            rec->>'game_mode',
            (rec->>'is_challenge')::BOOLEAN,
            rec->>'challenge_type',
            rec->>'category_key',
            (rec->>'grid_size')::INTEGER,
            rec->>'difficulty',
            (rec->>'time_limit_seconds')::INTEGER,
            (rec->>'score')::INTEGER,
            (rec->>'words_found')::INTEGER,
            (rec->>'longest_word_length')::INTEGER,
            (rec->>'best_combo')::INTEGER,
            (rec->>'target_words_completed')::INTEGER,
            (rec->>'bonus_words_completed')::INTEGER,
            (rec->>'time_remaining_seconds')::INTEGER,
            (rec->>'xp_earned')::INTEGER,
            (rec->>'coins_earned')::INTEGER,
            (rec->>'grid_factor')::REAL,
            (rec->>'difficulty_multiplier')::REAL,
            (rec->>'mode_multiplier')::REAL,
            COALESCE((rec->>'played_at')::TIMESTAMPTZ, NOW())
        );
    END LOOP;

    -- ── Restore profile_high_scores ──
    FOR rec IN SELECT * FROM jsonb_array_elements(v_archive.high_scores_data) LOOP
        INSERT INTO profile_high_scores (
            profile_id, game_mode, is_challenge, challenge_type, category_key,
            grid_size, difficulty, time_limit_seconds,
            high_score, best_words_found, best_combo, best_longest_word,
            best_target_words, games_played, total_score, avg_score,
            achieved_at
        ) VALUES (
            v_new_profile_id,
            rec->>'game_mode',
            (rec->>'is_challenge')::BOOLEAN,
            rec->>'challenge_type',
            rec->>'category_key',
            (rec->>'grid_size')::INTEGER,
            rec->>'difficulty',
            (rec->>'time_limit_seconds')::INTEGER,
            (rec->>'high_score')::INTEGER,
            (rec->>'best_words_found')::INTEGER,
            (rec->>'best_combo')::INTEGER,
            (rec->>'best_longest_word')::INTEGER,
            COALESCE((rec->>'best_target_words')::INTEGER, 0),
            (rec->>'games_played')::INTEGER,
            (rec->>'total_score')::BIGINT,
            (rec->>'avg_score')::REAL,
            COALESCE((rec->>'achieved_at')::TIMESTAMPTZ, NOW())
        );
    END LOOP;

    -- ── Restore profile_challenge_stats ──
    FOR rec IN SELECT * FROM jsonb_array_elements(v_archive.challenge_stats_data) LOOP
        INSERT INTO profile_challenge_stats (
            profile_id, challenge_type,
            high_score, games_played, total_words,
            target_word_level, unique_words_found
        ) VALUES (
            v_new_profile_id,
            rec->>'challenge_type',
            (rec->>'high_score')::INTEGER,
            (rec->>'games_played')::INTEGER,
            (rec->>'total_words')::INTEGER,
            COALESCE((rec->>'target_word_level')::INTEGER, 1),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(rec->'unique_words_found')), '{}')
        );
    END LOOP;

    -- ── Restore profile_category_stats ──
    FOR rec IN SELECT * FROM jsonb_array_elements(v_archive.category_stats_data) LOOP
        INSERT INTO profile_category_stats (
            profile_id, category_key,
            high_score, games_played, total_category_words,
            best_category_words_per_game,
            high_score_grid_3, high_score_grid_4, high_score_grid_5,
            high_score_grid_6, high_score_grid_7, high_score_grid_8
        ) VALUES (
            v_new_profile_id,
            rec->>'category_key',
            (rec->>'high_score')::INTEGER,
            (rec->>'games_played')::INTEGER,
            (rec->>'total_category_words')::INTEGER,
            (rec->>'best_category_words_per_game')::INTEGER,
            COALESCE((rec->>'high_score_grid_3')::INTEGER, 0),
            COALESCE((rec->>'high_score_grid_4')::INTEGER, 0),
            COALESCE((rec->>'high_score_grid_5')::INTEGER, 0),
            COALESCE((rec->>'high_score_grid_6')::INTEGER, 0),
            COALESCE((rec->>'high_score_grid_7')::INTEGER, 0),
            COALESCE((rec->>'high_score_grid_8')::INTEGER, 0)
        );
    END LOOP;

    -- ── Restore profile_inventory ──
    FOR rec IN SELECT * FROM jsonb_array_elements(v_archive.inventory_data) LOOP
        INSERT INTO profile_inventory (profile_id, item_id, purchased_at)
        VALUES (
            v_new_profile_id,
            rec->>'item_id',
            COALESCE((rec->>'purchased_at')::TIMESTAMPTZ, NOW())
        );
    END LOOP;

    -- ── Restore profile_word_search_stats ──
    FOR rec IN SELECT * FROM jsonb_array_elements(v_archive.word_search_stats_data) LOOP
        INSERT INTO profile_word_search_stats (
            profile_id,
            games_played, total_words_found, total_placed_words,
            total_bonus_words, perfect_clears,
            high_score, best_words_per_game, highest_level_reached,
            fastest_clear_seconds, best_bonus_words_single,
            avg_completion_rate, avg_time_efficiency, avg_score_per_game,
            recent_games
        ) VALUES (
            v_new_profile_id,
            (rec->>'games_played')::INTEGER,
            (rec->>'total_words_found')::INTEGER,
            (rec->>'total_placed_words')::INTEGER,
            (rec->>'total_bonus_words')::INTEGER,
            (rec->>'perfect_clears')::INTEGER,
            (rec->>'high_score')::INTEGER,
            (rec->>'best_words_per_game')::INTEGER,
            (rec->>'highest_level_reached')::INTEGER,
            (rec->>'fastest_clear_seconds')::REAL,
            (rec->>'best_bonus_words_single')::INTEGER,
            (rec->>'avg_completion_rate')::REAL,
            (rec->>'avg_time_efficiency')::REAL,
            (rec->>'avg_score_per_game')::REAL,
            COALESCE(rec->'recent_games', '[]'::JSONB)
        );
    END LOOP;

    -- Mark archive entry as restored
    UPDATE deleted_profiles SET
        restored_at = NOW(),
        restored_by = auth.uid()
    WHERE id = p_deleted_id;

    -- Recompute leaderboard for this account
    -- (Can't use update_my_ranking() here because auth.uid() is NULL under service role)
    PERFORM update_ranking_for_account(v_archive.account_id);

    RETURN v_new_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only service role can restore (admin action)
REVOKE EXECUTE ON FUNCTION restore_deleted_profile(UUID) FROM authenticated, anon, public;
