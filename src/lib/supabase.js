/**
 * supabase.js — Supabase client for PLUMMET
 * 
 * Handles auth, profile CRUD, game score recording, and leaderboard queries.
 * Always connects to Supabase when credentials are available.
 * The anon key is public (RLS-protected) — safe to embed.
 */
import { createClient } from '@supabase/supabase-js';

// ── Environment config ──
// Hardcoded fallbacks ensure every environment (dev, preview, prod) connects.
// The anon key is public by design — Row Level Security controls all access.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://gwzdevcespqtrhivkegf.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3emRldmNlc3BxdHJoaXZrZWdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNTA4NTIsImV4cCI6MjA5MDgyNjg1Mn0._dkO4Q4A56XZ707dn5mUae3MHVqbw3GiatN1gTntkZo';

export const isLocalMode = false; // Always connected — no silent localStorage-only fallback

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
    },
});

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════

/**
 * Sign in anonymously — creates a lightweight Supabase auth user with no email/password.
 * The user gets a real auth.uid() so all RLS policies work normally.
 * Returns the session data.
 */
export async function signInAnonymously() {
    if (isLocalMode) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    const user = data.session?.user || data.user;
    if (user) {
        await ensureAccountRow(user.id, null); // no email for anon users
    }
    return data;
}

/**
 * Check if the current auth user is anonymous (no email/password linked).
 */
export async function isAnonymousUser() {
    if (isLocalMode) return false;
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) return false;
    return user.is_anonymous === true;
}

/**
 * Convert an anonymous account to a real account by linking email + password.
 * Supabase promotes the anonymous user — same UUID, all data preserved.
 *
 * Follows the official two-step process from Supabase docs:
 *   Step 1: updateUser({ email })    → links the email identity
 *   Step 2: updateUser({ password }) → sets the password (requires email linked first)
 *
 * REQUIRED Supabase Dashboard settings (Authentication → Settings):
 *   1. "Allow anonymous sign-ins" → ON
 *   2. "Enable manual linking" → ON  (required for anonymous → permanent conversion)
 *   3. "Secure email change" → OFF   (we verify email ourselves via custom OTP;
 *      if ON, Supabase sends a SECOND confirmation email and blocks the upgrade
 *      until the user clicks that link — causing a confusing double-verification)
 */
export async function linkEmailPassword(email, password) {
    if (isLocalMode) throw new Error('Supabase not configured');

    // Step 1: Link the email identity to the anonymous user
    // With "Secure email change" OFF, this is instant (no Supabase confirmation email)
    const { data: emailData, error: emailError } = await supabase.auth.updateUser({ email });
    if (emailError) throw emailError;

    // Verify the email was actually linked (not pending confirmation)
    const emailUser = emailData?.user;
    if (emailUser && !emailUser.email && emailUser.new_email === email) {
        throw new Error(
            'Email is pending Supabase confirmation. ' +
            'Disable "Secure email change" in Supabase Dashboard → Auth → Settings.'
        );
    }

    // Step 2: Set the password (email must be linked/verified first per Supabase docs)
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    const user = data?.user;
    if (!user) throw new Error('No user returned after setting password');

    // Step 3: Update our accounts table with the real email
    const { error: updateErr } = await supabase.from('accounts').update({ email }).eq('id', user.id);
    if (updateErr) {
        console.error('[auth] Failed to update accounts.email:', updateErr.message);
        throw new Error('Account upgraded but email sync failed. Please try again.');
    }
    return data;
}

export async function signUp(email, password) {
    if (isLocalMode) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    // Create the accounts row client-side (no trigger on auth.users)
    const user = data.session?.user || data.user;
    if (user) {
        await ensureAccountRow(user.id, user.email);
    }
    return data;
}

export async function ensureAccountRow(userId, email) {
    if (isLocalMode || !userId) return;
    const row = { id: userId };
    if (email) row.email = email;
    const { error } = await supabase
        .from('accounts')
        .upsert(row, { onConflict: 'id' });
    if (error) {
        // This will fail if migration 034 hasn't been run and email is null (NOT NULL constraint)
        console.error('[auth] ensureAccountRow failed:', error.message);
        throw error;
    }
}

