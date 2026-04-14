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
        detectSessionInUrl: false,
    },
});

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════

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
    const { error } = await supabase
        .from('accounts')
        .upsert({ id: userId, email }, { onConflict: 'id' });
    if (error) console.warn('ensureAccountRow:', error.message);
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
    const { error } = await supabase.auth.resetPasswordForEmail(email);
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

export async function createProfile(accountId, username) {
    if (isLocalMode) return null;
    // Check if profile with same name already exists (prevent duplicates)
    const { data: existing } = await supabase
        .from('profiles')
        .select('*')
        .eq('account_id', accountId)
        .eq('username', username)
        .maybeSingle();
    if (existing) return existing;

    // Enforce profile limit
    const { count, error: countErr } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId);
    if (countErr) throw countErr;
    if (count >= MAX_PROFILES_PER_ACCOUNT) {
        throw new Error(`Maximum ${MAX_PROFILES_PER_ACCOUNT} profiles per account`);
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
// GAME SCORES
// ════════════════════════════════════════

export async function recordGameScore(scoreData) {
    if (isLocalMode) return null;
    const { data, error } = await supabase
        .from('game_scores')
        .insert(scoreData)
        .select()
        .single();
    if (error) throw error;
    return data;
}

/**
 * Atomic server-authoritative write for one completed game.
 * Persists game_scores + profile progression snapshot + challenge progression in one transaction.
 */
export async function recordGameAndSyncProfile({ profileId, scoreData, profileUpdates, challengeStats }) {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('record_game_and_sync_profile', {
        p_profile_id: profileId,
        p_score_data: scoreData || {},
        p_profile_updates: profileUpdates || {},
        p_challenge_stats: challengeStats || null,
    });
    if (error) throw error;
    return data;
}

// ════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════

export async function addInventoryItem(profileId, itemId) {
    if (isLocalMode) return null;
    const { data, error } = await supabase
        .from('profile_inventory')
        .upsert({ profile_id: profileId, item_id: itemId })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function getInventory(profileId) {
    if (isLocalMode) return [];
    const { data, error } = await supabase
        .from('profile_inventory')
        .select('item_id')
        .eq('profile_id', profileId);
    if (error) throw error;
    return (data || []).map(row => row.item_id);
}

export async function getChallengeStats(profileId) {
    if (isLocalMode) return [];
    const { data, error } = await supabase
        .from('profile_challenge_stats')
        .select('*')
        .eq('profile_id', profileId);
    if (error) throw error;
    return data || [];
}

/**
 * Fetch per-dimension high scores for a profile.
 * Returns rows from profile_high_scores, which we map back to the local `bestScores` keying scheme.
 */
export async function getHighScores(profileId) {
    if (isLocalMode) return [];
    const { data, error } = await supabase
        .from('profile_high_scores')
        .select('game_mode, is_challenge, challenge_type, category_key, grid_size, difficulty, high_score')
        .eq('profile_id', profileId);
    if (error) {
        console.warn('[supabase] getHighScores error:', error.message);
        return [];
    }
    return data || [];
}

/**
 * Fetch Word Search stats from the dedicated profile_word_search_stats table.
 * This table is updated by database triggers and may have more accurate level data.
 */
export async function getWordSearchStats(profileId) {
    if (isLocalMode) return null;
    const { data, error } = await supabase
        .from('profile_word_search_stats')
        .select('highest_level_reached, games_played, high_score, total_words_found')
        .eq('profile_id', profileId)
        .maybeSingle();
    if (error) {
        console.warn('[supabase] getWordSearchStats error:', error.message);
        return null;
    }
    return data;
}

export async function upsertChallengeStats(profileId, challengeType, stats) {
    if (isLocalMode) return null;
    
    // Fetch existing record to prevent accidental downgrades of level values
    const { data: existing } = await supabase
        .from('profile_challenge_stats')
        .select('high_score, games_played, total_words, target_word_level, unique_words_found')
        .eq('profile_id', profileId)
        .eq('challenge_type', challengeType)
        .maybeSingle();
    
    // Use the correct level field per challenge type.
    // Word Search tracks progress in wordSearchLevel; Target Word uses targetWordLevel.
    // We cannot use `stats.targetWordLevel || stats.wordSearchLevel` because targetWordLevel
    // defaults to 1 (truthy), which would always shadow wordSearchLevel.
    let newLevel;
    if (challengeType === 'word-search') {
        newLevel = stats.wordSearchLevel || 1;
    } else {
        newLevel = stats.targetWordLevel || 1;
    }
    const existingLevel = existing?.target_word_level || 1;
    const safeLevel = Math.max(newLevel, existingLevel);

    // Union unique words
    const existingWords = existing?.unique_words_found || [];
    const newWords = stats.uniqueWordsFound || [];
    const mergedWords = [...new Set([...existingWords, ...newWords])];
    
    const { data, error } = await supabase
        .from('profile_challenge_stats')
        .upsert({
            profile_id: profileId,
            challenge_type: challengeType,
            high_score: Math.max(stats.highScore || 0, existing?.high_score || 0),
            games_played: Math.max(stats.gamesPlayed || 0, existing?.games_played || 0),
            total_words: Math.max(stats.totalWords || 0, existing?.total_words || 0),
            target_word_level: safeLevel,
            unique_words_found: mergedWords,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'profile_id,challenge_type' })
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ════════════════════════════════════════
// LEADERBOARD
// ════════════════════════════════════════

export async function getLeaderboard(limit = 50, offset = 0, classFilter = null) {
    if (isLocalMode) return [];
    const { data, error } = await supabase.rpc('get_leaderboard', {
        p_limit: limit,
        p_offset: offset,
        p_class_filter: classFilter,
    });
    if (error) throw error;
    return data || [];
}

export async function getChallengeLeaderboard(challengeType, limit = 50, offset = 0, classFilter = null) {
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

export async function updateMyRanking() {
    if (isLocalMode) return;
    const { error } = await supabase.rpc('update_my_ranking');
    if (error) throw error;
}

// Note: refreshLeaderboard and refreshChallengeLeaderboards are restricted to service_role.
// Use updateMyRanking() for per-user updates after games.
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
    // Deleting the account row cascades to all data
    const user = await getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await supabase.from('accounts').delete().eq('id', user.id);
    if (error) throw error;
    await signOut();
}

// ════════════════════════════════════════
// MILESTONES
// ════════════════════════════════════════

/**
 * Record a milestone achievement. Idempotent — the UNIQUE constraint
 * on (profile_id, milestone_id) means duplicates are silently ignored.
 */
export async function recordMilestone(profileId, milestoneId, coinsAwarded) {
    if (isLocalMode) return;
    const { error } = await supabase
        .from('profile_milestones')
        .upsert(
            { profile_id: profileId, milestone_id: milestoneId, coins_awarded: coinsAwarded },
            { onConflict: 'profile_id,milestone_id', ignoreDuplicates: true }
        );
    if (error) throw error;
}

/**
 * Fetch all milestones for a profile. Returns array of { milestone_id, coins_awarded, earned_at }.
 */
export async function getProfileMilestones(profileId) {
    if (isLocalMode) return [];
    const { data, error } = await supabase
        .from('profile_milestones')
        .select('milestone_id, coins_awarded, earned_at')
        .eq('profile_id', profileId);
    if (error) throw error;
    return data || [];
}
