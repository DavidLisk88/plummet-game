-- ════════════════════════════════════════════════════════════════════════════
-- Migration 024: Fix profile deletion trigger for restructured tables
-- ════════════════════════════════════════════════════════════════════════════
--
-- BUG: archive_deleted_profile() (from migration 014) references tables
-- that were renamed in migrations 021-022:
--   game_scores              → game_scores_log
--   profile_high_scores      → profile_high_scores_legacy
--   profile_challenge_stats  → profile_challenge_stats_legacy
--   profile_category_stats   → profile_category_stats_legacy
--   profile_word_search_stats→ profile_word_search_stats_legacy
--
-- Also missing: new aggregate tables created in 021 are not archived.
-- This migration rewrites the trigger to archive BOTH legacy + new tables.
-- ════════════════════════════════════════════════════════════════════════════

-- Add column for new aggregate data (all 8 dimension tables combined)
ALTER TABLE deleted_profiles
    ADD COLUMN IF NOT EXISTS aggregate_stats_data JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE deleted_profiles
    ADD COLUMN IF NOT EXISTS milestones_data JSONB NOT NULL DEFAULT '[]'::JSONB;

-- ════════════════════════════════════════
-- Rewrite the archive trigger function
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
    v_aggregate_stats JSONB;
    v_milestones JSONB;
