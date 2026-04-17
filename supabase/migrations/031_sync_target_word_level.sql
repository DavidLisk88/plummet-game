-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 031 — Sync target_word_level across all grid sizes       ║
-- ║                                                                      ║
-- ║  FIX: target_word_level was per-row (per grid_size), so switching   ║
-- ║  grids would "reset" the level to that row's local count.           ║
-- ║  Level should be global: 1 + SUM(total_targets_completed) across    ║
-- ║  ALL grid sizes for the profile.                                     ║
-- ╚══════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════════
-- PART 1: Trigger to keep target_word_level in sync across all grid rows
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_sync_target_word_level()
RETURNS TRIGGER AS $$
DECLARE
    v_global_level INTEGER;
BEGIN
    -- Prevent infinite recursion: the UPDATE below will fire this trigger
    -- again, but at depth > 1 we just bail out.
    IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

    -- Compute global level = 1 + total targets across ALL grid sizes
    SELECT 1 + COALESCE(SUM(s.total_targets_completed), 0)
    INTO v_global_level
    FROM challenge_target_word_stats s
    WHERE s.profile_id = NEW.profile_id;

    -- Sync ALL rows for this profile to the global level
    UPDATE challenge_target_word_stats
    SET target_word_level = v_global_level
    WHERE profile_id = NEW.profile_id
      AND target_word_level IS DISTINCT FROM v_global_level;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists (idempotent)
DROP TRIGGER IF EXISTS sync_target_word_level ON challenge_target_word_stats;

-- Fire after INSERT or UPDATE of total_targets_completed
CREATE TRIGGER sync_target_word_level
AFTER INSERT OR UPDATE OF total_targets_completed ON challenge_target_word_stats
FOR EACH ROW
EXECUTE FUNCTION trg_sync_target_word_level();


-- ════════════════════════════════════════════════════════════════════════
-- PART 2: Fix existing stale data — set every row to the global level
-- ════════════════════════════════════════════════════════════════════════

UPDATE challenge_target_word_stats t
SET target_word_level = sub.global_level
FROM (
    SELECT profile_id, 1 + COALESCE(SUM(total_targets_completed), 0) AS global_level
    FROM challenge_target_word_stats
    GROUP BY profile_id
) sub
WHERE t.profile_id = sub.profile_id
  AND t.target_word_level IS DISTINCT FROM sub.global_level;