export async function signIn(email, password) {
    if (isLocalMode) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Ensure accounts row exists (backfill for users created before client-side creation)
    const user = data.session?.user || data.user;
    if (user) {
        await ensureAccountRow(user.id, user.email);
    }
    return data;
}

export async function signOut() {
    if (isLocalMode) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

export async function getSession() {
    if (isLocalMode) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session || null;
}

export async function getUser() {
    if (isLocalMode) return null;
    const { data } = await supabase.auth.getUser();
    return data?.user || null;
}

export function onAuthStateChange(callback) {
    if (isLocalMode) return { data: { subscription: { unsubscribe: () => {} } } };
    return supabase.auth.onAuthStateChange(callback);
}

export async function resetPassword(email) {
    if (isLocalMode) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://plummet.netlify.app/',
    });
    if (error) throw error;
}

export async function updatePassword(newPassword) {
    if (isLocalMode) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
}

// ════════════════════════════════════════
// PROFILES
// ════════════════════════════════════════

export async function getProfiles(accountId) {
    if (isLocalMode) return [];
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

const MAX_PROFILES_PER_ACCOUNT = 3;
const MAX_PROFILES_ANONYMOUS = 1;

export async function createProfile(accountId, username, isAnonymous = false) {
    if (isLocalMode) return null;
    // Check if profile with same name already exists (prevent duplicates)
    const { data: existingList } = await supabase
        .from('profiles')
        .select('*')
        .eq('account_id', accountId)
        .eq('username', username)
        .limit(1);
    if (existingList && existingList.length > 0) return existingList[0];

    // Enforce profile limit — 1 for anonymous, 3 for real accounts
    const maxProfiles = isAnonymous ? MAX_PROFILES_ANONYMOUS : MAX_PROFILES_PER_ACCOUNT;
    const { count, error: countErr } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId);
    if (countErr) throw countErr;
    if (count >= maxProfiles) {
        throw new Error(isAnonymous
            ? 'Sign up for an account to create more profiles (up to 3)!'
            : `Maximum ${MAX_PROFILES_PER_ACCOUNT} profiles per account`);
    }

    const { data, error } = await supabase
        .from('profiles')
        .insert({ account_id: accountId, username })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function updateProfile(profileId, updates) {
    if (isLocalMode) return null;
    const { data, error } = await supabase
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', profileId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteProfile(profileId) {
    if (isLocalMode) return;
    const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', profileId);
    if (error) throw error;
}

/**
 * Check if a username is already taken by any active profile (across all accounts).
 * Uses a SECURITY DEFINER RPC to bypass RLS (which normally restricts reads to own account).
 * @param {string} username - The username to check
 * @param {string|null} excludeProfileId - Cloud profile ID to exclude from the check
 * @returns {Promise<boolean>} true if available, false if taken
 */
export async function checkUsernameAvailable(username, excludeProfileId = null) {
    if (isLocalMode) return true;
    const { data, error } = await supabase.rpc('check_username_available', {
        p_username: username,
        p_exclude_profile_id: excludeProfileId,
    });
    if (error) throw error;
    return data === true;
}

// ════════════════════════════════════════
// GAME RECORDING (aggregate tables)
// ════════════════════════════════════════

/**
 * Atomic server-authoritative write for one completed game.
 * Upserts the mode-specific aggregate table + profile_game_stats,
 * updates game_history JSONB, recomputes skill_rating, and refreshes rankings.
 * Returns { success, games_played, high_score, total_words, skill_rating, is_new_high_score }.
 */
export async function recordGame({
    profileId, gameMode, isChallenge, challengeType, categoryKey,
    gridSize, difficulty, timeLimitSeconds, score, wordsFound,
    longestWordLength, bestCombo, targetWordsCompleted, bonusWordsCompleted,
    timeRemainingSeconds, xpEarned, coinsEarned, gridFactor,
    difficultyMultiplier, modeMultiplier,
    wsPlacedWords, wsLevel, wsIsPerfectClear, wsClearSeconds,
}) {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('record_game', {
        p_profile_id: profileId,
        p_game_mode: gameMode,
        p_is_challenge: isChallenge || false,
        p_challenge_type: challengeType || null,
        p_category_key: categoryKey || null,
        p_grid_size: gridSize ?? null,
        p_difficulty: difficulty || null,
        p_time_limit_seconds: timeLimitSeconds ?? null,
        p_score: score ?? 0,
        p_words_found: wordsFound ?? 0,
        p_longest_word_length: longestWordLength ?? 0,
        p_best_combo: bestCombo ?? 0,
        p_target_words_completed: targetWordsCompleted ?? 0,
        p_bonus_words_completed: bonusWordsCompleted ?? 0,
        p_time_remaining_seconds: timeRemainingSeconds ?? null,
        p_xp_earned: xpEarned ?? 0,
        p_coins_earned: coinsEarned ?? 0,
        p_grid_factor: gridFactor ?? 1.0,
        p_difficulty_multiplier: difficultyMultiplier ?? 1.0,
        p_mode_multiplier: modeMultiplier ?? 1.0,
        p_ws_placed_words: wsPlacedWords ?? null,
        p_ws_level: wsLevel ?? null,
        p_ws_is_perfect_clear: wsIsPerfectClear || false,
        p_ws_clear_seconds: wsClearSeconds ?? null,
    });
    if (error) throw error;
    return data;
}

// ════════════════════════════════════════
// INVENTORY (via RPC)
// ════════════════════════════════════════

export async function addInventoryItem(profileId, itemId, cost = 0) {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('add_inventory_item', {
        p_profile_id: profileId,
        p_item_id: itemId,
        p_cost: cost,
    });
    if (error) throw error;
    return data;
}

export async function getInventory(profileId) {
    if (isLocalMode) return [];
    const { data, error } = await supabase.rpc('get_inventory', {
        p_profile_id: profileId,
    });
    if (error) throw error;
    // RPC returns a JSONB array of item_id strings
    return data || [];
}

/**
 * Fetch challenge stats for a profile from the new per-challenge aggregate tables.
 * Returns an array of objects shaped like the old profile_challenge_stats rows
 * so the merge logic in script.js works without changes.
 * Some tables have multiple rows per profile (per grid_size or category_key),
 * so we aggregate across all dimensions to produce one summary per challenge type.
 */
export async function getChallengeStats(profileId) {
    if (isLocalMode) return [];
    const results = [];

    // Target Word — keyed by (profile_id, grid_size), aggregate across grid sizes
    const { data: twRows } = await supabase
        .from('challenge_target_word_stats')
        .select('games_played, high_score, total_words, target_word_level')
        .eq('profile_id', profileId);
    if (twRows?.length) {
        let highScore = 0, gamesPlayed = 0, totalWords = 0, targetWordLevel = 1;
        for (const r of twRows) {
            highScore = Math.max(highScore, r.high_score || 0);
            gamesPlayed += r.games_played || 0;
            totalWords += r.total_words || 0;
            targetWordLevel = Math.max(targetWordLevel, r.target_word_level || 1);
        }
        results.push({
            challenge_type: 'target-word',
            high_score: highScore,
            games_played: gamesPlayed,
            total_words: totalWords,
            target_word_level: targetWordLevel,
            unique_words_found: [],
        });
    }

    // Speed Round — keyed by (profile_id, grid_size), aggregate across grid sizes
    const { data: srRows } = await supabase
        .from('challenge_speed_round_stats')
        .select('games_played, high_score, total_words')
        .eq('profile_id', profileId);
    if (srRows?.length) {
        let highScore = 0, gamesPlayed = 0, totalWords = 0;
        for (const r of srRows) {
            highScore = Math.max(highScore, r.high_score || 0);
            gamesPlayed += r.games_played || 0;
            totalWords += r.total_words || 0;
        }
        results.push({
            challenge_type: 'speed-round',
            high_score: highScore,
            games_played: gamesPlayed,
            total_words: totalWords,
            target_word_level: 1,
            unique_words_found: [],
        });
    }

    // Word Category — keyed by (profile_id, grid_size, category_key), aggregate across all
    const { data: wcRows } = await supabase
        .from('challenge_word_category_stats')
        .select('games_played, high_score, total_words')
        .eq('profile_id', profileId);
    if (wcRows?.length) {
        let highScore = 0, gamesPlayed = 0, totalWords = 0;
        for (const r of wcRows) {
            highScore = Math.max(highScore, r.high_score || 0);
            gamesPlayed += r.games_played || 0;
            totalWords += r.total_words || 0;
        }
        results.push({
            challenge_type: 'word-category',
            high_score: highScore,
            games_played: gamesPlayed,
            total_words: totalWords,
            target_word_level: 1,
            unique_words_found: [],
        });
    }

    // Word Search — single row per profile
    const { data: ws } = await supabase
        .from('challenge_word_search_stats')
        .select('games_played, high_score, total_words, highest_level_reached')
        .eq('profile_id', profileId)
        .maybeSingle();
    if (ws) results.push({
        challenge_type: 'word-search',
        high_score: ws.high_score || 0,
        games_played: ws.games_played || 0,
        total_words: ws.total_words || 0,
        target_word_level: ws.highest_level_reached || 1,
        unique_words_found: [],
    });

    // Word Runner — single row per profile
    const { data: wr } = await supabase
        .from('challenge_word_runner_stats')
        .select('games_played, high_score, total_words')
        .eq('profile_id', profileId)
        .maybeSingle();
    if (wr) results.push({
        challenge_type: 'word-runner',
        high_score: wr.high_score || 0,
        games_played: wr.games_played || 0,
        total_words: wr.total_words || 0,
        target_word_level: 1,
        unique_words_found: [],
    });

    return results;
}

/**
 * Fetch per-dimension high scores from the mode-specific aggregate tables.
 * Returns rows shaped like the old profile_high_scores table for backward compat
 * with the bestScores merge logic in script.js.
 */
export async function getHighScores(profileId) {
    if (isLocalMode) return [];
    const rows = [];

    const { data: sandbox } = await supabase
        .from('sandbox_grid_stats')
        .select('grid_size, difficulty, high_score')
        .eq('profile_id', profileId);
    if (sandbox) {
        for (const r of sandbox) {
            rows.push({ game_mode: 'sandbox', is_challenge: false, challenge_type: null, category_key: null, grid_size: r.grid_size, difficulty: r.difficulty, high_score: r.high_score });
        }
    }

    const { data: timed } = await supabase
        .from('timed_grid_stats')
        .select('grid_size, difficulty, high_score')
        .eq('profile_id', profileId);
    if (timed) {
        for (const r of timed) {
            rows.push({ game_mode: 'timed', is_challenge: false, challenge_type: null, category_key: null, grid_size: r.grid_size, difficulty: r.difficulty, high_score: r.high_score });
        }
    }

    // Challenge modes — aggregate per-grid rows into one high score per challenge type
    const challengeTables = [
        { table: 'challenge_target_word_stats', type: 'target-word' },
        { table: 'challenge_speed_round_stats', type: 'speed-round' },
        { table: 'challenge_word_category_stats', type: 'word-category' },
        { table: 'challenge_word_search_stats', type: 'word-search' },
        { table: 'challenge_word_runner_stats', type: 'word-runner' },
    ];
    for (const { table, type } of challengeTables) {
        const { data: chRows } = await supabase
            .from(table)
            .select('high_score')
            .eq('profile_id', profileId);
        if (chRows?.length) {
            const maxScore = Math.max(...chRows.map(r => r.high_score || 0));
            rows.push({ game_mode: 'sandbox', is_challenge: true, challenge_type: type, category_key: null, grid_size: null, difficulty: null, high_score: maxScore });
        }
    }

    return rows;
}

/**
 * Fetch Word Search stats from the challenge_word_search_stats aggregate table.
 */
export async function getWordSearchStats(profileId) {
    if (isLocalMode) return null;
    const { data, error } = await supabase
        .from('challenge_word_search_stats')
        .select('highest_level_reached, games_played, high_score, total_words')
        .eq('profile_id', profileId)
        .maybeSingle();
    if (error) {
        console.warn('[supabase] getWordSearchStats error:', error.message);
        return null;
    }
    if (!data) return null;
    // Map to the shape expected by _mergeCloudIntoLocal (uses total_words_found)
    return {
        highest_level_reached: data.highest_level_reached,
        games_played: data.games_played,
        high_score: data.high_score,
        total_words_found: data.total_words,
    };
}

// upsertChallengeStats is no longer needed — record_game() handles all challenge stat updates.

// ════════════════════════════════════════
// LEADERBOARD
// ════════════════════════════════════════

export async function getLeaderboard(limit = 1000, offset = 0, classFilter = null) {
    if (isLocalMode) return [];
    const { data, error } = await supabase.rpc('get_leaderboard', {
        p_limit: limit,
        p_offset: offset,
        p_class_filter: classFilter,
    });
    if (error) throw error;
    return data || [];
}

export async function getChallengeLeaderboard(challengeType, limit = 1000, offset = 0, classFilter = null) {
    if (isLocalMode) return [];
    const { data, error } = await supabase.rpc('get_challenge_leaderboard', {
        p_challenge_type: challengeType,
        p_limit: limit,
        p_offset: offset,
        p_class_filter: classFilter,
    });
    if (error) throw error;
    return data || [];
}

export async function getMyRank() {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('get_my_rank');
    if (error) throw error;
    return data?.[0] || null;
}

export async function getMyChallengeRank(challengeType) {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('get_my_challenge_rank', {
        p_challenge_type: challengeType,
    });
    if (error) throw error;
    return data?.[0] || null;
}

export async function getChallengeAnalysisData(profileId, challengeType) {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('get_challenge_analysis_data', {
        p_profile_id: profileId,
        p_challenge_type: challengeType,
    });
    if (error) throw error;
    return data;
}

// updateMyRanking is now called internally by record_game().
// Kept as a manual fallback for edge cases (e.g. initial ranking after migration).
export async function updateMyRanking() {
    if (isLocalMode) return;
    const { error } = await supabase.rpc('update_my_ranking');
    if (error) throw error;
}

// Note: refreshLeaderboard and refreshChallengeLeaderboards are restricted to service_role.
// Use updateMyRanking() for per-user updates after games.
// Use refreshMyStats() to un-stale PGS skill_rating + leaderboard ranking.
export async function refreshMyStats() {
    if (isLocalMode) return { success: true, profiles_updated: 0 };
    const { data, error } = await supabase.rpc('refresh_my_stats');
    if (error) throw error;
    return data;
}

export async function refreshLeaderboard() {
    if (isLocalMode) return;
    const { error } = await supabase.rpc('refresh_leaderboard');
    if (error) throw error;
}

export async function refreshChallengeLeaderboards() {
    if (isLocalMode) return;
    const { error } = await supabase.rpc('refresh_challenge_leaderboards');
    if (error) throw error;
}

// ════════════════════════════════════════
// PLAYER ANALYSIS (for AI-generated text)
// ════════════════════════════════════════

export async function getPlayerAnalysisData(profileId) {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('get_player_analysis_data', {
        p_profile_id: profileId,
    });
    if (error) throw error;
    return data;
}

// ════════════════════════════════════════
// DELETE ACCOUNT
// ════════════════════════════════════════

export async function deleteAccount() {
    if (isLocalMode) return;
    const user = await getUser();
    if (!user) throw new Error('Not authenticated');
    // RPC deletes accounts row (cascade) + auth.users row (frees email)
    const { error } = await supabase.rpc('delete_own_account');
    if (error) throw error;
    await signOut();
}

// ════════════════════════════════════════
// MILESTONES (via RPC)
// ════════════════════════════════════════

/**
 * Record a milestone achievement via the record_milestone RPC.
 * Deduplicates server-side — safe to call multiple times for the same milestone.
 */
export async function recordMilestone(profileId, milestoneId, coinsAwarded) {
    if (isLocalMode) return;
    const { data, error } = await supabase.rpc('record_milestone', {
        p_profile_id: profileId,
        p_milestone_id: milestoneId,
        p_coins_awarded: coinsAwarded || 0,
    });
    if (error) throw error;
    return data;
}

/**
 * Fetch all milestones for a profile via the get_milestones RPC.
 * Returns array of { id, earned_at, coins_awarded }.
 */
export async function getProfileMilestones(profileId) {
    if (isLocalMode) return [];
    const { data, error } = await supabase.rpc('get_milestones', {
        p_profile_id: profileId,
    });
    if (error) throw error;
    // RPC returns JSONB array of {id, earned_at, coins_awarded}
    const milestones = data || [];
    // Map to the shape expected by script.js (_loadMilestonesFromCloud)
    return milestones.map(m => ({
        milestone_id: m.id,
        earned_at: m.earned_at,
        coins_awarded: m.coins_awarded,
    }));
}