BEGIN
    -- ── Legacy tables (renamed in 021/022, still have FK CASCADE) ──
    -- Use safe dynamic check: only query if table exists

    -- game_scores_log (was game_scores)
    BEGIN
        SELECT COALESCE(jsonb_agg(row_to_json(gs)::JSONB), '[]'::JSONB)
        INTO v_game_scores
        FROM game_scores_log gs WHERE gs.profile_id = OLD.id;
    EXCEPTION WHEN undefined_table THEN
        v_game_scores := '[]'::JSONB;
    END;

    -- profile_high_scores_legacy (was profile_high_scores)
    BEGIN
        SELECT COALESCE(jsonb_agg(row_to_json(hs)::JSONB), '[]'::JSONB)
        INTO v_high_scores
        FROM profile_high_scores_legacy hs WHERE hs.profile_id = OLD.id;
    EXCEPTION WHEN undefined_table THEN
        v_high_scores := '[]'::JSONB;
    END;

    -- profile_challenge_stats_legacy (was profile_challenge_stats)
    BEGIN
        SELECT COALESCE(jsonb_agg(row_to_json(cs)::JSONB), '[]'::JSONB)
        INTO v_challenge_stats
        FROM profile_challenge_stats_legacy cs WHERE cs.profile_id = OLD.id;
    EXCEPTION WHEN undefined_table THEN
        v_challenge_stats := '[]'::JSONB;
    END;

    -- profile_category_stats_legacy (was profile_category_stats)
    BEGIN
        SELECT COALESCE(jsonb_agg(row_to_json(cat)::JSONB), '[]'::JSONB)
        INTO v_category_stats
        FROM profile_category_stats_legacy cat WHERE cat.profile_id = OLD.id;
    EXCEPTION WHEN undefined_table THEN
        v_category_stats := '[]'::JSONB;
    END;

    -- profile_word_search_stats_legacy (was profile_word_search_stats)
    BEGIN
        SELECT COALESCE(jsonb_agg(row_to_json(wss)::JSONB), '[]'::JSONB)
        INTO v_ws_stats
        FROM profile_word_search_stats_legacy wss WHERE wss.profile_id = OLD.id;
    EXCEPTION WHEN undefined_table THEN
        v_ws_stats := '[]'::JSONB;
    END;

    -- profile_inventory (new, from 021) — or legacy if new doesn't exist
    BEGIN
        SELECT COALESCE(jsonb_agg(row_to_json(inv)::JSONB), '[]'::JSONB)
        INTO v_inventory
        FROM profile_inventory inv WHERE inv.profile_id = OLD.id;
    EXCEPTION WHEN undefined_table THEN
        BEGIN
            SELECT COALESCE(jsonb_agg(row_to_json(inv)::JSONB), '[]'::JSONB)
            INTO v_inventory
            FROM profile_inventory_legacy inv WHERE inv.profile_id = OLD.id;
        EXCEPTION WHEN undefined_table THEN
            v_inventory := '[]'::JSONB;
        END;
    END;

    -- ── New aggregate tables (created in 021) ──
    v_aggregate_stats := '{}'::JSONB;

    -- profile_game_stats
    BEGIN
        SELECT row_to_json(pgs)::JSONB INTO v_aggregate_stats
        FROM (
            SELECT 'profile_game_stats' AS _table, pgs.*
            FROM profile_game_stats pgs WHERE pgs.profile_id = OLD.id
        ) pgs;
        IF v_aggregate_stats IS NULL THEN v_aggregate_stats := '{}'::JSONB; END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;

    -- Build combined aggregate JSONB with all dimension tables
    v_aggregate_stats := jsonb_build_object(
        'profile_game_stats', v_aggregate_stats,
        'sandbox_grid_stats', COALESCE((
            SELECT jsonb_agg(row_to_json(s)::JSONB) FROM sandbox_grid_stats s WHERE s.profile_id = OLD.id
        ), '[]'::JSONB),
        'timed_grid_stats', COALESCE((
            SELECT jsonb_agg(row_to_json(s)::JSONB) FROM timed_grid_stats s WHERE s.profile_id = OLD.id
        ), '[]'::JSONB),
        'challenge_target_word_stats', COALESCE((
            SELECT jsonb_agg(row_to_json(s)::JSONB) FROM challenge_target_word_stats s WHERE s.profile_id = OLD.id
        ), '[]'::JSONB),
        'challenge_speed_round_stats', COALESCE((
            SELECT jsonb_agg(row_to_json(s)::JSONB) FROM challenge_speed_round_stats s WHERE s.profile_id = OLD.id
        ), '[]'::JSONB),
        'challenge_word_category_stats', COALESCE((
            SELECT jsonb_agg(row_to_json(s)::JSONB) FROM challenge_word_category_stats s WHERE s.profile_id = OLD.id
        ), '[]'::JSONB),
        'challenge_word_search_stats', COALESCE((
            SELECT jsonb_agg(row_to_json(s)::JSONB) FROM challenge_word_search_stats s WHERE s.profile_id = OLD.id
        ), '[]'::JSONB),
        'challenge_word_runner_stats', COALESCE((
            SELECT jsonb_agg(row_to_json(s)::JSONB) FROM challenge_word_runner_stats s WHERE s.profile_id = OLD.id
        ), '[]'::JSONB)
    );

    -- Milestones (new table from 021)
    BEGIN
        SELECT COALESCE(jsonb_agg(row_to_json(m)::JSONB), '[]'::JSONB)
        INTO v_milestones
        FROM profile_milestones m WHERE m.profile_id = OLD.id;
    EXCEPTION WHEN undefined_table THEN
        BEGIN
            SELECT COALESCE(jsonb_agg(row_to_json(m)::JSONB), '[]'::JSONB)
            INTO v_milestones
            FROM profile_milestones_legacy m WHERE m.profile_id = OLD.id;
        EXCEPTION WHEN undefined_table THEN
            v_milestones := '[]'::JSONB;
        END;
    END;

    -- ── Insert archive row ──
    INSERT INTO deleted_profiles (
        original_profile_id, account_id, username,
        profile_data,
        game_scores_data, high_scores_data,
        challenge_stats_data, category_stats_data,
        inventory_data, word_search_stats_data,
        aggregate_stats_data, milestones_data,
        deleted_by
    ) VALUES (
        OLD.id, OLD.account_id, OLD.username,
        row_to_json(OLD)::JSONB,
        v_game_scores, v_high_scores,
        v_challenge_stats, v_category_stats,
        v_inventory, v_ws_stats,
        v_aggregate_stats, v_milestones,
        auth.uid()
    );

    RETURN OLD; -- allow the DELETE to proceed
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger already exists from 014, but recreate to be safe
DROP TRIGGER IF EXISTS trg_archive_deleted_profile ON profiles;
CREATE TRIGGER trg_archive_deleted_profile
    BEFORE DELETE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION archive_deleted_profile();

