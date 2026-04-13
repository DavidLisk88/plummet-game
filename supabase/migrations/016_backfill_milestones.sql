-- Migration 016: Backfill Milestones for Existing Profiles
--
-- Creates a server-side function that analyzes each profile's stats
-- and awards all milestones they already qualify for.
-- This ensures players who existed before milestones see their
-- achievements immediately.

-- Relax the coins constraint for higher-value milestones (meta_all = 1000)
ALTER TABLE profile_milestones
    DROP CONSTRAINT IF EXISTS chk_coins_awarded;
ALTER TABLE profile_milestones
    ADD CONSTRAINT chk_coins_awarded CHECK (coins_awarded >= 0 AND coins_awarded <= 5000);

-- Helper: idempotent milestone insert
CREATE OR REPLACE FUNCTION _try_award(
    p_profile_id UUID,
    p_milestone_id TEXT,
    p_coins INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO profile_milestones (profile_id, milestone_id, coins_awarded)
    VALUES (p_profile_id, p_milestone_id, p_coins)
    ON CONFLICT (profile_id, milestone_id) DO NOTHING;
END;
$$;

-- Main backfill function for a single profile
CREATE OR REPLACE FUNCTION backfill_milestones_for_profile(p_profile_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    prof RECORD;
    cs RECORD;
    awarded INTEGER := 0;
    v_unique_words INTEGER;
    v_total_challenge_games INTEGER := 0;
    v_challenge_types_played INTEGER := 0;
    v_inventory_count INTEGER := 0;
    v_tw_games INTEGER := 0;
    v_tw_level INTEGER := 1;
    v_sr_games INTEGER := 0;
    v_sr_hs INTEGER := 0;
    v_wc_games INTEGER := 0;
    v_wc_hs INTEGER := 0;
    v_ws_games INTEGER := 0;
    v_ws_level INTEGER := 1;
    v_ws_hs INTEGER := 0;
    v_wr_games INTEGER := 0;
    v_wr_hs INTEGER := 0;
    v_grid_count INTEGER := 0;
BEGIN
    SELECT * INTO prof FROM profiles WHERE id = p_profile_id;
    IF NOT FOUND THEN RETURN 0; END IF;

    v_unique_words := COALESCE(array_length(prof.unique_words_found, 1), 0);

    SELECT COUNT(*) INTO v_inventory_count
    FROM profile_inventory WHERE profile_id = p_profile_id;

    FOR cs IN SELECT * FROM profile_challenge_stats WHERE profile_id = p_profile_id LOOP
        v_total_challenge_games := v_total_challenge_games + COALESCE(cs.games_played, 0);
        IF cs.games_played > 0 THEN
            v_challenge_types_played := v_challenge_types_played + 1;
        END IF;
        IF cs.challenge_type = 'target-word' THEN
            v_tw_games := COALESCE(cs.games_played, 0);
            v_tw_level := GREATEST(COALESCE(cs.target_word_level, 1), 1);
        ELSIF cs.challenge_type = 'speed-round' THEN
            v_sr_games := COALESCE(cs.games_played, 0);
            v_sr_hs := COALESCE(cs.high_score, 0);
        ELSIF cs.challenge_type = 'word-category' THEN
            v_wc_games := COALESCE(cs.games_played, 0);
            v_wc_hs := COALESCE(cs.high_score, 0);
        ELSIF cs.challenge_type = 'word-search' THEN
            v_ws_games := COALESCE(cs.games_played, 0);
            v_ws_level := GREATEST(COALESCE(cs.target_word_level, 1), 1);
            v_ws_hs := COALESCE(cs.high_score, 0);
        ELSIF cs.challenge_type = 'word-runner' THEN
            v_wr_games := COALESCE(cs.games_played, 0);
            v_wr_hs := COALESCE(cs.high_score, 0);
        END IF;
    END LOOP;

    -- Grid unlock count
    IF jsonb_typeof(prof.unlocked_grids) = 'object' THEN
        SELECT count(*) INTO v_grid_count FROM jsonb_object_keys(prof.unlocked_grids);
    END IF;

    -- UNIQUE WORDS
    IF v_unique_words >= 10    THEN PERFORM _try_award(p_profile_id, 'words_10', 5); END IF;
    IF v_unique_words >= 25    THEN PERFORM _try_award(p_profile_id, 'words_25', 8); END IF;
    IF v_unique_words >= 50    THEN PERFORM _try_award(p_profile_id, 'words_50', 15); END IF;
    IF v_unique_words >= 100   THEN PERFORM _try_award(p_profile_id, 'words_100', 25); END IF;
    IF v_unique_words >= 200   THEN PERFORM _try_award(p_profile_id, 'words_200', 40); END IF;
    IF v_unique_words >= 300   THEN PERFORM _try_award(p_profile_id, 'words_300', 50); END IF;
    IF v_unique_words >= 500   THEN PERFORM _try_award(p_profile_id, 'words_500', 60); END IF;
    IF v_unique_words >= 750   THEN PERFORM _try_award(p_profile_id, 'words_750', 75); END IF;
    IF v_unique_words >= 1000  THEN PERFORM _try_award(p_profile_id, 'words_1000', 100); END IF;
    IF v_unique_words >= 2000  THEN PERFORM _try_award(p_profile_id, 'words_2000', 150); END IF;
    IF v_unique_words >= 5000  THEN PERFORM _try_award(p_profile_id, 'words_5000', 250); END IF;
    IF v_unique_words >= 10000 THEN PERFORM _try_award(p_profile_id, 'words_10000', 500); END IF;
    IF v_unique_words >= 10   THEN PERFORM _try_award(p_profile_id, 'ej_unique_10', 3); END IF;

    -- TOTAL WORDS
    IF prof.total_words >= 1     THEN PERFORM _try_award(p_profile_id, 'ej_first_word', 2); END IF;
    IF prof.total_words >= 5     THEN PERFORM _try_award(p_profile_id, 'ej_5_words', 3); END IF;
    IF prof.total_words >= 10    THEN PERFORM _try_award(p_profile_id, 'ej_10_words', 5); END IF;
    IF prof.total_words >= 50    THEN PERFORM _try_award(p_profile_id, 'tw_50', 5); END IF;
    IF prof.total_words >= 100   THEN PERFORM _try_award(p_profile_id, 'tw_100', 8); END IF;
    IF prof.total_words >= 250   THEN PERFORM _try_award(p_profile_id, 'tw_250', 15); END IF;
    IF prof.total_words >= 500   THEN PERFORM _try_award(p_profile_id, 'tw_500', 25); END IF;
    IF prof.total_words >= 1000  THEN PERFORM _try_award(p_profile_id, 'tw_1000', 40); END IF;
    IF prof.total_words >= 2500  THEN PERFORM _try_award(p_profile_id, 'tw_2500', 60); END IF;
    IF prof.total_words >= 5000  THEN PERFORM _try_award(p_profile_id, 'tw_5000', 80); END IF;
    IF prof.total_words >= 10000 THEN PERFORM _try_award(p_profile_id, 'tw_10000', 120); END IF;
    IF prof.total_words >= 25000 THEN PERFORM _try_award(p_profile_id, 'tw_25000', 200); END IF;
    IF prof.total_words >= 50000 THEN PERFORM _try_award(p_profile_id, 'tw_50000', 400); END IF;

    -- GAMES PLAYED
    IF prof.games_played >= 1    THEN PERFORM _try_award(p_profile_id, 'games_1', 3); END IF;
    IF prof.games_played >= 5    THEN PERFORM _try_award(p_profile_id, 'games_5', 5); END IF;
    IF prof.games_played >= 5    THEN PERFORM _try_award(p_profile_id, 'ej_5_games', 5); END IF;
    IF prof.games_played >= 10   THEN PERFORM _try_award(p_profile_id, 'games_10', 12); END IF;
    IF prof.games_played >= 25   THEN PERFORM _try_award(p_profile_id, 'games_25', 20); END IF;
    IF prof.games_played >= 50   THEN PERFORM _try_award(p_profile_id, 'games_50', 40); END IF;
    IF prof.games_played >= 100  THEN PERFORM _try_award(p_profile_id, 'games_100', 75); END IF;
    IF prof.games_played >= 200  THEN PERFORM _try_award(p_profile_id, 'games_200', 100); END IF;
    IF prof.games_played >= 300  THEN PERFORM _try_award(p_profile_id, 'games_300', 125); END IF;
    IF prof.games_played >= 500  THEN PERFORM _try_award(p_profile_id, 'games_500', 175); END IF;
    IF prof.games_played >= 750  THEN PERFORM _try_award(p_profile_id, 'games_750', 225); END IF;
    IF prof.games_played >= 1000 THEN PERFORM _try_award(p_profile_id, 'games_1000', 300); END IF;
    IF prof.games_played >= 2000 THEN PERFORM _try_award(p_profile_id, 'games_2000', 500); END IF;

    -- LEVEL
    IF prof.level >= 2   THEN PERFORM _try_award(p_profile_id, 'level_2', 3); END IF;
    IF prof.level >= 2   THEN PERFORM _try_award(p_profile_id, 'ej_level_up', 3); END IF;
    IF prof.level >= 5   THEN PERFORM _try_award(p_profile_id, 'level_5', 15); END IF;
    IF prof.level >= 10  THEN PERFORM _try_award(p_profile_id, 'level_10', 30); END IF;
    IF prof.level >= 15  THEN PERFORM _try_award(p_profile_id, 'level_15', 40); END IF;
    IF prof.level >= 20  THEN PERFORM _try_award(p_profile_id, 'level_20', 50); END IF;
    IF prof.level >= 25  THEN PERFORM _try_award(p_profile_id, 'level_25', 60); END IF;
    IF prof.level >= 30  THEN PERFORM _try_award(p_profile_id, 'level_30', 70); END IF;
    IF prof.level >= 40  THEN PERFORM _try_award(p_profile_id, 'level_40', 85); END IF;
    IF prof.level >= 50  THEN PERFORM _try_award(p_profile_id, 'level_50', 100); END IF;
    IF prof.level >= 75  THEN PERFORM _try_award(p_profile_id, 'level_75', 150); END IF;
    IF prof.level >= 100 THEN PERFORM _try_award(p_profile_id, 'level_100', 200); END IF;
    IF prof.level >= 150 THEN PERFORM _try_award(p_profile_id, 'level_150', 300); END IF;
    IF prof.level >= 200 THEN PERFORM _try_award(p_profile_id, 'level_200', 400); END IF;
    IF prof.level >= 500 THEN PERFORM _try_award(p_profile_id, 'level_500', 1000); END IF;

    -- HIGH SCORE
    IF prof.high_score >= 50    THEN PERFORM _try_award(p_profile_id, 'ej_first_score', 3); END IF;
    IF prof.high_score >= 100   THEN PERFORM _try_award(p_profile_id, 'score_100', 3); END IF;
    IF prof.high_score >= 250   THEN PERFORM _try_award(p_profile_id, 'score_250', 5); END IF;
    IF prof.high_score >= 500   THEN PERFORM _try_award(p_profile_id, 'score_500', 8); END IF;
    IF prof.high_score >= 1000  THEN PERFORM _try_award(p_profile_id, 'score_1000', 12); END IF;
    IF prof.high_score >= 2000  THEN PERFORM _try_award(p_profile_id, 'score_2000', 20); END IF;
    IF prof.high_score >= 3000  THEN PERFORM _try_award(p_profile_id, 'score_3000', 30); END IF;
    IF prof.high_score >= 5000  THEN PERFORM _try_award(p_profile_id, 'score_5000', 40); END IF;
    IF prof.high_score >= 7500  THEN PERFORM _try_award(p_profile_id, 'score_7500', 55); END IF;
    IF prof.high_score >= 10000 THEN PERFORM _try_award(p_profile_id, 'score_10000', 75); END IF;
    IF prof.high_score >= 15000 THEN PERFORM _try_award(p_profile_id, 'score_15000', 100); END IF;
    IF prof.high_score >= 25000 THEN PERFORM _try_award(p_profile_id, 'score_25000', 175); END IF;
    IF prof.high_score >= 50000 THEN PERFORM _try_award(p_profile_id, 'score_50000', 350); END IF;

    -- PLAY STREAK
    IF prof.play_streak >= 2   THEN PERFORM _try_award(p_profile_id, 'streak_2', 5); END IF;
    IF prof.play_streak >= 2   THEN PERFORM _try_award(p_profile_id, 'ej_streak_start', 5); END IF;
    IF prof.play_streak >= 3   THEN PERFORM _try_award(p_profile_id, 'streak_3', 15); END IF;
    IF prof.play_streak >= 5   THEN PERFORM _try_award(p_profile_id, 'streak_5', 25); END IF;
    IF prof.play_streak >= 7   THEN PERFORM _try_award(p_profile_id, 'streak_7', 40); END IF;
    IF prof.play_streak >= 10  THEN PERFORM _try_award(p_profile_id, 'streak_10', 55); END IF;
    IF prof.play_streak >= 14  THEN PERFORM _try_award(p_profile_id, 'streak_14', 75); END IF;
    IF prof.play_streak >= 21  THEN PERFORM _try_award(p_profile_id, 'streak_21', 100); END IF;
    IF prof.play_streak >= 30  THEN PERFORM _try_award(p_profile_id, 'streak_30', 150); END IF;
    IF prof.play_streak >= 60  THEN PERFORM _try_award(p_profile_id, 'streak_60', 250); END IF;
    IF prof.play_streak >= 100 THEN PERFORM _try_award(p_profile_id, 'streak_100', 500); END IF;

    -- TOTAL XP
    IF prof.total_xp >= 50     THEN PERFORM _try_award(p_profile_id, 'ej_xp_50', 3); END IF;
    IF prof.total_xp >= 100    THEN PERFORM _try_award(p_profile_id, 'xp_100', 3); END IF;
    IF prof.total_xp >= 500    THEN PERFORM _try_award(p_profile_id, 'xp_500', 8); END IF;
    IF prof.total_xp >= 1000   THEN PERFORM _try_award(p_profile_id, 'xp_1000', 15); END IF;
    IF prof.total_xp >= 2500   THEN PERFORM _try_award(p_profile_id, 'xp_2500', 25); END IF;
    IF prof.total_xp >= 5000   THEN PERFORM _try_award(p_profile_id, 'xp_5000', 40); END IF;
    IF prof.total_xp >= 10000  THEN PERFORM _try_award(p_profile_id, 'xp_10000', 60); END IF;
    IF prof.total_xp >= 25000  THEN PERFORM _try_award(p_profile_id, 'xp_25000', 100); END IF;
    IF prof.total_xp >= 50000  THEN PERFORM _try_award(p_profile_id, 'xp_50000', 175); END IF;
    IF prof.total_xp >= 100000 THEN PERFORM _try_award(p_profile_id, 'xp_100000', 300); END IF;
    IF prof.total_xp >= 500000 THEN PERFORM _try_award(p_profile_id, 'xp_500000', 750); END IF;

    -- COINS EARNED
    IF prof.total_coins_earned >= 1    THEN PERFORM _try_award(p_profile_id, 'ej_first_coin', 2); END IF;
    IF prof.total_coins_earned >= 50   THEN PERFORM _try_award(p_profile_id, 'ce_50', 3); END IF;
    IF prof.total_coins_earned >= 100  THEN PERFORM _try_award(p_profile_id, 'ce_100', 5); END IF;
    IF prof.total_coins_earned >= 250  THEN PERFORM _try_award(p_profile_id, 'ce_250', 10); END IF;
    IF prof.total_coins_earned >= 500  THEN PERFORM _try_award(p_profile_id, 'ce_500', 20); END IF;
    IF prof.total_coins_earned >= 1000 THEN PERFORM _try_award(p_profile_id, 'ce_1000', 40); END IF;
    IF prof.total_coins_earned >= 2500 THEN PERFORM _try_award(p_profile_id, 'ce_2500', 60); END IF;
    IF prof.total_coins_earned >= 5000 THEN PERFORM _try_award(p_profile_id, 'ce_5000', 100); END IF;
    IF prof.total_coins_earned >= 10000 THEN PERFORM _try_award(p_profile_id, 'ce_10000', 150); END IF;
    IF prof.total_coins_earned >= 25000 THEN PERFORM _try_award(p_profile_id, 'ce_25000', 250); END IF;
    IF prof.total_coins_earned >= 50000 THEN PERFORM _try_award(p_profile_id, 'ce_50000', 500); END IF;

    -- COIN BALANCE
    IF prof.coins >= 100   THEN PERFORM _try_award(p_profile_id, 'bal_100', 5); END IF;
    IF prof.coins >= 250   THEN PERFORM _try_award(p_profile_id, 'bal_250', 10); END IF;
    IF prof.coins >= 500   THEN PERFORM _try_award(p_profile_id, 'bal_500', 15); END IF;
    IF prof.coins >= 1000  THEN PERFORM _try_award(p_profile_id, 'bal_1000', 25); END IF;
    IF prof.coins >= 2500  THEN PERFORM _try_award(p_profile_id, 'bal_2500', 40); END IF;
    IF prof.coins >= 5000  THEN PERFORM _try_award(p_profile_id, 'bal_5000', 60); END IF;
    IF prof.coins >= 10000 THEN PERFORM _try_award(p_profile_id, 'bal_10000', 100); END IF;
    IF prof.coins >= 25000 THEN PERFORM _try_award(p_profile_id, 'bal_25000', 200); END IF;

    -- SHOP / INVENTORY
    IF v_inventory_count >= 1  THEN PERFORM _try_award(p_profile_id, 'shop_first', 10); END IF;
    IF v_inventory_count >= 3  THEN PERFORM _try_award(p_profile_id, 'shop_3', 20); END IF;
    IF v_inventory_count >= 5  THEN PERFORM _try_award(p_profile_id, 'shop_5', 40); END IF;
    IF v_inventory_count >= 10 THEN PERFORM _try_award(p_profile_id, 'shop_10', 75); END IF;
    IF v_inventory_count >= 15 THEN PERFORM _try_award(p_profile_id, 'shop_all', 200); END IF;
    IF prof.equipped_theme IS NOT NULL AND prof.equipped_theme != 'theme_default'
        THEN PERFORM _try_award(p_profile_id, 'theme_any', 10); END IF;
    IF prof.equipped_block_style IS NOT NULL AND prof.equipped_block_style != 'block_default'
        THEN PERFORM _try_award(p_profile_id, 'block_any', 10); END IF;
    IF v_grid_count >= 1 THEN PERFORM _try_award(p_profile_id, 'grid_unlock_1', 10); END IF;
    IF v_grid_count >= 6 THEN PERFORM _try_award(p_profile_id, 'grid_unlock_all', 75); END IF;
    IF EXISTS (SELECT 1 FROM profile_inventory WHERE profile_id = p_profile_id AND item_id = 'bonus_slot_1')
        THEN PERFORM _try_award(p_profile_id, 'slot_1', 25); END IF;
    IF EXISTS (SELECT 1 FROM profile_inventory WHERE profile_id = p_profile_id AND item_id = 'bonus_slot_2')
        THEN PERFORM _try_award(p_profile_id, 'slot_2', 50); END IF;
    IF EXISTS (SELECT 1 FROM profile_inventory WHERE profile_id = p_profile_id AND item_id = 'bonus_slot_3')
        THEN PERFORM _try_award(p_profile_id, 'slot_3', 100); END IF;

    -- CHALLENGES GENERAL
    IF v_total_challenge_games >= 1 THEN PERFORM _try_award(p_profile_id, 'ch_first', 10); END IF;
    IF v_challenge_types_played >= 2 THEN PERFORM _try_award(p_profile_id, 'ch_types_2', 15); END IF;
    IF v_challenge_types_played >= 3 THEN PERFORM _try_award(p_profile_id, 'ch_types_3', 25); END IF;
    IF v_challenge_types_played >= 5 THEN PERFORM _try_award(p_profile_id, 'ch_types_5', 60); END IF;
    IF v_total_challenge_games >= 10  THEN PERFORM _try_award(p_profile_id, 'ch_games_10', 20); END IF;
    IF v_total_challenge_games >= 25  THEN PERFORM _try_award(p_profile_id, 'ch_games_25', 40); END IF;
    IF v_total_challenge_games >= 50  THEN PERFORM _try_award(p_profile_id, 'ch_games_50', 75); END IF;
    IF v_total_challenge_games >= 100 THEN PERFORM _try_award(p_profile_id, 'ch_games_100', 150); END IF;

    -- TARGET WORD
    IF v_tw_games >= 1  THEN PERFORM _try_award(p_profile_id, 'tw_play_1', 5); END IF;
    IF v_tw_games >= 5  THEN PERFORM _try_award(p_profile_id, 'tw_play_5', 15); END IF;
    IF v_tw_games >= 10 THEN PERFORM _try_award(p_profile_id, 'tw_play_10', 25); END IF;
    IF v_tw_games >= 25 THEN PERFORM _try_award(p_profile_id, 'tw_play_25', 50); END IF;
    IF v_tw_games >= 50 THEN PERFORM _try_award(p_profile_id, 'tw_play_50', 100); END IF;
    IF v_tw_level >= 3  THEN PERFORM _try_award(p_profile_id, 'tw_level_3', 10); END IF;
    IF v_tw_level >= 5  THEN PERFORM _try_award(p_profile_id, 'tw_level_5', 25); END IF;
    IF v_tw_level >= 10 THEN PERFORM _try_award(p_profile_id, 'tw_level_10', 50); END IF;
    IF v_tw_level >= 20 THEN PERFORM _try_award(p_profile_id, 'tw_level_20', 100); END IF;
    IF v_tw_level >= 50 THEN PERFORM _try_award(p_profile_id, 'tw_level_50', 250); END IF;

    -- SPEED ROUND
    IF v_sr_games >= 1  THEN PERFORM _try_award(p_profile_id, 'sr_play_1', 5); END IF;
    IF v_sr_games >= 5  THEN PERFORM _try_award(p_profile_id, 'sr_play_5', 15); END IF;
    IF v_sr_games >= 10 THEN PERFORM _try_award(p_profile_id, 'sr_play_10', 25); END IF;
    IF v_sr_games >= 25 THEN PERFORM _try_award(p_profile_id, 'sr_play_25', 50); END IF;
    IF v_sr_games >= 50 THEN PERFORM _try_award(p_profile_id, 'sr_play_50', 100); END IF;
    IF v_sr_hs >= 500   THEN PERFORM _try_award(p_profile_id, 'sr_score_500', 15); END IF;
    IF v_sr_hs >= 1000  THEN PERFORM _try_award(p_profile_id, 'sr_score_1000', 40); END IF;
    IF v_sr_hs >= 2500  THEN PERFORM _try_award(p_profile_id, 'sr_score_2500', 100); END IF;

    -- WORD CATEGORY
    IF v_wc_games >= 1  THEN PERFORM _try_award(p_profile_id, 'wc_play_1', 5); END IF;
    IF v_wc_games >= 5  THEN PERFORM _try_award(p_profile_id, 'wc_play_5', 15); END IF;
    IF v_wc_games >= 10 THEN PERFORM _try_award(p_profile_id, 'wc_play_10', 25); END IF;
    IF v_wc_games >= 25 THEN PERFORM _try_award(p_profile_id, 'wc_play_25', 50); END IF;
    IF v_wc_games >= 50 THEN PERFORM _try_award(p_profile_id, 'wc_play_50', 100); END IF;
    IF v_wc_hs >= 500   THEN PERFORM _try_award(p_profile_id, 'wc_score_500', 15); END IF;
    IF v_wc_hs >= 1000  THEN PERFORM _try_award(p_profile_id, 'wc_score_1000', 40); END IF;
    IF v_wc_hs >= 2500  THEN PERFORM _try_award(p_profile_id, 'wc_score_2500', 100); END IF;

    -- WORD SEARCH
    IF v_ws_games >= 1  THEN PERFORM _try_award(p_profile_id, 'ws_play_1', 5); END IF;
    IF v_ws_games >= 5  THEN PERFORM _try_award(p_profile_id, 'ws_play_5', 15); END IF;
    IF v_ws_games >= 10 THEN PERFORM _try_award(p_profile_id, 'ws_play_10', 25); END IF;
    IF v_ws_games >= 25 THEN PERFORM _try_award(p_profile_id, 'ws_play_25', 50); END IF;
    IF v_ws_games >= 50 THEN PERFORM _try_award(p_profile_id, 'ws_play_50', 100); END IF;
    IF v_ws_level >= 3  THEN PERFORM _try_award(p_profile_id, 'ws_level_3', 10); END IF;
    IF v_ws_level >= 5  THEN PERFORM _try_award(p_profile_id, 'ws_level_5', 25); END IF;
    IF v_ws_level >= 10 THEN PERFORM _try_award(p_profile_id, 'ws_level_10', 50); END IF;
    IF v_ws_level >= 20 THEN PERFORM _try_award(p_profile_id, 'ws_level_20', 100); END IF;
    IF v_ws_level >= 50 THEN PERFORM _try_award(p_profile_id, 'ws_level_50', 250); END IF;
    IF v_ws_hs >= 500   THEN PERFORM _try_award(p_profile_id, 'ws_score_500', 15); END IF;
    IF v_ws_hs >= 2000  THEN PERFORM _try_award(p_profile_id, 'ws_score_2000', 75); END IF;

    -- WORD RUNNER
    IF v_wr_games >= 1  THEN PERFORM _try_award(p_profile_id, 'wr_play_1', 5); END IF;
    IF v_wr_games >= 5  THEN PERFORM _try_award(p_profile_id, 'wr_play_5', 15); END IF;
    IF v_wr_games >= 10 THEN PERFORM _try_award(p_profile_id, 'wr_play_10', 25); END IF;
    IF v_wr_games >= 25 THEN PERFORM _try_award(p_profile_id, 'wr_play_25', 50); END IF;
    IF v_wr_games >= 50 THEN PERFORM _try_award(p_profile_id, 'wr_play_50', 100); END IF;
    IF v_wr_hs >= 200   THEN PERFORM _try_award(p_profile_id, 'wr_score_200', 10); END IF;
    IF v_wr_hs >= 500   THEN PERFORM _try_award(p_profile_id, 'wr_score_500', 25); END IF;
    IF v_wr_hs >= 1000  THEN PERFORM _try_award(p_profile_id, 'wr_score_1000', 60); END IF;
    IF v_wr_hs >= 2500  THEN PERFORM _try_award(p_profile_id, 'wr_score_2500', 125); END IF;
    IF v_wr_hs >= 5000  THEN PERFORM _try_award(p_profile_id, 'wr_score_5000', 250); END IF;

    -- CHALLENGE HIGH SCORES (any challenge type)
    IF GREATEST(v_sr_hs, v_wc_hs, v_ws_hs, v_wr_hs) >= 500  THEN PERFORM _try_award(p_profile_id, 'ch_hs_500', 10); END IF;
    IF GREATEST(v_sr_hs, v_wc_hs, v_ws_hs, v_wr_hs) >= 1000 THEN PERFORM _try_award(p_profile_id, 'ch_hs_1000', 25); END IF;
    IF GREATEST(v_sr_hs, v_wc_hs, v_ws_hs, v_wr_hs) >= 2500 THEN PERFORM _try_award(p_profile_id, 'ch_hs_2500', 50); END IF;
    IF GREATEST(v_sr_hs, v_wc_hs, v_ws_hs, v_wr_hs) >= 5000 THEN PERFORM _try_award(p_profile_id, 'ch_hs_5000', 100); END IF;

    -- Note: grid mastery (grid_3..grid_all), hard mode, timed mode, bestScores,
    -- and meta milestones cannot be backfilled server-side because bestScores
    -- is a client-only object. The client will check those on next app load.

    -- Rebuild claimed_milestones JSONB from profile_milestones table
    UPDATE profiles SET
        claimed_milestones = (
            SELECT COALESCE(jsonb_agg(milestone_id), '[]'::jsonb)
            FROM profile_milestones WHERE profile_id = p_profile_id
        )
    WHERE id = p_profile_id;

    SELECT count(*) INTO awarded FROM profile_milestones WHERE profile_id = p_profile_id;
    RETURN awarded;
END;
$$;

-- Batch function: backfill all profiles at once
CREATE OR REPLACE FUNCTION backfill_all_milestones()
RETURNS TABLE(profile_id UUID, username TEXT, milestones_awarded INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    prof RECORD;
BEGIN
    FOR prof IN SELECT p.id, p.username FROM profiles p LOOP
        milestones_awarded := backfill_milestones_for_profile(prof.id);
        profile_id := prof.id;
        username := prof.username;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- Run the backfill now for all existing profiles
SELECT * FROM backfill_all_milestones();
