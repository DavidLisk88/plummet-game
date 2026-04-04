CREATE OR REPLACE FUNCTION get_player_analysis_data(p_profile_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    v_profile RECORD;
    v_skill RECORD;
BEGIN
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
