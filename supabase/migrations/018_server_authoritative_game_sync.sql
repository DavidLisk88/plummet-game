-- ============================================================
-- PLUMMET — Server-authoritative game/result sync
-- Migration 018: Atomic RPC for game score + profile/challenge progression
-- ============================================================

CREATE OR REPLACE FUNCTION record_game_and_sync_profile(
    p_profile_id UUID,
    p_score_data JSONB,
    p_profile_updates JSONB DEFAULT '{}'::jsonb,
    p_challenge_stats JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_game_id UUID;
    v_account_id UUID;
    v_challenge_type TEXT;
    v_unique_words TEXT[];
BEGIN
    -- Ensure caller owns this profile.
    SELECT account_id INTO v_account_id
    FROM profiles
    WHERE id = p_profile_id;

    IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF auth.uid() IS DISTINCT FROM v_account_id THEN
        RAISE EXCEPTION 'Not authorized to update this profile';
    END IF;

    -- 1) Record the game event row.
    INSERT INTO game_scores (
        profile_id,
        game_mode,
        is_challenge,
        challenge_type,
        category_key,
        grid_size,
        difficulty,
        time_limit_seconds,
        score,
        words_found,
        longest_word_length,
        best_combo,
        target_words_completed,
        bonus_words_completed,
        time_remaining_seconds,
        xp_earned,
        coins_earned,
        grid_factor,
        difficulty_multiplier,
        mode_multiplier
    )
    VALUES (
        p_profile_id,
        COALESCE(p_score_data->>'game_mode', 'sandbox'),
        COALESCE((p_score_data->>'is_challenge')::BOOLEAN, FALSE),
        NULLIF(p_score_data->>'challenge_type', ''),
        NULLIF(p_score_data->>'category_key', ''),
        (p_score_data->>'grid_size')::INTEGER,
        COALESCE(p_score_data->>'difficulty', 'casual'),
        (p_score_data->>'time_limit_seconds')::INTEGER,
        COALESCE((p_score_data->>'score')::INTEGER, 0),
        COALESCE((p_score_data->>'words_found')::INTEGER, 0),
        COALESCE((p_score_data->>'longest_word_length')::INTEGER, 0),
        COALESCE((p_score_data->>'best_combo')::INTEGER, 0),
        COALESCE((p_score_data->>'target_words_completed')::INTEGER, 0),
        COALESCE((p_score_data->>'bonus_words_completed')::INTEGER, 0),
        (p_score_data->>'time_remaining_seconds')::INTEGER,
        COALESCE((p_score_data->>'xp_earned')::INTEGER, 0),
        COALESCE((p_score_data->>'coins_earned')::INTEGER, 0),
        (p_score_data->>'grid_factor')::REAL,
        (p_score_data->>'difficulty_multiplier')::REAL,
        (p_score_data->>'mode_multiplier')::REAL
    )
    RETURNING id INTO v_game_id;

    -- 2) Sync mutable profile progression (authoritative snapshot from client at game end).
    UPDATE profiles
    SET
        username = COALESCE(p_profile_updates->>'username', username),
        level = COALESCE((p_profile_updates->>'level')::INTEGER, level),
        xp = COALESCE((p_profile_updates->>'xp')::INTEGER, xp),
        total_xp = COALESCE((p_profile_updates->>'total_xp')::BIGINT, total_xp),
        high_score = COALESCE((p_profile_updates->>'high_score')::INTEGER, high_score),
        games_played = COALESCE((p_profile_updates->>'games_played')::INTEGER, games_played),
        total_words = COALESCE((p_profile_updates->>'total_words')::INTEGER, total_words),
        coins = COALESCE((p_profile_updates->>'coins')::INTEGER, coins),
        total_coins_earned = COALESCE((p_profile_updates->>'total_coins_earned')::INTEGER, total_coins_earned),
        last_play_date = COALESCE((p_profile_updates->>'last_play_date')::DATE, last_play_date),
        play_streak = COALESCE((p_profile_updates->>'play_streak')::INTEGER, play_streak),
        claimed_milestones = COALESCE((p_profile_updates->'claimed_milestones')::JSONB, claimed_milestones),
        unique_words_found = COALESCE(
            ARRAY(SELECT jsonb_array_elements_text(p_profile_updates->'unique_words_found')),
            unique_words_found
        ),
        updated_at = NOW()
    WHERE id = p_profile_id;

    -- 3) Sync challenge-level progression atomically when provided.
    IF p_challenge_stats IS NOT NULL THEN
        v_challenge_type := NULLIF(p_challenge_stats->>'challenge_type', '');

        IF v_challenge_type IS NOT NULL THEN
            v_unique_words := COALESCE(
                ARRAY(SELECT jsonb_array_elements_text(p_challenge_stats->'unique_words_found')),
                ARRAY[]::TEXT[]
            );

            INSERT INTO profile_challenge_stats (
                profile_id,
                challenge_type,
                high_score,
                games_played,
                total_words,
                target_word_level,
                unique_words_found,
                updated_at
            )
            VALUES (
                p_profile_id,
                v_challenge_type,
                COALESCE((p_challenge_stats->>'high_score')::INTEGER, 0),
                COALESCE((p_challenge_stats->>'games_played')::INTEGER, 0),
                COALESCE((p_challenge_stats->>'total_words')::INTEGER, 0),
                COALESCE((p_challenge_stats->>'target_word_level')::INTEGER, 1),
                v_unique_words,
                NOW()
            )
            ON CONFLICT (profile_id, challenge_type)
            DO UPDATE SET
                high_score = GREATEST(profile_challenge_stats.high_score, EXCLUDED.high_score),
                games_played = GREATEST(profile_challenge_stats.games_played, EXCLUDED.games_played),
                total_words = GREATEST(profile_challenge_stats.total_words, EXCLUDED.total_words),
                target_word_level = GREATEST(profile_challenge_stats.target_word_level, EXCLUDED.target_word_level),
                unique_words_found = ARRAY(
                    SELECT DISTINCT w
                    FROM unnest(profile_challenge_stats.unique_words_found || EXCLUDED.unique_words_found) AS w
                ),
                updated_at = NOW();
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'game_id', v_game_id,
        'profile_id', p_profile_id
    );
END;
$$;

REVOKE ALL ON FUNCTION record_game_and_sync_profile(UUID, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_game_and_sync_profile(UUID, JSONB, JSONB, JSONB) TO authenticated;