-- ════════════════════════════════════════
-- Also update the restore function for new table structure
-- ════════════════════════════════════════
-- (Restore is admin-only and rarely used — just ensure it doesn't crash)
-- The restore function from 014 references old table names too,
-- but since it's only callable by service_role, we'll update it
-- to at minimum restore the profile row and aggregate stats.

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

    IF v_archive.expires_at < NOW() THEN
        RAISE EXCEPTION 'Archive expired on % — profile can no longer be restored', v_archive.expires_at;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_archive.account_id) THEN
        RAISE EXCEPTION 'Account % no longer exists', v_archive.account_id;
    END IF;

    v_profile := v_archive.profile_data;

    -- Check username availability
    v_username := v_archive.username;
    IF EXISTS (SELECT 1 FROM profiles WHERE username = v_username) THEN
        LOOP
            v_username := 'user' || floor(random() * 99999)::TEXT;
            EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE username = v_username);
            v_attempts := v_attempts + 1;
            IF v_attempts > 10 THEN
                RAISE EXCEPTION 'Could not generate unique username';
            END IF;
        END LOOP;
    END IF;

    -- Restore profile with new UUID
    v_new_profile_id := gen_random_uuid();
    INSERT INTO profiles (
        id, account_id, username, level, xp, total_xp, high_score,
        games_played, total_words, coins, total_coins_earned,
        preferred_grid_size, preferred_difficulty, preferred_game_mode,
        equipped_theme, equipped_block_style, bonus_slot_contents,
        perks, unlocked_grids, last_play_date, play_streak,
        claimed_milestones, unique_words_found
    ) VALUES (
        v_new_profile_id,
        v_archive.account_id,
        v_username,
        COALESCE((v_profile->>'level')::INTEGER, 1),
        COALESCE((v_profile->>'xp')::INTEGER, 0),
        COALESCE((v_profile->>'total_xp')::BIGINT, 0),
        COALESCE((v_profile->>'high_score')::INTEGER, 0),
        COALESCE((v_profile->>'games_played')::INTEGER, 0),
        COALESCE((v_profile->>'total_words')::INTEGER, 0),
        COALESCE((v_profile->>'coins')::INTEGER, 0),
        COALESCE((v_profile->>'total_coins_earned')::INTEGER, 0),
        COALESCE((v_profile->>'preferred_grid_size')::INTEGER, 5),
        COALESCE(v_profile->>'preferred_difficulty', 'casual'),
        COALESCE(v_profile->>'preferred_game_mode', 'sandbox'),
        COALESCE(v_profile->>'equipped_theme', 'theme_default'),
        COALESCE(v_profile->>'equipped_block_style', 'block_default'),
        COALESCE(v_profile->'bonus_slot_contents', '[null,null,null]'::JSONB),
        COALESCE(v_profile->'perks', '{}'::JSONB),
        COALESCE(v_profile->'unlocked_grids', '{}'::JSONB),
        (v_profile->>'last_play_date')::DATE,
        COALESCE((v_profile->>'play_streak')::INTEGER, 0),
        COALESCE(v_profile->'claimed_milestones', '[]'::JSONB),
        COALESCE(
            ARRAY(SELECT jsonb_array_elements_text(v_profile->'unique_words_found')),
            '{}'::TEXT[]
        )
    );

    -- Restore aggregate stats if present
    IF v_archive.aggregate_stats_data IS NOT NULL AND v_archive.aggregate_stats_data != '{}'::JSONB THEN
        -- profile_game_stats
        IF v_archive.aggregate_stats_data->'profile_game_stats' IS NOT NULL
            AND v_archive.aggregate_stats_data->'profile_game_stats' != '{}'::JSONB THEN
            INSERT INTO profile_game_stats (profile_id, games_played, high_score, total_score,
                total_words, avg_score, best_combo, best_longest_word, sum_score_squared,
                score_variance, recent_scores, total_xp_earned, total_coins_earned,
                game_history, skill_rating)
            SELECT v_new_profile_id,
                COALESCE((s->>'games_played')::INTEGER, 0),
                COALESCE((s->>'high_score')::INTEGER, 0),
                COALESCE((s->>'total_score')::BIGINT, 0),
                COALESCE((s->>'total_words')::INTEGER, 0),
                COALESCE((s->>'avg_score')::REAL, 0),
                COALESCE((s->>'best_combo')::INTEGER, 0),
                COALESCE((s->>'best_longest_word')::INTEGER, 0),
                COALESCE((s->>'sum_score_squared')::BIGINT, 0),
                COALESCE((s->>'score_variance')::REAL, 0),
                COALESCE(s->'recent_scores', '[]'::JSONB),
                COALESCE((s->>'total_xp_earned')::INTEGER, 0),
                COALESCE((s->>'total_coins_earned')::INTEGER, 0),
                COALESCE(s->'game_history', '[]'::JSONB),
                COALESCE((s->>'skill_rating')::REAL, 0)
            FROM jsonb_array_elements(
                CASE jsonb_typeof(v_archive.aggregate_stats_data->'profile_game_stats')
                    WHEN 'array' THEN v_archive.aggregate_stats_data->'profile_game_stats'
                    ELSE jsonb_build_array(v_archive.aggregate_stats_data->'profile_game_stats')
                END
            ) AS s
            LIMIT 1;
        END IF;
    END IF;

    -- Mark as restored
    UPDATE deleted_profiles SET
        restored_at = NOW(),
        restored_by = auth.uid()
    WHERE id = p_deleted_id;

    -- Recompute rankings
    BEGIN
        PERFORM update_ranking_for_account(v_archive.account_id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'restore_deleted_profile: ranking update failed: %', SQLERRM;
    END;

    RETURN v_new_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
