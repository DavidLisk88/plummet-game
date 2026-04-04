// ============================================================
// EMAIL VERIFICATION — One-time signup verification codes
// ============================================================
// Generates 5-digit numeric codes, stored in localStorage.
// Each code is unique to an email and expires after 30 minutes.
// ============================================================

const STORE_KEY = 'plummet_verification_codes';
const CODE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

function getStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch { return {}; }
}

function saveStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

/**
 * Generate a unique 5-digit verification code for an email.
 * Overwrites any existing code for that email.
 */
export function generateVerificationCode(email) {
  const key = email.toLowerCase().trim();
  const code = String(Math.floor(10000 + Math.random() * 90000));
  const store = getStore();
  store[key] = { code, expiresAt: Date.now() + CODE_EXPIRY_MS };
  saveStore(store);
  return code;
}

/**
 * Verify a code against the stored code for an email.
 * Returns { valid: true } or { valid: false, error: string }.
 * Successful verification consumes the code.
 */
export function verifyCode(email, inputCode) {
  const key = email.toLowerCase().trim();
  const store = getStore();
  const entry = store[key];

  if (!entry) {
    return { valid: false, error: 'No verification code found. Please request a new one.' };
  }
  if (Date.now() > entry.expiresAt) {
    delete store[key];
    saveStore(store);
    return { valid: false, error: 'Verification code has expired. Please request a new one.' };
  }
  if (entry.code !== inputCode.trim()) {
    return { valid: false, error: 'Incorrect verification code. Please try again.' };
  }

  // Consume the code on success
  delete store[key];
  saveStore(store);
  return { valid: true };
}

/**
 * Get remaining seconds until a code expires for an email.
 * Returns 0 if no code or already expired.
 */
export function getCodeTTL(email) {
  const key = email.toLowerCase().trim();
  const store = getStore();
  const entry = store[key];
  if (!entry) return 0;
  const remaining = Math.max(0, entry.expiresAt - Date.now());
  return Math.ceil(remaining / 1000);
}
