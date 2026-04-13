-- ═══════════════════════════════════════════════════════════════════
-- Migration 015: Profile Milestones Table
-- Tracks individual milestone achievements with timestamps.
-- The profiles.claimed_milestones JSONB column remains the source
-- of truth for game logic; this table provides richer analytics
-- and powers the Milestones page with earned_at timestamps.
-- ═══════════════════════════════════════════════════════════════════

-- ── Table ──
CREATE TABLE IF NOT EXISTS profile_milestones (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    milestone_id  TEXT NOT NULL,
    coins_awarded INTEGER NOT NULL DEFAULT 0,
    earned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_profile_milestone UNIQUE (profile_id, milestone_id),
    CONSTRAINT chk_milestone_id     CHECK (char_length(milestone_id) BETWEEN 1 AND 64),
    CONSTRAINT chk_coins_awarded    CHECK (coins_awarded >= 0 AND coins_awarded <= 1000)
);

-- ── Index for fast lookups by profile ──
CREATE INDEX IF NOT EXISTS idx_profile_milestones_profile
    ON profile_milestones (profile_id);

-- ── RLS ──
ALTER TABLE profile_milestones ENABLE ROW LEVEL SECURITY;

-- Players can read their own milestones
CREATE POLICY "Users can view own milestones"
    ON profile_milestones FOR SELECT
    USING (
        profile_id IN (
            SELECT id FROM profiles WHERE account_id = auth.uid()
        )
    );

-- Players can insert their own milestones (idempotent via UNIQUE constraint)
CREATE POLICY "Users can record own milestones"
    ON profile_milestones FOR INSERT
    WITH CHECK (
        profile_id IN (
            SELECT id FROM profiles WHERE account_id = auth.uid()
        )
    );

-- No UPDATE or DELETE policies — milestones are permanent
