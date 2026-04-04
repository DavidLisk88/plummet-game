-- ============================================================
-- Fix: Make trigger functions SECURITY DEFINER so they bypass RLS
-- when writing to materialized stats tables.
--
-- Root cause: triggers fire in the user's auth context, but
-- profile_high_scores, profile_challenge_stats, profile_category_stats
-- only had SELECT RLS policies — no INSERT/UPDATE.
-- SECURITY DEFINER makes triggers run as the DB owner, bypassing RLS.
-- ============================================================

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

-- ============================================================
-- Clean up test data (run after the above)
-- ============================================================
DELETE FROM profile_high_scores WHERE profile_id = '6aac8f8f-4d74-40fa-b700-270d47f7690c';
DELETE FROM game_scores WHERE profile_id = '6aac8f8f-4d74-40fa-b700-270d47f7690c';
