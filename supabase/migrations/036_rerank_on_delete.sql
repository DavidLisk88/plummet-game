-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 036 — Recompute leaderboard ranks after row deletion      ║
-- ║                                                                      ║
-- ║  When a leaderboard_rankings row is deleted (via CASCADE or direct),  ║
-- ║  the remaining global_rank and class_rank values have gaps.           ║
-- ║  This trigger recomputes them so ranks stay sequential.               ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION rerank_leaderboard_after_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- Recompute global ranks
    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY skill_rating DESC) AS rn
        FROM leaderboard_rankings
    )
    UPDATE leaderboard_rankings lr SET global_rank = ranked.rn
    FROM ranked WHERE lr.id = ranked.id;

    -- Recompute class ranks
    WITH class_ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY skill_class ORDER BY skill_rating DESC) AS crn
        FROM leaderboard_rankings
    )
    UPDATE leaderboard_rankings lr SET class_rank = class_ranked.crn
    FROM class_ranked WHERE lr.id = class_ranked.id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Fire once per statement (not per row) to avoid redundant reranks on bulk deletes
CREATE TRIGGER trg_rerank_after_delete
    AFTER DELETE ON leaderboard_rankings
    FOR EACH STATEMENT
    EXECUTE FUNCTION rerank_leaderboard_after_delete();

-- Also add the same for challenge_leaderboards
CREATE OR REPLACE FUNCTION rerank_challenges_after_delete()
RETURNS TRIGGER AS $$
BEGIN
    WITH ranked AS (
        SELECT id, challenge_type,
               ROW_NUMBER() OVER (PARTITION BY challenge_type ORDER BY challenge_skill_rating DESC) AS rn
        FROM challenge_leaderboards
    )
    UPDATE challenge_leaderboards cl SET global_rank = ranked.rn
    FROM ranked WHERE cl.id = ranked.id;

    WITH class_ranked AS (
        SELECT id, challenge_type,
               ROW_NUMBER() OVER (PARTITION BY challenge_type, skill_class ORDER BY challenge_skill_rating DESC) AS crn
        FROM challenge_leaderboards
    )
    UPDATE challenge_leaderboards cl SET class_rank = class_ranked.crn
    FROM class_ranked WHERE cl.id = class_ranked.id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_rerank_challenges_after_delete
    AFTER DELETE ON challenge_leaderboards
    FOR EACH STATEMENT
    EXECUTE FUNCTION rerank_challenges_after_delete();
