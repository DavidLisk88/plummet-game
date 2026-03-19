/* ========================================
   PLUMMET - Game Logic
   Pure vanilla JS, no dependencies.
   ======================================== */

// ────────────────────────────────────────
// DICTIONARY
// Loaded at startup from words.json (bundled, uppercase, 3+ letters).
// ────────────────────────────────────────
let DICTIONARY = new Set();
// Sets used for hint detection: sequences one letter away from a complete word
let HINT_PREFIXES = new Set(); // word.slice(0,-1): add one letter at the END to complete
let HINT_SUFFIXES = new Set(); // word.slice(1):    add one letter at the START to complete

function _buildHintSets() {
    HINT_PREFIXES = new Set();
    HINT_SUFFIXES = new Set();
    for (const word of DICTIONARY) {
        if (word.length >= 4) {
            HINT_PREFIXES.add(word.slice(0, -1));
            HINT_SUFFIXES.add(word.slice(1));
        }
    }
}

// ── Load dictionary from the bundled words.json ──

async function loadDictionary() {
    try {
        const resp = await fetch("./words.json");
        if (!resp.ok) throw new Error(`words.json fetch failed: ${resp.status}`);
        const words = await resp.json();        // Already uppercase, 3+ letters, deduplicated
        DICTIONARY = new Set(words);
        console.log(`Dictionary ready: ${DICTIONARY.size} valid words`);
    } catch (err) {
        console.error("Failed to load words.json; no words will be valid.", err);
        DICTIONARY = new Set();
    }
    _buildHintSets();
}

// ────────────────────────────────────────
// LETTER FREQUENCY WEIGHTS
// Tuned for playability: vowels very common, common consonants
// frequent, rare letters (Q, X, Z, J) almost never appear.
// ────────────────────────────────────────
const LETTER_WEIGHTS = (() => {
    // weight per letter – higher = more frequent
    const freq = {
        A:12, B:3, C:4, D:4, E:14, F:3, G:3, H:3, I:10, J:1,
        K:2,  L:6, M:4, N:7, O:10, P:4, Q:1, R:8, S:8, T:8,
        U:6,  V:2, W:3, X:1, Y:3, Z:1
    };
    const pool = [];
    for (const [ch, count] of Object.entries(freq)) {
        for (let i = 0; i < count; i++) pool.push(ch);
    }
    return pool;
})();

// Track recent letters to avoid repetition
const _recentLetters = [];
const _RECENT_MAX = 4; // don't repeat any of the last 4 letters

function randomLetter() {
    // Try up to 20 times to pick a letter not in recent history
    for (let attempt = 0; attempt < 20; attempt++) {
        const letter = LETTER_WEIGHTS[Math.floor(Math.random() * LETTER_WEIGHTS.length)];
        if (!_recentLetters.includes(letter)) {
            _recentLetters.push(letter);
            if (_recentLetters.length > _RECENT_MAX) _recentLetters.shift();
            return letter;
        }
    }
    // Fallback: pick anything (shouldn't normally happen)
    const letter = LETTER_WEIGHTS[Math.floor(Math.random() * LETTER_WEIGHTS.length)];
    _recentLetters.push(letter);
    if (_recentLetters.length > _RECENT_MAX) _recentLetters.shift();
    return letter;
}

function isWordLetter(value) {
    return typeof value === "string" && /^[A-Z]$/.test(value);
}

const BONUS_TYPES = Object.freeze({
    LETTER_PICK: "letter-pick",
    BOMB: "bomb",
});

const GAME_MODES = Object.freeze({
    SANDBOX: "sandbox",
    TIMED: "timed",
});

const TIMED_MODE_OPTIONS_MINUTES = [1, 3, 5, 8, 10, 15, 20];

const BONUS_TYPE_POOL = [
    BONUS_TYPES.LETTER_PICK,
    BONUS_TYPES.BOMB,
];

const BOMB_SYMBOL = "💣";
const BONUS_UNLOCK_SCORE_INTERVAL = 1000;
const STANDARD_CLEAR_FLASH_DURATION = 1.2;
const BOMB_CLEAR_FLASH_DURATION = 1.8;

const BONUS_METADATA = Object.freeze({
    [BONUS_TYPES.LETTER_PICK]: {
        buttonLabel: "Bonus: Letter",
        buttonTitle: "Choose the next falling letter",
        modalTitle: "Choose Your Letter",
        modalText: "Pick the next falling letter for this drop.",
        acceptLabel: "",
        previewSymbol: "",
    },
    [BONUS_TYPES.BOMB]: {
        buttonLabel: "Bonus: Bomb",
        buttonTitle: "Replace the current falling letter with a bomb",
        modalTitle: "Bomb Bonus",
        modalText: "Accept to swap the current falling letter for a bomb. When it lands, every occupied cell in its row and column will explode and clear.",
        acceptLabel: "Accept",
        previewSymbol: BOMB_SYMBOL,
    },
});

function getMusicControlIcon(iconName) {
    const icons = {
        play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10-6.5z"/></svg>',
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
        prev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="5" width="2.2" height="14" rx="1"/><path d="M18.2 6v12l-8.1-6z"/><path d="M10.6 6v12l-8.1-6z"/></svg>',
        next: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="17.8" y="5" width="2.2" height="14" rx="1"/><path d="M5.8 6v12l8.1-6z"/><path d="M13.4 6v12l8.1-6z"/></svg>',
    };
    return icons[iconName] || "";
}

function shuffleList(items) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const swapIndex = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[i]];
    }
    return shuffled;
}

function drawRandomBonusType(bonusBag, lastBonusType = null) {
    let nextBag = Array.isArray(bonusBag) ? [...bonusBag] : [];

    if (nextBag.length === 0) {
        nextBag = shuffleList(BONUS_TYPE_POOL);
        if (lastBonusType && nextBag.length > 1 && nextBag[0] === lastBonusType) {
            [nextBag[0], nextBag[1]] = [nextBag[1], nextBag[0]];
        }
    }

    const bonusType = nextBag.shift();
    return { bonusType, nextBag };
}

// Number of buffer rows above the grid where the block is visible but outside play area
const BUFFER_ROWS = 2;

// ────────────────────────────────────────
// GAME STATES
// ────────────────────────────────────────
const State = Object.freeze({ MENU: 0, PLAYING: 1, PAUSED: 2, CLEARING: 3, GAMEOVER: 4 });

// ────────────────────────────────────────
// AUDIO MANAGER  (Web Audio API, no files)
// ────────────────────────────────────────
class AudioManager {
    constructor() {
        this.muted = false;
        this.ctx = null;
    }

    _ensureCtx() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    _beep(freq, duration, type = "square", vol = 0.12) {
        if (this.muted) return;
        try {
            this._ensureCtx();
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            osc.connect(gain).connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (_) { /* ignore audio errors */ }
    }

    land()     { this._beep(220, 0.1, "triangle"); }
    clear()    { this._beep(660, 0.25, "sine", 0.15); }
    chain()    { this._beep(880, 0.3, "sine", 0.18); }
    bomb() {
        this._beep(140, 0.2, "sawtooth", 0.12);
        setTimeout(() => this._beep(90, 0.35, "triangle", 0.1), 80);
    }
    gameOver() {
        this._beep(200, 0.4, "sawtooth", 0.10);
        setTimeout(() => this._beep(150, 0.5, "sawtooth", 0.08), 400);
    }

    toggle() {
        this.muted = !this.muted;
        return this.muted;
    }
}

// ────────────────────────────────────────
// PARTICLE (simple clear effect)
// ────────────────────────────────────────
class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 80;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 0.5 + Math.random() * 0.3;
        this.maxLife = this.life;
        this.radius = 2 + Math.random() * 3;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
    }

    draw(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    get dead() { return this.life <= 0; }
}

// ────────────────────────────────────────
// GRID  (data model + word detection)
// ────────────────────────────────────────
class Grid {
    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.cells = Array.from({ length: rows }, () => Array(cols).fill(null));
    }

    get(r, c) { return this.cells[r]?.[c] ?? null; }
    set(r, c, v) { if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) this.cells[r][c] = v; }
    inBounds(r, c) { return r >= 0 && r < this.rows && c >= 0 && c < this.cols; }
    isEmpty(r, c) { return this.inBounds(r, c) && this.cells[r][c] === null; }
    isGridFull() {
        for (let c = 0; c < this.cols; c++) {
            if (this.isEmpty(0, c)) return false;
        }
        return true;
    }

    // 8 direction vectors (we only need 4 unique lines through a cell)
    static DIRS = [
        [0, 1],   // horizontal →
        [1, 0],   // vertical ↓
        [1, 1],   // diagonal ↘
        [1, -1],  // diagonal ↙
    ];

    // Find all valid words passing through (row, col). Returns { words: [...], cells: Set }
    findWordsThrough(row, col, minWordLength = 3) {
        const foundWords = [];
        const cellsToRemove = new Set();

        for (const [dr, dc] of Grid.DIRS) {
            // Walk backward to find start of contiguous segment
            let sr = row, sc = col;
            while (this.inBounds(sr - dr, sc - dc) && isWordLetter(this.get(sr - dr, sc - dc))) {
                sr -= dr;
                sc -= dc;
            }

            // Collect the full contiguous segment
            const segment = [];
            let cr = sr, cc = sc;
            while (this.inBounds(cr, cc) && isWordLetter(this.get(cr, cc))) {
                segment.push({ r: cr, c: cc, letter: this.get(cr, cc) });
                cr += dr;
                cc += dc;
            }

            if (segment.length < minWordLength) continue;

            // Check all substrings of length ≥ 3 in both forward AND reverse order.
            // Reverse is needed because letters stack bottom-up (e.g. CAT placed
            // naturally in a column reads T-A-C top-to-bottom, but CAT bottom-to-top).
            const reversed = [...segment].reverse();
            for (const seq of [segment, reversed]) {
                for (let start = 0; start < seq.length; start++) {
                    for (let end = start + minWordLength; end <= seq.length; end++) {
                        const sub = seq.slice(start, end);
                        const word = sub.map(s => s.letter).join("");
                        if (DICTIONARY.has(word)) {
                            foundWords.push(word);
                            for (const s of sub) cellsToRemove.add(`${s.r},${s.c}`);
                        }
                    }
                }
            }
        }

        return { words: foundWords, cells: cellsToRemove };
    }

    // Full-board scan for any valid words (used during chain reactions)
    findAllWords(minWordLength = 3) {
        const foundWords = [];
        const cellsToRemove = new Set();

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (isWordLetter(this.cells[r][c])) {
                    const { words, cells } = this.findWordsThrough(r, c, minWordLength);
                    for (const w of words) foundWords.push(w);
                    for (const cell of cells) cellsToRemove.add(cell);
                }
            }
        }

        // Deduplicate words
        return { words: [...new Set(foundWords)], cells: cellsToRemove };
    }

    // Remove cells and apply gravity. Returns list of gravity animations [{r,c,fromR}]
    removeCells(cellSet) {
        for (const key of cellSet) {
            const [r, c] = key.split(",").map(Number);
            this.cells[r][c] = null;
        }
    }

    // Apply gravity, return animation descriptors
    applyGravity() {
        const moves = []; // {col, fromRow, toRow, letter}
        for (let c = 0; c < this.cols; c++) {
            let writeRow = this.rows - 1;
            for (let r = this.rows - 1; r >= 0; r--) {
                if (this.cells[r][c] !== null) {
                    if (r !== writeRow) {
                        moves.push({ col: c, fromRow: r, toRow: writeRow, letter: this.cells[r][c] });
                        this.cells[writeRow][c] = this.cells[r][c];
                        this.cells[r][c] = null;
                    }
                    writeRow--;
                }
            }
        }
        return moves;
    }
}

// ────────────────────────────────────────
// FALLING BLOCK
// ────────────────────────────────────────
class FallingBlock {
    constructor(letter, col, rows, kind = "letter") {
        this.letter = letter;
        this.kind = kind;
        this.col = col;
        this.row = -BUFFER_ROWS;  // spawn above the grid in the buffer zone
        this.maxRow = rows - 1;
        // Visual position for smooth interpolation (in cell units)
        this.visualRow = -BUFFER_ROWS;
        this.dropAnimating = false;
    }
}

// ────────────────────────────────────────
// RENDERER  (canvas drawing)
// ────────────────────────────────────────
class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.cellSize = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.particles = [];
        this.flashCells = new Set();   // cells flashing before removal
        this.flashTimer = 0;
        this.gravityAnims = [];        // {col, fromRow, toRow, letter, progress}
        this.hintCells = new Set();    // cells glowing orange (hint mode)
        this.blastCells = new Set();
        this.blastCenterKey = null;
        this.blastProgress = 0;
    }

    getGhostRow(grid, block) {
        if (!block) return null;
        if (block.row < 0 && !grid.isEmpty(0, block.col)) return null;

        let landingRow = Math.max(0, block.row);
        while (landingRow + 1 < grid.rows && grid.isEmpty(landingRow + 1, block.col)) {
            landingRow++;
        }

        return landingRow;
    }

    // Resize canvas to fit wrapper while keeping square grid + buffer rows on top
    resize(rows, cols) {
        const totalRows = rows + BUFFER_ROWS;
        const wrapper = this.canvas.parentElement;
        const maxW = wrapper.clientWidth;
        const maxH = wrapper.clientHeight;
        const maxCellW = Math.floor(maxW / cols);
        const maxCellH = Math.floor(maxH / totalRows);
        this.cellSize = Math.min(maxCellW, maxCellH);
        const w = this.cellSize * cols;
        const h = this.cellSize * totalRows;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + "px";
        this.canvas.style.height = h + "px";
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.offsetX = 0;
        // Grid starts below the buffer zone
        this.offsetY = this.cellSize * BUFFER_ROWS;
        this.totalH = h;
    }

    // Convert grid (row, col) to pixel center
    cellCenter(row, col) {
        return {
            x: this.offsetX + col * this.cellSize + this.cellSize / 2,
            y: this.offsetY + row * this.cellSize + this.cellSize / 2
        };
    }

    _getTokenFont(value, size) {
        const family = value === BOMB_SYMBOL
            ? '"Segoe UI Emoji", "Apple Color Emoji", sans-serif'
            : "monospace";
        return `bold ${Math.floor(size)}px ${family}`;
    }

    _drawToken(value, x, y, cellSize, color, scale = 1, alpha = 1) {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.font = this._getTokenFont(value, cellSize * 0.55 * scale);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(value, x, y + 1);
        ctx.restore();
    }

    draw(grid, block, dt) {
        const ctx = this.ctx;
        const cs = this.cellSize;
        const rows = grid.rows;
        const cols = grid.cols;
        const w = cs * cols;
        const h = this.totalH || cs * (rows + BUFFER_ROWS);

        // Background (full canvas including buffer)
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, w, h);

        // Buffer zone subtle background
        ctx.fillStyle = "#151515";
        ctx.fillRect(0, 0, w, this.offsetY);

        // Separator line between buffer and grid
        ctx.strokeStyle = "#ffd70055";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, this.offsetY);
        ctx.lineTo(w, this.offsetY);
        ctx.stroke();

        // Grid cells
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = this.offsetX + c * cs;
                const y = this.offsetY + r * cs;
                const key = `${r},${c}`;

                // Cell background
                ctx.fillStyle = "#2a2a2a";
                ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);

                const isBlastCell = this.blastCells.has(key);

                if (isBlastCell) {
                    const pulse = 0.35 + 0.25 * Math.sin(this.blastProgress * Math.PI * 6);
                    ctx.fillStyle = `rgba(255, 120, 20, ${0.22 + pulse * 0.45})`;
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                    ctx.strokeStyle = `rgba(255, 220, 120, ${0.4 + pulse * 0.35})`;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
                }

                // Hint glow (orange) — one letter away from a word
                if (this.hintCells.has(key) && !this.flashCells.has(key) && !isBlastCell) {
                    ctx.fillStyle = "rgba(255, 140, 0, 0.25)";
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                    ctx.strokeStyle = "rgba(255, 140, 0, 0.7)";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
                }

                // Flash effect
                if (this.flashCells.has(key) && !isBlastCell) {
                    const alpha = 0.5 + 0.5 * Math.sin(this.flashTimer * 15);
                    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
                    ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
                }

                // Letter
                const letter = grid.get(r, c);
                if (letter) {
                    let color = this.hintCells.has(key) && !this.flashCells.has(key) ? "#ff8c00" : "#fff";
                    let scale = 1;
                    let alpha = 1;
                    if (isBlastCell) {
                        if (key === this.blastCenterKey) {
                            scale = 0.95 + 0.12 * Math.sin(this.blastProgress * Math.PI * 4);
                        } else {
                            color = "#ffe082";
                            scale = Math.max(0.2, 1 - this.blastProgress * 0.55);
                            alpha = Math.max(0.12, 1 - this.blastProgress * 0.9);
                        }
                    }
                    this._drawToken(letter, x + cs / 2, y + cs / 2, cs, color, scale, alpha);
                }
            }
        }

        // Gravity animations (letters sliding down)
        for (const anim of this.gravityAnims) {
            const currentRow = anim.fromRow + (anim.toRow - anim.fromRow) * anim.progress;
            const x = this.offsetX + anim.col * cs;
            const y = this.offsetY + currentRow * cs;
            ctx.fillStyle = "#2a2a2a";
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            this._drawToken(anim.letter, x + cs / 2, y + cs / 2, cs, "#fff");
        }

        // Grid lines
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 1;
        for (let r = 0; r <= rows; r++) {
            ctx.beginPath();
            ctx.moveTo(this.offsetX, this.offsetY + r * cs);
            ctx.lineTo(this.offsetX + cols * cs, this.offsetY + r * cs);
            ctx.stroke();
        }
        for (let c = 0; c <= cols; c++) {
            ctx.beginPath();
            ctx.moveTo(this.offsetX + c * cs, this.offsetY);
            ctx.lineTo(this.offsetX + c * cs, this.offsetY + rows * cs);
            ctx.stroke();
        }

        const ghostRow = block ? this.getGhostRow(grid, block) : null;

        if (block && ghostRow !== null) {
            const ghostX = this.offsetX + block.col * cs;
            const ghostY = this.offsetY + ghostRow * cs;
            ctx.fillStyle = "rgba(255, 215, 0, 0.08)";
            ctx.fillRect(ghostX + 1, ghostY + 1, cs - 2, cs - 2);
            ctx.strokeStyle = "rgba(255, 215, 0, 0.45)";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(ghostX + 3, ghostY + 3, cs - 6, cs - 6);
            ctx.setLineDash([]);
            this._drawToken(block.letter, ghostX + cs / 2, ghostY + cs / 2, cs, "rgba(255, 215, 0, 0.45)");
        }

        // Falling block (smooth position)
        if (block) {
            const x = this.offsetX + block.col * cs;
            const y = this.offsetY + block.visualRow * cs;
            // Highlight border
            ctx.fillStyle = "#3a3520";
            ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
            ctx.strokeStyle = "#ffd700";
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
            // Letter
            this._drawToken(block.letter, x + cs / 2, y + cs / 2, cs, "#ffd700");
        }

        // Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update(dt);
            this.particles[i].draw(ctx);
            if (this.particles[i].dead) this.particles.splice(i, 1);
        }
    }

    // Spawn particles at cell centers
    spawnParticles(cellSet) {
        for (const key of cellSet) {
            const [r, c] = key.split(",").map(Number);
            const { x, y } = this.cellCenter(r, c);
            for (let i = 0; i < 6; i++) {
                this.particles.push(new Particle(x, y));
            }
        }
    }
}

// ────────────────────────────────────────
// DEFAULT TRACK LIST
// Auto-generated by running:  node scan-music.js
// The game tries to load Music/tracks.json at startup.
// If that fails (e.g. file:// protocol), it uses FALLBACK_TRACKS below.
// Update FALLBACK_TRACKS when you add/remove music files.
// ────────────────────────────────────────
const FALLBACK_TRACKS = [
    { id: "track01", title: "Red Velvet Cake", artist: "Freddy River", file: "Music/Red Velvet Cake.wav" },
];

let DEFAULT_TRACKS = [...FALLBACK_TRACKS];

// Try to load from tracks.json (works when served via HTTP, not file://)
async function loadTrackList() {
    try {
        const resp = await fetch("Music/tracks.json");
        if (!resp.ok) throw new Error(resp.status);
        const tracks = await resp.json();
        if (Array.isArray(tracks) && tracks.length > 0) {
            DEFAULT_TRACKS = tracks;
            console.log(`♪ Loaded ${tracks.length} track(s) from Music/tracks.json`);
            return;
        }
    } catch (_) {
        // fetch failed (file:// or missing) — use fallback
    }
    DEFAULT_TRACKS = [...FALLBACK_TRACKS];
    console.log(`♪ Using ${DEFAULT_TRACKS.length} fallback track(s).`);
}

// ────────────────────────────────────────
// PLAYLIST MANAGER (persists custom playlists & reorder to localStorage)
// ────────────────────────────────────────
class PlaylistManager {
    constructor(defaultTracks) {
        this.allTracks = defaultTracks;
        this.trackMap = new Map(defaultTracks.map(t => [t.id, t]));
        this._load();
    }

    _load() {
        try {
            const data = JSON.parse(localStorage.getItem("wf_playlists") || "null");
            if (data && data.version === 1) {
                this.defaultOrder = data.defaultOrder || this.allTracks.map(t => t.id);
                this.custom = data.custom || [];  // [{name, trackIds}]
            } else {
                this._reset();
            }
        } catch {
            this._reset();
        }
        this._cleanIds();
    }

    _reset() {
        this.defaultOrder = this.allTracks.map(t => t.id);
        this.custom = [];
    }

    // Remove any track IDs that no longer exist in allTracks
    _cleanIds() {
        const validIds = new Set(this.allTracks.map(t => t.id));
        this.defaultOrder = this.defaultOrder.filter(id => validIds.has(id));
        // Add any new tracks not in saved order
        for (const t of this.allTracks) {
            if (!this.defaultOrder.includes(t.id)) this.defaultOrder.push(t.id);
        }
        for (const pl of this.custom) {
            pl.trackIds = pl.trackIds.filter(id => validIds.has(id));
        }
    }

    _save() {
        localStorage.setItem("wf_playlists", JSON.stringify({
            version: 1,
            defaultOrder: this.defaultOrder,
            custom: this.custom,
        }));
    }

    getTrack(id) { return this.trackMap.get(id) || null; }

    getDefaultPlaylist() {
        return this.defaultOrder.map(id => this.trackMap.get(id)).filter(Boolean);
    }

    getCustomPlaylists() { return this.custom; }

    getPlaylistTracks(playlist) {
        if (playlist === "__default") return this.getDefaultPlaylist();
        const pl = this.custom.find(p => p.name === playlist);
        return pl ? pl.trackIds.map(id => this.trackMap.get(id)).filter(Boolean) : [];
    }

    getPlaylistTrackIds(playlist) {
        if (playlist === "__default") return [...this.defaultOrder];
        const pl = this.custom.find(p => p.name === playlist);
        return pl ? [...pl.trackIds] : [];
    }

    // Reorder a track within a playlist
    moveTrack(playlist, fromIndex, toIndex) {
        const ids = playlist === "__default" ? this.defaultOrder
            : this.custom.find(p => p.name === playlist)?.trackIds;
        if (!ids || fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length) return;
        const [item] = ids.splice(fromIndex, 1);
        ids.splice(toIndex, 0, item);
        this._save();
    }

    createPlaylist(name, trackIds) {
        if (this.custom.some(p => p.name === name)) return false;
        this.custom.push({ name, trackIds: [...trackIds] });
        this._save();
        return true;
    }

    renamePlaylist(oldName, newName) {
        const pl = this.custom.find(p => p.name === oldName);
        if (!pl || this.custom.some(p => p.name === newName)) return false;
        pl.name = newName;
        this._save();
        return true;
    }

    deletePlaylist(name) {
        this.custom = this.custom.filter(p => p.name !== name);
        this._save();
    }

    removeTrackFromPlaylist(playlistName, trackId) {
        const pl = this.custom.find(p => p.name === playlistName);
        if (!pl) return;
        pl.trackIds = pl.trackIds.filter(id => id !== trackId);
        this._save();
    }
}

// ────────────────────────────────────────
// MUSIC MANAGER (handles audio playback)
// ────────────────────────────────────────
class MusicManager {
    constructor(playlistManager) {
        this.plMgr = playlistManager;
        this.audio = new Audio();
        this.audio.volume = 0.5;
        this.playing = false;
        this.currentTrackId = null;
        this.activePlaylist = "__default"; // name of active playlist
        this.queue = [];       // ordered track IDs for current playlist
        this.queueIndex = -1;

        // Auto-advance to next track
        this.audio.addEventListener("ended", () => this.next());

        // Callbacks for UI updates
        this.onStateChange = null;  // () => void
        this.onTimeUpdate = null;   // (currentTime, duration) => void

        this._lastSavedTime = 0; // throttle position saves
        this.audio.addEventListener("timeupdate", () => {
            if (this.onTimeUpdate) {
                this.onTimeUpdate(this.audio.currentTime, this.audio.duration || 0);
            }
            // Save playback position every 3 seconds
            const now = Date.now();
            if (now - this._lastSavedTime > 3000) {
                this._lastSavedTime = now;
                this._saveMusicState();
            }
        });

        // Build initial queue
        this._buildQueue();

        // Restore previous session's music state
        this._restoreMusicState();
    }

    _buildQueue() {
        this.queue = this.plMgr.getPlaylistTrackIds(this.activePlaylist);
    }

    setActivePlaylist(name) {
        this.activePlaylist = name;
        this._buildQueue();
        // If a track is playing that's still in this playlist, keep playing it
        if (this.currentTrackId) {
            const idx = this.queue.indexOf(this.currentTrackId);
            if (idx >= 0) { this.queueIndex = idx; return; }
        }
        // Otherwise reset
        this.queueIndex = -1;
    }

    refreshQueue() {
        this._buildQueue();
        if (this.currentTrackId) {
            const idx = this.queue.indexOf(this.currentTrackId);
            if (idx >= 0) this.queueIndex = idx;
        }
    }

    playTrackById(trackId) {
        const track = this.plMgr.getTrack(trackId);
        if (!track) return;
        const idx = this.queue.indexOf(trackId);
        if (idx >= 0) this.queueIndex = idx;
        else {
            // Track not in current queue—switch to default and find it
            this.setActivePlaylist("__default");
            this.queueIndex = this.queue.indexOf(trackId);
        }
        this.currentTrackId = trackId;
        this.audio.src = track.file;
        this.audio.muted = !!this.muted;
        this.audio.play().catch(() => {});
        this.playing = true;
        this._saveMusicState();
        this._notify();
    }

    play() {
        if (this.currentTrackId) {
            this.audio.play().catch(() => {});
            this.playing = true;
            localStorage.setItem("wf_music_paused", "0");
            this._notify();
        } else if (this.queue.length > 0) {
            this.queueIndex = 0;
            this.playTrackById(this.queue[0]);
        }
    }

    pause() {
        this.audio.pause();
        this.playing = false;
        this._saveMusicState();
        localStorage.setItem("wf_music_paused", "1");
        this._notify();
    }

    toggle() {
        this.playing ? this.pause() : this.play();
    }

    next() {
        if (this.queue.length === 0) return;
        this.queueIndex = (this.queueIndex + 1) % this.queue.length;
        this.playTrackById(this.queue[this.queueIndex]);
    }

    prev() {
        if (this.queue.length === 0) return;
        // If more than 3 seconds in, restart current; otherwise go to previous
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }
        this.queueIndex = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
        this.playTrackById(this.queue[this.queueIndex]);
    }

    seek(fraction) {
        if (this.audio.duration) {
            this.audio.currentTime = fraction * this.audio.duration;
        }
    }

    setMuted(muted) {
        this.muted = muted;
        this.audio.muted = muted;
    }

    getCurrentTrack() {
        return this.currentTrackId ? this.plMgr.getTrack(this.currentTrackId) : null;
    }

    _saveMusicState() {
        if (!this.currentTrackId) return;
        localStorage.setItem("wf_music_state", JSON.stringify({
            trackId: this.currentTrackId,
            position: this.audio.currentTime || 0,
            playlist: this.activePlaylist,
            queueIndex: this.queueIndex,
        }));
    }

    _restoreMusicState() {
        try {
            const data = JSON.parse(localStorage.getItem("wf_music_state") || "null");
            if (!data || !data.trackId) return;
            const track = this.plMgr.getTrack(data.trackId);
            if (!track) return;

            // Restore playlist context
            if (data.playlist) {
                this.activePlaylist = data.playlist;
                this._buildQueue();
            }

            // Set up track without auto-playing
            this.currentTrackId = data.trackId;
            const idx = this.queue.indexOf(data.trackId);
            this.queueIndex = idx >= 0 ? idx : (data.queueIndex || 0);
            this.audio.src = track.file;
            this.audio.muted = !!this.muted;

            // Seek to saved position once audio is ready
            if (data.position > 0) {
                const seekOnce = () => {
                    this.audio.currentTime = data.position;
                    this.audio.removeEventListener("canplay", seekOnce);
                };
                this.audio.addEventListener("canplay", seekOnce);
            }

            // Don't auto-play here; _autoplayMusicFromUserAction will handle that
            this.playing = false;
            this._notify();
        } catch {}
    }

    _notify() {
        if (this.onStateChange) this.onStateChange();
    }
}

// ────────────────────────────────────────
// PROFILE MANAGER (multiple save files, localStorage)
// Each profile stores: username, highScore, gamesPlayed, totalWords, gridSize, difficulty, gameMode
// ────────────────────────────────────────
class ProfileManager {
    constructor() {
        this._load();
    }

    _load() {
        try {
            const data = JSON.parse(localStorage.getItem("wf_profiles") || "null");
            if (data && data.version === 1) {
                this.profiles = data.profiles || [];
                this.activeId = data.activeId || null;
            } else {
                this.profiles = [];
                this.activeId = null;
            }
        } catch {
            this.profiles = [];
            this.activeId = null;
        }
    }

    _save() {
        localStorage.setItem("wf_profiles", JSON.stringify({
            version: 1,
            profiles: this.profiles,
            activeId: this.activeId,
        }));
    }

    getAll() { return this.profiles; }

    getActive() {
        return this.profiles.find(p => p.id === this.activeId) || null;
    }

    create(username) {
        const id = "prof_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
        const profile = {
            id,
            username,
            highScore: 0,
            gamesPlayed: 0,
            totalWords: 0,
            gridSize: 5,
            difficulty: "casual",
            gameMode: GAME_MODES.SANDBOX,
            createdAt: Date.now(),
        };
        this.profiles.push(profile);
        this.activeId = id;
        this._save();
        return profile;
    }

    select(id) {
        const p = this.profiles.find(p => p.id === id);
        if (p) {
            this.activeId = id;
            this._save();
        }
        return p;
    }

    delete(id) {
        this.profiles = this.profiles.filter(p => p.id !== id);
        if (this.activeId === id) {
            this.activeId = this.profiles.length > 0 ? this.profiles[0].id : null;
        }
        this._save();
    }

    // Update stats for the active profile after a game ends
    recordGame(score, wordsCount) {
        const p = this.getActive();
        if (!p) return;
        p.gamesPlayed++;
        p.totalWords += wordsCount;
        if (score > p.highScore) p.highScore = score;
        this._save();
    }

    // Save preferred grid size for the active profile
    setGridSize(size) {
        const p = this.getActive();
        if (!p) return;
        p.gridSize = size;
        this._save();
    }

    // Save preferred difficulty for the active profile
    setDifficulty(difficulty) {
        const p = this.getActive();
        if (!p) return;
        p.difficulty = difficulty;
        this._save();
    }

    setGameMode(gameMode) {
        const p = this.getActive();
        if (!p) return;
        p.gameMode = gameMode;
        this._save();
    }

    hasProfiles() { return this.profiles.length > 0; }
}

// ────────────────────────────────────────
// GAME
// ────────────────────────────────────────
class Game {
    constructor() {
        this.audio = new AudioManager();
        this.canvas = document.getElementById("game-canvas");
        this.renderer = new Renderer(this.canvas);
        this.usesTouchSwipeInput = window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches;

        // Music system
        this.plMgr = new PlaylistManager(DEFAULT_TRACKS);
        this.music = new MusicManager(this.plMgr);
        this.activePlaylistTab = "__default";
        this._editingPlaylist = null;

        // Profile system
        this.profileMgr = new ProfileManager();

        // UI elements
        this.els = {
            profilesScreen: document.getElementById("profiles-screen"),
            profilesList:   document.getElementById("profiles-list"),
            newProfileBtn:  document.getElementById("new-profile-btn"),
            profileModal:   document.getElementById("profile-modal"),
            profileModalTitle: document.getElementById("profile-modal-title"),
            profileNameInput: document.getElementById("profile-name-input"),
            profileSaveBtn: document.getElementById("profile-save-btn"),
            profileCancelBtn: document.getElementById("profile-cancel-btn"),
            menuScreen:     document.getElementById("menu-screen"),
            menuProfileName: document.getElementById("menu-profile-name"),
            switchProfileBtn: document.getElementById("switch-profile-btn"),
            menuGamesPlayed: document.getElementById("menu-games-played"),
            menuTotalWords: document.getElementById("menu-total-words"),
            playScreen:     document.getElementById("play-screen"),
            canvasWrapper:  document.getElementById("canvas-wrapper"),
            gameoverScreen: document.getElementById("gameover-screen"),
            musicScreen:    document.getElementById("music-screen"),
            pauseOverlay:   document.getElementById("pause-overlay"),
            timeSelectModal: document.getElementById("time-select-modal"),
            timeSelectCancelBtn: document.getElementById("time-select-cancel-btn"),
            gameTimer: document.getElementById("game-timer"),
            timerScoreItem: document.getElementById("timer-score-item"),
            letterChoiceModal: document.getElementById("letter-choice-modal"),
            letterChoiceTitle: document.getElementById("letter-choice-title"),
            letterChoiceText: document.getElementById("letter-choice-text"),
            letterChoicePreview: document.getElementById("letter-choice-preview"),
            letterChoiceGrid: document.getElementById("letter-choice-grid"),
            letterChoiceCloseBtn: document.getElementById("letter-choice-close-btn"),
            letterChoiceAcceptBtn: document.getElementById("letter-choice-accept-btn"),
            letterChoiceLaterBtn: document.getElementById("letter-choice-later-btn"),
            playlistModal:  document.getElementById("playlist-modal"),
            menuHighScore:  document.getElementById("menu-high-score"),
            playHighScore:  document.getElementById("play-high-score"),
            currentScore:   document.getElementById("current-score"),
            finalScore:     document.getElementById("final-score-text"),
            newHighScore:   document.getElementById("new-high-score-text"),
            bonusBtn:       document.getElementById("bonus-btn"),
            startBtn:       document.getElementById("start-btn"),
            resumeGameBtn:  document.getElementById("resume-game-btn"),
            restartBtn:     document.getElementById("restart-btn"),
            menuBtn:        document.getElementById("menu-btn"),
            pauseBtn:       document.getElementById("pause-btn"),
            hintsBtn:       document.getElementById("hints-btn"),
            resumeBtn:      document.getElementById("resume-btn"),
            pauseWordsFoundBtn: document.getElementById("pause-words-found-btn"),
            quitBtn:        document.getElementById("quit-btn"),
            globalMuteBtn:  document.getElementById("global-mute-btn"),
            nextLetter:     document.getElementById("next-letter"),
            playWordsFoundBtn: document.getElementById("play-words-found-btn"),
            btnLeft:        document.getElementById("btn-left"),
            btnRight:       document.getElementById("btn-right"),
            btnDrop:        document.getElementById("btn-drop"),
            // Music
            musicMenuBtn:   document.getElementById("music-menu-btn"),
            musicBackBtn:   document.getElementById("music-back-btn"),
            npTitle:        document.getElementById("np-title"),
            npArtist:       document.getElementById("np-artist"),
            npPrev:         document.getElementById("np-prev"),
            npPlay:         document.getElementById("np-play"),
            npNext:         document.getElementById("np-next"),
            npProgressBar:  document.getElementById("np-progress-bar"),
            npProgressFill: document.getElementById("np-progress-fill"),
            npCurrentTime:  document.getElementById("np-current-time"),
            npDuration:     document.getElementById("np-duration"),
            playlistTabs:   document.getElementById("playlist-tabs"),
            newPlaylistTab: document.getElementById("new-playlist-tab"),
            trackList:      document.getElementById("track-list"),
            playlistActions: document.getElementById("playlist-actions"),
            renamePlaylistBtn: document.getElementById("rename-playlist-btn"),
            deletePlaylistBtn: document.getElementById("delete-playlist-btn"),
            playlistModalTitle: document.getElementById("playlist-modal-title"),
            playlistNameInput: document.getElementById("playlist-name-input"),
            playlistTrackPicker: document.getElementById("playlist-track-picker"),
            playlistSaveBtn: document.getElementById("playlist-save-btn"),
            playlistCancelBtn: document.getElementById("playlist-cancel-btn"),
            npMiniTitle:    document.getElementById("np-mini-title"),
            npMiniPrev:     document.getElementById("np-mini-prev"),
            npMiniToggle:   document.getElementById("np-mini-toggle"),
            npMiniNext:     document.getElementById("np-mini-next"),
            // Words Found
            wordsFoundScreen: document.getElementById("words-found-screen"),
            wordsFoundBtn:    document.getElementById("words-found-btn"),
            wordsFoundBackBtn: document.getElementById("words-found-back-btn"),
            wordsFoundCount:  document.getElementById("words-found-count"),
            wordsFoundList:   document.getElementById("words-found-list"),
            gameModeSelector: document.getElementById("game-mode-selector"),
            difficultySelector: document.getElementById("difficulty-selector"),
            wordPopup: document.getElementById("word-popup"),
        };

        this.state = State.MENU;
        this.gridSize = 5;
        this.difficulty = "casual";
        this.gameMode = GAME_MODES.SANDBOX;
        this.pendingStartMode = null;
        this.timeLimitSeconds = 0;
        this.timeRemainingSeconds = 0;
        this.highScore = 0;
        this.score = 0;
        this.grid = null;
        this.block = null;
        this.nextLetter = randomLetter();
        this.fallInterval = 0.5; // seconds per row
        this.fallTimer = 0;
        this.lastTime = 0;
        this._autoSaveTimer = 0;

        // Clearing / chain state
        this.clearing = false;
        this.clearPhase = ""; // "flash", "gravity", "check"
        this.clearTimer = 0;
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._wordPopupActive = false;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.pendingGravityMoves = [];
        this.foundWordsThisGame = new Set();
        this.availableBonusType = null;
        this.bonusBag = [];
        this.lastAwardedBonusType = null;
        this.nextBonusScore = BONUS_UNLOCK_SCORE_INTERVAL;
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;
        this.wordsFoundBackTarget = "gameover";
        this.wordsFoundResumeState = null;
        this.swipeState = null;

        document.body.classList.toggle("touch-input", this.usesTouchSwipeInput);

        this._bindUI();
        this._bindInput();
        this._bindMusic();
        this._bindProfiles();
        this._bindLetterChoice();
        this._initMutePref();
        this.hintsEnabled = localStorage.getItem("wf_hints_enabled") === "1";
        this._updateHintsBtn();

        // Show profiles screen or menu depending on whether a profile is active
        if (this.profileMgr.getActive()) {
            this._loadActiveProfile();
            this._showScreen("menu");
        } else {
            this._showScreen("profiles");
        }
        this._highlightSizeButton();
        this._highlightDifficultyButton();
        this._updateDifficultySelector();

        // Music UI callbacks
        this.music.onStateChange = () => this._updateMusicUI();
        this.music.onTimeUpdate = (cur, dur) => this._updateMusicProgress(cur, dur);

        // Music starts when the player presses Start (see _startGame)

        // Start RAF loop
        requestAnimationFrame((t) => this._loop(t));
    }

    // ── UI binding ──
    _bindUI() {
        // Grid size buttons
        document.querySelectorAll(".size-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.gridSize = parseInt(btn.dataset.size, 10);
                this.profileMgr.setGridSize(this.gridSize);
                this._highlightSizeButton();
                this._updateDifficultySelector();
            });
        });

        document.querySelectorAll(".difficulty-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.difficulty = btn.dataset.difficulty || "casual";
                this.profileMgr.setDifficulty(this.difficulty);
                this._highlightDifficultyButton();
            });
        });

        document.querySelectorAll(".game-mode-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this.gameMode = btn.dataset.mode || GAME_MODES.SANDBOX;
                this.profileMgr.setGameMode(this.gameMode);
                this._highlightGameModeButton();
            });
        });

        this.els.startBtn.addEventListener("click", () => this._startGame());
        this.els.resumeGameBtn.addEventListener("click", () => this._resumeGame());
        this.els.restartBtn.addEventListener("click", () => this._startGame());
        this.els.menuBtn.addEventListener("click", () => this._showScreen("menu"));
        this.els.pauseBtn.addEventListener("click", () => this._togglePause());
        this.els.hintsBtn.addEventListener("click", () => {
            this.hintsEnabled = !this.hintsEnabled;
            localStorage.setItem("wf_hints_enabled", this.hintsEnabled ? "1" : "0");
            this._updateHintsBtn();
            this._computeHintCells();
        });
        this.els.resumeBtn.addEventListener("click", () => this._togglePause());
        this.els.pauseWordsFoundBtn.addEventListener("click", () => {
            this.els.pauseOverlay.classList.remove("active");
            this._openWordsFound("pause");
        });
        this.els.quitBtn.addEventListener("click", () => {
            this._saveGameState();
            this.state = State.MENU;
            this.els.pauseOverlay.classList.remove("active");
            this._showScreen("menu");
        });

        // Switch Profile
        this.els.switchProfileBtn.addEventListener("click", () => {
            this._renderProfilesList();
            this._showScreen("profiles");
        });

        // Words Found
        this.els.playWordsFoundBtn.addEventListener("click", () => this._openWordsFound("play"));
        this.els.wordsFoundBtn.addEventListener("click", () => {
            this._openWordsFound("gameover");
        });
        this.els.wordsFoundBackBtn.addEventListener("click", () => this._closeWordsFound());

        this.els.bonusBtn.addEventListener("click", () => this._openLetterChoiceModal());

        // Music menu button
        this.els.musicMenuBtn.addEventListener("click", () => {
            this._showScreen("music");
            this._renderMusicScreen();
        });
        this.els.musicBackBtn.addEventListener("click", () => this._showScreen("menu"));

        // Global mute button
        this.els.globalMuteBtn.addEventListener("click", () => {
            const nowMuted = !this.musicMuted;
            this._setMuted(nowMuted);
            localStorage.setItem("wf_music_muted", nowMuted ? "1" : "0");
        });

        this.els.timeSelectCancelBtn.addEventListener("click", () => this._closeTimeSelectModal());
        document.querySelectorAll(".time-select-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const minutes = parseInt(btn.dataset.minutes, 10);
                if (!Number.isFinite(minutes)) return;
                this._closeTimeSelectModal();
                this._beginNewGame(minutes * 60);
            });
        });
    }

    _bindLetterChoice() {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
        this.els.letterChoiceGrid.innerHTML = "";
        this.els.letterChoiceCloseBtn.addEventListener("click", () => this._closeLetterChoiceModal(false));
        this.els.letterChoiceAcceptBtn.addEventListener("click", () => this._acceptActiveBonus());
        this.els.letterChoiceLaterBtn.addEventListener("click", () => this._closeLetterChoiceModal(false));

        for (const letter of letters) {
            const btn = document.createElement("button");
            btn.className = "letter-choice-btn";
            btn.type = "button";
            btn.textContent = letter;
            btn.addEventListener("click", () => this._applyLetterChoice(letter));
            this.els.letterChoiceGrid.appendChild(btn);
        }
    }

    // ── Mute helpers ──
    _initMutePref() {
        const saved = localStorage.getItem("wf_music_muted");
        const muted = saved === "1"; // default is unmuted
        this._setMuted(muted);
    }

    _setMuted(muted) {
        this.musicMuted = muted;
        this.audio.muted = muted;
        this.music.setMuted(muted);
        this.els.globalMuteBtn.textContent = muted ? "🔇" : "🔊";
        this.els.globalMuteBtn.classList.toggle("muted", muted);
    }

    // ── Hints ──
    _updateHintsBtn() {
        this.els.hintsBtn.style.opacity = this.hintsEnabled ? "1" : "0.4";
        this.els.hintsBtn.title = this.hintsEnabled ? "Hints ON" : "Hints OFF";
    }

    _computeHintCells() {
        if (!this.hintsEnabled || !this.grid) {
            this.renderer.hintCells = new Set();
            this._activeHintKey = null;
            return;
        }
        const { rows, cols } = this.grid;
        const dirs = [[0,1],[1,0],[1,1],[1,-1]];
        // Collect every distinct hint sequence as an array of cell keys
        const allHints = []; // each entry: { key: string, cells: Set }

        for (const [dr, dc] of dirs) {
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // Only start at the beginning of a run in this direction
                    const pr = r - dr, pc = c - dc;
                    if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && isWordLetter(this.grid.get(pr, pc))) continue;

                    // Build the full consecutive run from this start cell
                    let seq = "";
                    const keys = [];
                    let cr = r, cc = c;
                    while (cr >= 0 && cr < rows && cc >= 0 && cc < cols) {
                        const letter = this.grid.get(cr, cc);
                        if (!isWordLetter(letter)) break;
                        seq += letter;
                        keys.push(`${cr},${cc}`);
                        cr += dr;
                        cc += dc;
                    }
                    if (keys.length < 2) continue;
                    const rKeys = [...keys].reverse();
                    const rSeq = seq.split("").reverse().join("");

                    // For each orientation (forward and reversed), check prefix/suffix hints
                    for (const [hSeq, hKeys, nr, nc] of [
                        // forward: completing letter goes AFTER (at cr,cc)
                        [seq,  keys,  cr, cc],
                        // reverse: completing letter goes AFTER the reversed run (at pr,pc)
                        [rSeq, rKeys, pr, pc],
                    ]) {
                        const afterFree = nr >= 0 && nr < rows && nc >= 0 && nc < cols && !this.grid.get(nr, nc);
                        if (afterFree) {
                            for (let start = 0; start < hKeys.length; start++) {
                                const sub = hSeq.slice(start);
                                if (sub.length >= 3 && HINT_PREFIXES.has(sub)) {
                                    const hintKeys = hKeys.slice(start);
                                    const hintKey = hintKeys.join("|") + ">" + `${nr},${nc}`;
                                    allHints.push({ key: hintKey, cells: new Set(hintKeys) });
                                }
                            }
                        }
                    }

                    // HINT_SUFFIXES: completing letter goes BEFORE the run.
                    for (const [hSeq, hKeys, bfr, bfc] of [
                        // forward: completing letter goes BEFORE (at pr,pc)
                        [seq,  keys,  pr, pc],
                        // reverse: completing letter goes BEFORE reversed run (at cr,cc)
                        [rSeq, rKeys, cr, cc],
                    ]) {
                        const beforeFree = bfr >= 0 && bfr < rows && bfc >= 0 && bfc < cols && !this.grid.get(bfr, bfc);
                        if (beforeFree) {
                            for (let end = 3; end <= hKeys.length; end++) {
                                const sub = hSeq.slice(0, end);
                                if (HINT_SUFFIXES.has(sub)) {
                                    const hintKeys = hKeys.slice(0, end);
                                    const hintKey = `<${bfr},${bfc}` + hintKeys.join("|");
                                    allHints.push({ key: hintKey, cells: new Set(hintKeys) });
                                }
                            }
                        }
                    }
                }
            }
        }

        if (allHints.length === 0) {
            this.renderer.hintCells = new Set();
            this._activeHintKey = null;
            return;
        }

        // If the current active hint is still present, keep showing it
        if (this._activeHintKey) {
            const current = allHints.find(h => h.key === this._activeHintKey);
            if (current) {
                this.renderer.hintCells = current.cells;
                return;
            }
        }

        // Active hint is gone — pick the first available one
        this._activeHintKey = allHints[0].key;
        this.renderer.hintCells = allHints[0].cells;
    }

    // ── Music binding ──
    _bindMusic() {
        this._setMusicControlButton(this.els.npPrev, "prev", "Previous Track");
        this._setMusicControlButton(this.els.npNext, "next", "Next Track");
        this._setMusicControlButton(this.els.npMiniPrev, "prev", "Previous Track");
        this._setMusicControlButton(this.els.npMiniNext, "next", "Next Track");

        // Now Playing controls (full bar on music screen)
        this.els.npPlay.addEventListener("click", () => this.music.toggle());
        this.els.npPrev.addEventListener("click", () => this.music.prev());
        this.els.npNext.addEventListener("click", () => this.music.next());

        // Progress bar seek
        this.els.npProgressBar.addEventListener("click", (e) => {
            const rect = this.els.npProgressBar.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this.music.seek(frac);
        });

        // Mini now-playing toggle (in-game)
        this.els.npMiniPrev.addEventListener("click", () => this.music.prev());
        this.els.npMiniToggle.addEventListener("click", () => this.music.toggle());
        this.els.npMiniNext.addEventListener("click", () => this.music.next());

        // New playlist tab
        this.els.newPlaylistTab.addEventListener("click", () => this._openPlaylistModal(null));

        // Playlist modal
        this.els.playlistSaveBtn.addEventListener("click", () => this._savePlaylistModal());
        this.els.playlistCancelBtn.addEventListener("click", () => {
            this.els.playlistModal.classList.remove("active");
        });

        // Playlist actions
        this.els.renamePlaylistBtn.addEventListener("click", () => {
            if (this.activePlaylistTab === "__default") return;
            const newName = prompt("Rename playlist:", this.activePlaylistTab);
            if (newName && newName.trim()) {
                this.plMgr.renamePlaylist(this.activePlaylistTab, newName.trim());
                this.activePlaylistTab = newName.trim();
                this.music.refreshQueue();
                this._renderMusicScreen();
            }
        });
        this.els.deletePlaylistBtn.addEventListener("click", () => {
            if (this.activePlaylistTab === "__default") return;
            if (confirm(`Delete playlist "${this.activePlaylistTab}"?`)) {
                this.plMgr.deletePlaylist(this.activePlaylistTab);
                if (this.music.activePlaylist === this.activePlaylistTab) {
                    this.music.setActivePlaylist("__default");
                }
                this.activePlaylistTab = "__default";
                this._renderMusicScreen();
            }
        });
    }

    _setMusicControlButton(button, iconName, label) {
        if (!button) return;
        button.innerHTML = getMusicControlIcon(iconName);
        if (label) button.setAttribute("aria-label", label);
    }

    // ── Input binding ──
    _bindInput() {
        // Keyboard
        document.addEventListener("keydown", (e) => {
            if (this.state !== State.PLAYING || this.clearing) return;
            if (!this.block) return;
            switch (e.code) {
                case "ArrowLeft":
                    e.preventDefault();
                    this._moveBlock(-1);
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    this._moveBlock(1);
                    break;
                case "Space":
                case "ArrowDown":
                    e.preventDefault();
                    this._fastDrop();
                    break;
                case "Escape":
                case "KeyP":
                    e.preventDefault();
                    this._togglePause();
                    break;
            }
        });

        // Mobile buttons
        const preventAndDo = (el, fn) => {
            const handler = (e) => {
                e.preventDefault();
                if (this.state === State.PLAYING && !this.clearing && this.block) fn();
            };

            if (window.PointerEvent) {
                el.addEventListener("pointerdown", (e) => {
                    if (e.pointerType === "mouse" && e.button !== 0) return;
                    handler(e);
                });
                return;
            }

            el.addEventListener("touchstart", handler, { passive: false });
            el.addEventListener("mousedown", handler);
        };
        preventAndDo(this.els.btnLeft, () => this._moveBlock(-1));
        preventAndDo(this.els.btnRight, () => this._moveBlock(1));
        preventAndDo(this.els.btnDrop, () => this._fastDrop());

        if (this.usesTouchSwipeInput) {
            this._bindSwipeInput();
        }
    }

    _bindSwipeInput() {
        const swipeThreshold = 26;
        const dropThreshold = 32;
        const swipeSurface = this.els.canvasWrapper;
        if (!swipeSurface) return;

        const startSwipe = (clientX, clientY, pointerId = null) => {
            this.swipeState = {
                pointerId,
                startX: clientX,
                startY: clientY,
                lastX: clientX,
                dropTriggered: false,
            };
        };

        const moveSwipe = (clientX, clientY) => {
            if (!this.swipeState || this.state !== State.PLAYING || this.clearing || !this.block) return;

            const totalDx = clientX - this.swipeState.startX;
            const totalDy = clientY - this.swipeState.startY;

            if (!this.swipeState.dropTriggered && totalDy >= dropThreshold && totalDy > Math.abs(totalDx) * 1.15) {
                this._fastDrop(true);
                this.swipeState.dropTriggered = true;
                return;
            }

            if (Math.abs(totalDx) <= Math.abs(totalDy)) return;

            const deltaSinceLastMove = clientX - this.swipeState.lastX;
            if (Math.abs(deltaSinceLastMove) < swipeThreshold) return;

            const direction = deltaSinceLastMove > 0 ? 1 : -1;
            const steps = Math.floor(Math.abs(deltaSinceLastMove) / swipeThreshold);
            for (let step = 0; step < steps; step++) {
                this._moveBlock(direction);
            }
            this.swipeState.lastX += direction * steps * swipeThreshold;
        };

        const endSwipe = (pointerId = null) => {
            if (!this.swipeState) return;
            if (pointerId !== null && this.swipeState.pointerId !== null && pointerId !== this.swipeState.pointerId) return;
            this.swipeState = null;
        };

        if (window.PointerEvent) {
            swipeSurface.addEventListener("pointerdown", (e) => {
                if (e.pointerType === "mouse") return;
                if (this.state !== State.PLAYING || this.clearing || !this.block) return;
                startSwipe(e.clientX, e.clientY, e.pointerId);
            });
            swipeSurface.addEventListener("pointermove", (e) => {
                if (!this.swipeState) return;
                if (this.swipeState.pointerId !== null && e.pointerId !== this.swipeState.pointerId) return;
                moveSwipe(e.clientX, e.clientY);
            });
            swipeSurface.addEventListener("pointerup", (e) => endSwipe(e.pointerId));
            swipeSurface.addEventListener("pointercancel", (e) => endSwipe(e.pointerId));
            return;
        }

        swipeSurface.addEventListener("touchstart", (e) => {
            if (this.state !== State.PLAYING || this.clearing || !this.block) return;
            const touch = e.changedTouches[0];
            if (!touch) return;
            startSwipe(touch.clientX, touch.clientY, touch.identifier);
        }, { passive: true });

        swipeSurface.addEventListener("touchmove", (e) => {
            if (!this.swipeState) return;
            const touch = [...e.changedTouches].find(item => item.identifier === this.swipeState.pointerId);
            if (!touch) return;
            moveSwipe(touch.clientX, touch.clientY);
        }, { passive: true });

        swipeSurface.addEventListener("touchend", (e) => {
            if (!this.swipeState) return;
            const touch = [...e.changedTouches].find(item => item.identifier === this.swipeState.pointerId);
            if (touch) endSwipe(touch.identifier);
        }, { passive: true });

        swipeSurface.addEventListener("touchcancel", (e) => {
            if (!this.swipeState) return;
            const touch = [...e.changedTouches].find(item => item.identifier === this.swipeState.pointerId);
            if (touch) endSwipe(touch.identifier);
        }, { passive: true });
    }

    _highlightSizeButton() {
        document.querySelectorAll(".size-btn").forEach(btn => {
            btn.classList.toggle("selected", parseInt(btn.dataset.size, 10) === this.gridSize);
        });
    }

    _highlightDifficultyButton() {
        document.querySelectorAll(".difficulty-btn").forEach(btn => {
            btn.classList.toggle("selected", btn.dataset.difficulty === this.difficulty);
        });
    }

    _highlightGameModeButton() {
        document.querySelectorAll(".game-mode-btn").forEach(btn => {
            btn.classList.toggle("selected", btn.dataset.mode === this.gameMode);
        });
    }

    _isDifficultyActiveGrid() {
        return this.gridSize >= 6;
    }

    _updateDifficultySelector() {
        if (!this.els.difficultySelector) return;
        this.els.difficultySelector.classList.toggle("hidden", !this._isDifficultyActiveGrid());
        if (this.els.gameModeSelector) {
            this.els.gameModeSelector.classList.remove("hidden");
        }
    }

    _getSelectedGameMode() {
        return this.gameMode;
    }

    _formatCountdownTime(seconds) {
        const safeSeconds = Math.max(0, Math.ceil(seconds));
        const mins = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        return `${mins}:${String(secs).padStart(2, "0")}`;
    }

    _updateTimerDisplay() {
        const isTimed = this._getSelectedGameMode() === GAME_MODES.TIMED && this.timeLimitSeconds > 0;
        this.els.timerScoreItem.classList.toggle("hidden", !isTimed);
        if (isTimed) {
            this.els.gameTimer.textContent = this._formatCountdownTime(this.timeRemainingSeconds);
        }
    }

    _openTimeSelectModal() {
        this.pendingStartMode = this._getSelectedGameMode();
        this.els.timeSelectModal.classList.add("active");
    }

    _closeTimeSelectModal() {
        this.pendingStartMode = null;
        this.els.timeSelectModal.classList.remove("active");
    }

    _getMinWordLength() {
        if (this._isDifficultyActiveGrid() && this.difficulty === "challenging") return 4;
        return 3;
    }

    _showScreen(name) {
        this.els.profilesScreen.classList.toggle("active", name === "profiles");
        this.els.menuScreen.classList.toggle("active", name === "menu");
        this.els.playScreen.classList.toggle("active", name === "play");
        this.els.gameoverScreen.classList.toggle("active", name === "gameover");
        this.els.musicScreen.classList.toggle("active", name === "music");
        this.els.wordsFoundScreen.classList.toggle("active", name === "wordsfound");
        if (name === "menu") {
            this._updateHighScoreDisplay();
            this._updateMenuStats();
            const hasSaved = this._hasSavedGame();
            this.els.resumeGameBtn.classList.toggle("hidden", !hasSaved);
        }
        if (name === "play") this._updateMiniNowPlaying();
        if (name === "profiles") this._renderProfilesList();
    }

    _openWordsFound(fromScreen) {
        this.wordsFoundBackTarget = fromScreen;
        this.wordsFoundResumeState = fromScreen === "play" ? this.state : null;
        if (fromScreen === "play" && this.state === State.PLAYING) {
            this.state = State.PAUSED;
        }
        this._renderWordsFound();
        this._showScreen("wordsfound");
    }

    _closeWordsFound() {
        const target = this.wordsFoundBackTarget || "gameover";
        this._showScreen(target === "pause" ? "play" : target);
        if (target === "pause") {
            this.state = State.PAUSED;
            this.els.pauseOverlay.classList.add("active");
        }
        if (target === "play" && this.wordsFoundResumeState === State.PLAYING) {
            this.state = State.PLAYING;
        }
        this.wordsFoundResumeState = null;
    }

    _updateHighScoreDisplay() {
        this.els.menuHighScore.textContent = this.highScore;
        this.els.playHighScore.textContent = this.highScore;
    }

    _updateScoreDisplay() {
        this.els.currentScore.textContent = this.score;
        this._updateBonusButton();
    }

    _updateBonusButton() {
        const canUseBonus = Boolean(this.availableBonusType);
        const bonusMeta = canUseBonus ? BONUS_METADATA[this.availableBonusType] : null;
        this.els.bonusBtn.classList.toggle("hidden", !canUseBonus);
        this.els.bonusBtn.textContent = bonusMeta?.buttonLabel || "Bonus!";
        this.els.bonusBtn.title = bonusMeta?.buttonTitle || "Use Bonus";
        this.els.bonusBtn.disabled = !this.block || this.clearing || this.letterChoiceActive;
    }

    // ── Save / Resume game state ──

    _saveKey() {
        const profile = this.profileMgr.getActive();
        return profile ? `wf_savedgame_${profile.id}` : null;
    }

    _saveGameState() {
        const key = this._saveKey();
        if (!key || !this.grid || this.state === State.GAMEOVER || this.state === State.MENU) return;
        const state = {
            version: 2,
            gridSize: this.gridSize,
            difficulty: this.difficulty,
            gameMode: this._getSelectedGameMode(),
            timeLimitSeconds: this.timeLimitSeconds,
            timeRemainingSeconds: this.timeRemainingSeconds,
            cells: this.grid.cells,
            score: this.score,
            nextLetter: this.nextLetter,
            wordsFound: this.wordsFound || [],
            bonusAvailable: Boolean(this.availableBonusType),
            availableBonusType: this.availableBonusType,
            bonusBag: this.bonusBag,
            lastAwardedBonusType: this.lastAwardedBonusType,
            nextBonusScore: this.nextBonusScore,
            block: this.block ? { letter: this.block.letter, col: this.block.col, row: this.block.row, kind: this.block.kind } : null,
        };
        localStorage.setItem(key, JSON.stringify(state));
    }

    _loadGameState() {
        const key = this._saveKey();
        if (!key) return null;
        try {
            const data = JSON.parse(localStorage.getItem(key) || "null");
            if (data && (data.version === 1 || data.version === 2)) return data;
        } catch {}
        return null;
    }

    _clearGameState() {
        const key = this._saveKey();
        if (key) localStorage.removeItem(key);
    }

    _hasSavedGame() {
        return this._loadGameState() !== null;
    }

    _autoplayMusicFromUserAction() {
        if (this.music.playing) return;
        if (this.music.queue.length === 0) {
            this.music.refreshQueue();
        }
        if (this.music.queue.length > 0) {
            this.music.play();
        }
    }

    _checkBonusUnlock(prevScore, newScore) {
        if (this.availableBonusType) return;
        if (prevScore < this.nextBonusScore && newScore >= this.nextBonusScore) {
            const draw = drawRandomBonusType(this.bonusBag, this.lastAwardedBonusType);
            this.availableBonusType = draw.bonusType;
            this.bonusBag = draw.nextBag;
            this.lastAwardedBonusType = draw.bonusType;
            this._updateBonusButton();
        }
    }

    _openLetterChoiceModal() {
        if (!this.availableBonusType || !this.block || this.clearing || this.letterChoiceActive) {
            return;
        }

        this.letterChoiceResumeState = this.state;
        this.letterChoiceActive = true;
        this.state = State.PAUSED;
        this._renderBonusModal();
        this.els.letterChoiceModal.classList.add("active");
        this._updateBonusButton();
    }

    _renderBonusModal() {
        const bonusMeta = BONUS_METADATA[this.availableBonusType] || BONUS_METADATA[BONUS_TYPES.LETTER_PICK];
        const showLetterGrid = this.availableBonusType === BONUS_TYPES.LETTER_PICK;

        this.els.letterChoiceTitle.textContent = bonusMeta.modalTitle;
        this.els.letterChoiceText.textContent = bonusMeta.modalText;
        this.els.letterChoiceGrid.classList.toggle("hidden", !showLetterGrid);
        this.els.letterChoicePreview.classList.toggle("hidden", showLetterGrid);
        this.els.letterChoiceAcceptBtn.classList.toggle("hidden", showLetterGrid);
        this.els.letterChoiceAcceptBtn.textContent = bonusMeta.acceptLabel || "Accept";
        this.els.letterChoicePreview.textContent = bonusMeta.previewSymbol || "";
        this.els.letterChoicePreview.dataset.bonusType = this.availableBonusType || "";
    }

    _closeLetterChoiceModal(consumeBonus) {
        if (!this.letterChoiceActive) return;

        this.letterChoiceActive = false;
        this.els.letterChoiceModal.classList.remove("active");
        if (consumeBonus) {
            this.availableBonusType = null;
            this.nextBonusScore = this.score + BONUS_UNLOCK_SCORE_INTERVAL;
        }
        this.state = this.letterChoiceResumeState === State.PAUSED ? State.PAUSED : State.PLAYING;
        this.letterChoiceResumeState = null;
        this._updateBonusButton();
    }

    _acceptActiveBonus() {
        if (!this.block || !this.letterChoiceActive) return;
        if (this.availableBonusType === BONUS_TYPES.BOMB) {
            this.block.kind = "bomb";
            this.block.letter = BOMB_SYMBOL;
            this._closeLetterChoiceModal(true);
        }
    }

    _applyLetterChoice(letter) {
        if (!this.block || !this.letterChoiceActive || this.availableBonusType !== BONUS_TYPES.LETTER_PICK) return;
        this.block.letter = letter;
        this.block.kind = "letter";
        this._closeLetterChoiceModal(true);
    }

    _resumeGame() {
        const saved = this._loadGameState();
        if (!saved) { this._startGame(); return; }

        this.gridSize = saved.gridSize;
        this.difficulty = saved.difficulty || this.profileMgr.getActive()?.difficulty || "casual";
        this.gameMode = saved.gameMode || this.profileMgr.getActive()?.gameMode || GAME_MODES.SANDBOX;
        this.grid = new Grid(this.gridSize, this.gridSize);
        this.grid.cells = saved.cells;
        this.score = saved.score;
        this.timeLimitSeconds = saved.timeLimitSeconds || 0;
        this.timeRemainingSeconds = saved.timeRemainingSeconds || 0;
        this.nextLetter = saved.nextLetter;
        this.wordsFound = saved.wordsFound || [];
        this.foundWordsThisGame = new Set(this.wordsFound.map(({ word }) => word));
        this.availableBonusType = saved.availableBonusType || (saved.bonusAvailable ? BONUS_TYPES.LETTER_PICK : null);
        this.bonusBag = Array.isArray(saved.bonusBag) ? saved.bonusBag.filter(type => BONUS_TYPE_POOL.includes(type)) : [];
        this.lastAwardedBonusType = BONUS_TYPE_POOL.includes(saved.lastAwardedBonusType) ? saved.lastAwardedBonusType : this.availableBonusType;
        this.nextBonusScore = saved.nextBonusScore || BONUS_UNLOCK_SCORE_INTERVAL;
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;
        this.clearing = false;
        this.clearPhase = "";
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.renderer.flashCells.clear();
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.particles = [];
        this.renderer.gravityAnims = [];
        this.pendingGravityMoves = [];
        this._updateScoreDisplay();
        this._updateHighScoreDisplay();
        this._highlightSizeButton();
        this._highlightGameModeButton();
        this._highlightDifficultyButton();
        this._updateDifficultySelector();
        this._updateTimerDisplay();
        this._showScreen("play");
        this.state = State.PLAYING;

        this._autoplayMusicFromUserAction();

        requestAnimationFrame(() => {
            this.renderer.resize(this.gridSize, this.gridSize);
            // Restore falling block or spawn a new one
            if (saved.block) {
                this.block = new FallingBlock(saved.block.letter, saved.block.col, this.gridSize, saved.block.kind || "letter");
                const savedRow = typeof saved.block.row === "number" ? saved.block.row : -1;
                this.block.row = savedRow;
                this.block.visualRow = savedRow;
            } else {
                this._spawnBlock();
            }
            this.els.nextLetter.textContent = this.nextLetter;
            this._updateBonusButton();
        });
    }

    // ── Game start / reset ──
    _startGame() {
        if (this._getSelectedGameMode() === GAME_MODES.TIMED) {
            this._openTimeSelectModal();
            return;
        }
        this._beginNewGame(0);
    }

    _beginNewGame(timeLimitSeconds = 0) {
        this.grid = new Grid(this.gridSize, this.gridSize);
        this.score = 0;
        this.timeLimitSeconds = timeLimitSeconds;
        this.timeRemainingSeconds = timeLimitSeconds;
        this.clearing = false;
        this.clearPhase = "";
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._wordPopupActive = false;
        this.els.wordPopup.innerHTML = "";
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "";
        this.renderer.flashCells.clear();
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.particles = [];
        this.renderer.gravityAnims = [];
        this.renderer.hintCells = new Set();
        this._activeHintKey = null;
        this.pendingGravityMoves = [];
        this.nextLetter = randomLetter();
        this.wordsFound = [];  // track all words found this round
        this.foundWordsThisGame = new Set();
        this.availableBonusType = null;
        this.bonusBag = [];
        this.lastAwardedBonusType = null;
        this.nextBonusScore = BONUS_UNLOCK_SCORE_INTERVAL;
        this.letterChoiceActive = false;
        this.letterChoiceResumeState = null;
        this._updateScoreDisplay();
        this._updateTimerDisplay();
        this._updateHighScoreDisplay();
        this._showScreen("play");
        this.state = State.PLAYING;
        this.fallInterval = this.difficulty === "casual" ? 1.5 : 0.9;

        // Start or resume music from the player's start-game action.
        this._autoplayMusicFromUserAction();

        // Resize canvas
        requestAnimationFrame(() => {
            this.renderer.resize(this.gridSize, this.gridSize);
            this._spawnBlock();
        });
    }

    _spawnBlock() {
        const centerCol = Math.floor(this.gridSize / 2);
        this.block = new FallingBlock(this.nextLetter, centerCol, this.gridSize, "letter");
        this.nextLetter = randomLetter();
        this.els.nextLetter.textContent = this.nextLetter;
        this.fallTimer = 0;
        this._updateBonusButton();
    }

    _moveBlock(dc) {
        if (!this.block || this._wordPopupActive) return;
        if (this.block.dropAnimating) return;
        const newCol = this.block.col + dc;
        if (newCol < 0 || newCol >= this.gridSize) return;
        // In buffer zone (row < 0) there are no obstacles
        if (this.block.row >= 0 && !this.grid.isEmpty(this.block.row, newCol)) return;
        this.block.col = newCol;
    }

    _fastDrop(animate = false) {
        if (!this.block || this._wordPopupActive) return;
        if (this.block.dropAnimating) return;
        // If the block is hovering over a full column, don't drop
        if (this.block.row < 0 && !this.grid.isEmpty(0, this.block.col)) return;
        // Start from row 0 if still in buffer
        let r = Math.max(0, this.block.row);
        while (r + 1 < this.gridSize && this.grid.isEmpty(r + 1, this.block.col)) {
            r++;
        }

        if (animate && r !== this.block.row) {
            this.block.row = r;
            this.block.dropAnimating = true;
            this.fallTimer = 0;
            return;
        }

        this.block.row = r;
        this.block.visualRow = r;
        this._landBlock();
    }

    _landBlock() {
        if (!this.block) return;
        this.grid.set(this.block.row, this.block.col, this.block.letter);
        const landedRow = this.block.row;
        const landedCol = this.block.col;
        const landedKind = this.block.kind;
        this.block = null;
        this._updateBonusButton();
        this._saveGameState();

        if (landedKind === "bomb") {
            this.audio.bomb();
            this._triggerBombClear(landedRow, landedCol);
            return;
        }

        this._computeHintCells();
        this.audio.land();

        // Start word detection chain
        this.totalWordsInChain = 0;
        this.totalLettersInChain = 0;
        this._chainWords = [];
        this._checkWords(landedRow, landedCol);
    }

    _triggerBombClear(row, col) {
        const cellsToClear = new Set();

        for (let currentCol = 0; currentCol < this.grid.cols; currentCol++) {
            if (this.grid.get(row, currentCol) !== null) {
                cellsToClear.add(`${row},${currentCol}`);
            }
        }

        for (let currentRow = 0; currentRow < this.grid.rows; currentRow++) {
            if (this.grid.get(currentRow, col) !== null) {
                cellsToClear.add(`${currentRow},${col}`);
            }
        }

        this.renderer.hintCells = new Set();
        this._activeHintKey = null;

        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = BOMB_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "bomb";
        this.renderer.flashCells = new Set(cellsToClear);
        this.renderer.blastCells = new Set(cellsToClear);
        this.renderer.blastCenterKey = `${row},${col}`;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(cellsToClear);
        this._pendingClearCells = cellsToClear;
    }

    _checkWords(triggerRow, triggerCol) {
        // If triggerRow < 0, do a full-board scan (chain reaction)
        let result;
        if (triggerRow >= 0) {
            result = this.grid.findWordsThrough(triggerRow, triggerCol, this._getMinWordLength());
        } else {
            result = this.grid.findAllWords(this._getMinWordLength());
        }

        if (result.words.length === 0 && result.cells.size === 0) {
            // Word check already ran above and found nothing.
            // If the grid is now completely full, the last placed letter
            // didn't form any word — game over.
            if (this.grid.isGridFull()) {
                this._gameOver();
                return;
            }
            // No more words but grid still has space — apply chain bonus and continue.
            if (this.totalWordsInChain > 0) {
                const prevScore = this.score;
                this.score += this.totalWordsInChain * 50;
                this._checkBonusUnlock(prevScore, this.score);
                this._updateScoreDisplay();
            }
            this.clearing = false;
            this._computeHintCells();

            // Show word popup if any words were found in this chain
            if (this._chainWords && this._chainWords.length > 0) {
                const chainWords = this._chainWords;
                this._chainWords = [];
                this._showWordPopup(chainWords);
                return;
            }
            this._spawnBlock();
            return;
        }

        // Only score the longest word; still clear all cells
        const newWords = result.words.filter(w => !this.foundWordsThisGame.has(w));
        if (newWords.length > 0) {
            // Pick the longest (ties broken by first found)
            const best = newWords.reduce((a, b) => b.length > a.length ? b : a);
            const prevScore = this.score;
            const pts = best.length * 10 * best.length;
            this.score += pts;
            this._checkBonusUnlock(prevScore, this.score);
            this.totalWordsInChain++;
            this.wordsFound.push({ word: best, pts });
            if (!this._chainWords) this._chainWords = [];
            this._chainWords.push({ word: best, pts });
            // Mark all found words as seen so substrings don't re-score later
            for (const w of newWords) this.foundWordsThisGame.add(w);
        }
        this.totalLettersInChain += result.cells.size;
        this._updateScoreDisplay();

        if (this.totalWordsInChain > 1) {
            this.audio.chain();
        } else {
            this.audio.clear();
        }

        // Flash cells, then remove
        this.clearing = true;
        this.clearPhase = "flash";
        this.clearTimer = 0;
        this.clearFlashDuration = STANDARD_CLEAR_FLASH_DURATION;
        this.pendingClearMode = "words";
        this.renderer.flashCells = new Set(result.cells);
        this.renderer.blastCells.clear();
        this.renderer.blastCenterKey = null;
        this.renderer.blastProgress = 0;
        this.renderer.spawnParticles(result.cells);
        this._pendingClearCells = result.cells;
    }

    _processClearPhase(dt) {
        if (this.clearPhase === "flash") {
            this.renderer.flashTimer += dt;
            this.clearTimer += dt;
            if (this.pendingClearMode === "bomb") {
                this.renderer.blastProgress = Math.min(1, this.clearTimer / this.clearFlashDuration);
            }
            if (this.clearTimer >= this.clearFlashDuration) {
                // Remove cells
                this.grid.removeCells(this._pendingClearCells);
                this.renderer.flashCells.clear();
                this.renderer.flashTimer = 0;
                this.renderer.blastCells.clear();
                this.renderer.blastCenterKey = null;
                this.renderer.blastProgress = 0;
                this.pendingClearMode = "";

                // Apply gravity
                const moves = this.grid.applyGravity();
                if (moves.length > 0) {
                    this.pendingGravityMoves = moves.map(m => ({ ...m, progress: 0 }));
                    this.renderer.gravityAnims = this.pendingGravityMoves;
                    this.clearPhase = "gravity";
                    this.clearTimer = 0;
                } else {
                    this.clearPhase = "check";
                    this.clearTimer = 0;
                }
            }
        } else if (this.clearPhase === "gravity") {
            this.clearTimer += dt;
            const speed = 6; // cells per second
            let allDone = true;
            for (const m of this.pendingGravityMoves) {
                m.progress += speed * dt / Math.max(1, m.toRow - m.fromRow);
                if (m.progress < 1) allDone = false;
                else m.progress = 1;
            }
            if (allDone || this.clearTimer > 0.5) {
                this.renderer.gravityAnims = [];
                this.pendingGravityMoves = [];
                this.clearPhase = "check";
                this.clearTimer = 0;
            }
        } else if (this.clearPhase === "check") {
            // Full board scan for chain reactions
            this._checkWords(-1, -1);
        }
    }

    _togglePause() {
        if (this.letterChoiceActive) return;
        if (this.state === State.PLAYING) {
            this.state = State.PAUSED;
            this.els.pauseOverlay.classList.add("active");
        } else if (this.state === State.PAUSED) {
            this.state = State.PLAYING;
            this.els.pauseOverlay.classList.remove("active");
        }
    }

    _showWordPopup(words) {
        const container = this.els.wordPopup;
        container.innerHTML = "";

        // Build a row for each word with individually animated letters
        words.forEach((entry, wordIdx) => {
            const row = document.createElement("div");
            row.className = "word-popup-row";

            const letters = entry.word.split("");
            letters.forEach((ch, i) => {
                const span = document.createElement("span");
                span.className = "word-popup-letter";
                span.textContent = ch;
                // Random rotation for the entrance scatter effect
                const randomRot = Math.floor(Math.random() * 120) - 60;
                span.style.setProperty("--r", randomRot);
                // Stagger each letter, offset each word row
                const delay = wordIdx * 0.15 + i * 0.06;
                span.style.setProperty("--d", delay + "s");
                row.appendChild(span);
            });

            // Points label after letters
            const pts = document.createElement("span");
            pts.className = "word-popup-pts";
            pts.textContent = "+" + entry.pts;
            const ptsDelay = wordIdx * 0.15 + letters.length * 0.06 + 0.1;
            pts.style.setProperty("--d", ptsDelay + "s");
            row.appendChild(pts);

            container.appendChild(row);
        });

        // Pause falling — block stays frozen while popup is visible
        this._wordPopupActive = true;

        // After 2 seconds, animate out then spawn next block
        setTimeout(() => {
            const rows = container.querySelectorAll(".word-popup-row");
            rows.forEach(r => r.classList.add("pop-out"));

            // Remove after exit animation completes and spawn block
            setTimeout(() => {
                container.innerHTML = "";
                this._wordPopupActive = false;
                this._spawnBlock();
            }, 400);
        }, 2000);
    }


    _gameOver(reason = "board") {
        if (this.state === State.GAMEOVER) return;
        const timedOut = reason === "time";
        if (timedOut) {
            this.timeRemainingSeconds = 0;
            this._updateTimerDisplay();
        }
        this.state = State.GAMEOVER;
        this.block = null;
        this.audio.gameOver();
        this.renderer.hintCells = new Set();
        this._activeHintKey = null;

        // Clear saved game — this run is over
        this._clearGameState();

        // Record stats to profile
        const wordsCount = (this.wordsFound || []).length;
        this.profileMgr.recordGame(this.score, wordsCount);

        // Update high score from profile
        const profile = this.profileMgr.getActive();
        let isNew = false;
        if (profile && this.score >= profile.highScore) {
            this.highScore = profile.highScore;
            isNew = this.score > 0;
        }

        this.els.finalScore.textContent = `Score: ${this.score}`;
        this.els.newHighScore.classList.toggle("hidden", !isNew);
        this._showScreen("gameover");
    }

    // ── Profile methods ──

    _bindProfiles() {
        this.els.newProfileBtn.addEventListener("click", () => {
            this.els.profileNameInput.value = "";
            this.els.profileModal.classList.add("active");
            this.els.profileNameInput.focus();
        });
        this.els.profileSaveBtn.addEventListener("click", () => this._createProfile());
        this.els.profileCancelBtn.addEventListener("click", () => {
            this.els.profileModal.classList.remove("active");
        });
        // Allow Enter to submit
        this.els.profileNameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") this._createProfile();
        });
    }

    _createProfile() {
        const name = this.els.profileNameInput.value.trim();
        if (!name) { this.els.profileNameInput.focus(); return; }
        this.profileMgr.create(name);
        this._autoplayMusicFromUserAction();
        this.els.profileModal.classList.remove("active");
        this._loadActiveProfile();
        this._showScreen("menu");
    }

    _loadActiveProfile() {
        const profile = this.profileMgr.getActive();
        if (!profile) return;
        this.gridSize = profile.gridSize || 5;
        this.difficulty = profile.difficulty || "casual";
        this.gameMode = profile.gameMode || GAME_MODES.SANDBOX;
        this.highScore = profile.highScore || 0;
        this._highlightSizeButton();
        this._highlightGameModeButton();
        this._highlightDifficultyButton();
        this._updateDifficultySelector();
        this._updateHighScoreDisplay();
        this._updateMenuStats();
    }

    _renderProfilesList() {
        const list = this.els.profilesList;
        list.innerHTML = "";
        const profiles = this.profileMgr.getAll();

        if (profiles.length === 0) {
            list.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No profiles yet. Create one to get started!</p>';
            return;
        }

        for (const p of profiles) {
            const card = document.createElement("div");
            card.className = "profile-card";
            const initial = p.username.charAt(0).toUpperCase();
            card.innerHTML = `
                <div class="profile-avatar">${initial}</div>
                <div class="profile-info">
                    <div class="profile-name">${p.username}</div>
                    <div class="profile-stats">High Score: ${p.highScore} · Games: ${p.gamesPlayed} · Words: ${p.totalWords}</div>
                </div>
                <button class="profile-delete-btn" title="Delete profile">🗑</button>
            `;

            // Select profile
            card.addEventListener("click", (e) => {
                if (e.target.closest(".profile-delete-btn")) return;
                this.profileMgr.select(p.id);
                this._autoplayMusicFromUserAction();
                this._loadActiveProfile();
                this._showScreen("menu");
            });

            // Delete profile
            card.querySelector(".profile-delete-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                if (confirm(`Delete profile "${p.username}"? This cannot be undone.`)) {
                    this.profileMgr.delete(p.id);
                    this._renderProfilesList();
                    // If no profiles left, stay on profiles screen
                    if (!this.profileMgr.hasProfiles()) return;
                    // If active was deleted, load new active
                    if (this.profileMgr.getActive()) {
                        this._loadActiveProfile();
                    }
                }
            });

            list.appendChild(card);
        }
    }

    _updateMenuStats() {
        const profile = this.profileMgr.getActive();
        if (!profile) return;
        this.els.menuProfileName.textContent = `👤 ${profile.username}`;
        this.els.menuGamesPlayed.textContent = profile.gamesPlayed;
        this.els.menuTotalWords.textContent = profile.totalWords;
    }

    // ── Words Found rendering ──

    _getUniqueWordsFound() {
        const uniqueWords = new Map();

        for (const { word, pts } of this.wordsFound || []) {
            const existing = uniqueWords.get(word);
            if (existing) {
                existing.count += 1;
                existing.totalPts += pts;
                continue;
            }

            uniqueWords.set(word, {
                word,
                count: 1,
                totalPts: pts,
            });
        }

        return [...uniqueWords.values()];
    }

    _renderWordsFound() {
        const list = this.els.wordsFoundList;
        list.innerHTML = "";
        const words = this._getUniqueWordsFound();
        this.els.wordsFoundCount.textContent = `${words.length} unique word${words.length !== 1 ? "s" : ""} found`;

        if (words.length === 0) {
            list.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No words found this round.</p>';
            return;
        }

        for (const { word, count, totalPts } of words) {
            const item = document.createElement("div");
            item.className = "word-found-item";
            item.innerHTML = `
                <span class="word-found-text">${word}</span>
                <span class="word-found-pts">${count > 1 ? `x${count} · ` : ""}+${totalPts} pts</span>
            `;
            list.appendChild(item);
        }
    }

    // ── Music UI rendering ──

    _formatTrackTime(seconds) {
        if (!seconds || !isFinite(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
    }

    _updateMusicUI() {
        const track = this.music.getCurrentTrack();
        const playing = this.music.playing;

        // Full now-playing bar (music screen)
        this.els.npTitle.textContent = track ? track.title : "No track playing";
        this.els.npArtist.textContent = track ? track.artist : "";
        this._setMusicControlButton(this.els.npPlay, playing ? "pause" : "play", playing ? "Pause" : "Play");

        // Highlight playing track in list
        this.els.trackList.querySelectorAll(".track-item").forEach(el => {
            el.classList.toggle("playing", el.dataset.trackId === this.music.currentTrackId);
            const btn = el.querySelector(".track-play-btn");
            if (btn) btn.textContent = (el.dataset.trackId === this.music.currentTrackId && playing) ? "⏸" : "▶";
        });

        // Mini bar
        this._updateMiniNowPlaying();
    }

    _updateMusicProgress(currentTime, duration) {
        const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
        this.els.npProgressFill.style.width = pct + "%";
        this.els.npCurrentTime.textContent = this._formatTrackTime(currentTime);
        this.els.npDuration.textContent = this._formatTrackTime(duration);
    }

    _updateMiniNowPlaying() {
        const track = this.music.getCurrentTrack();
        this.els.npMiniTitle.textContent = track ? `♪ ${track.title} – ${track.artist}` : "♪ ---";
        this._setMusicControlButton(this.els.npMiniToggle, this.music.playing ? "pause" : "play", this.music.playing ? "Pause" : "Play");
    }

    _renderMusicScreen() {
        this._renderPlaylistTabs();
        this._renderTrackList();
        this._updateMusicUI();
        // Show/hide playlist actions for custom playlists
        this.els.playlistActions.classList.toggle("hidden", this.activePlaylistTab === "__default");
    }

    _renderPlaylistTabs() {
        // Remove old custom tabs
        this.els.playlistTabs.querySelectorAll(".playlist-tab:not(.add-tab)").forEach(el => {
            if (el.dataset.playlist !== "__default") el.remove();
        });
        // Remove default tab's active class and re-query
        const defaultTab = this.els.playlistTabs.querySelector('[data-playlist="__default"]');
        if (defaultTab) defaultTab.classList.toggle("active", this.activePlaylistTab === "__default");

        // Add custom playlist tabs before the "+ New" button
        for (const pl of this.plMgr.getCustomPlaylists()) {
            const tab = document.createElement("button");
            tab.className = "playlist-tab" + (this.activePlaylistTab === pl.name ? " active" : "");
            tab.dataset.playlist = pl.name;
            tab.textContent = pl.name;
            tab.addEventListener("click", () => {
                this.activePlaylistTab = pl.name;
                this._renderMusicScreen();
            });
            this.els.playlistTabs.insertBefore(tab, this.els.newPlaylistTab);
        }

        // Default tab click
        if (defaultTab) {
            defaultTab.onclick = () => {
                this.activePlaylistTab = "__default";
                this._renderMusicScreen();
            };
        }
    }

    _renderTrackList() {
        const container = this.els.trackList;
        container.innerHTML = "";
        const isCustom = this.activePlaylistTab !== "__default";
        const tracks = this.plMgr.getPlaylistTracks(this.activePlaylistTab);
        const trackIds = this.plMgr.getPlaylistTrackIds(this.activePlaylistTab);

        if (tracks.length === 0) {
            container.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">No tracks in this playlist.</p>';
            return;
        }

        tracks.forEach((track, index) => {
            const item = document.createElement("div");
            item.className = "track-item" + (track.id === this.music.currentTrackId ? " playing" : "");
            item.dataset.trackId = track.id;

            const isPlaying = track.id === this.music.currentTrackId && this.music.playing;

            item.innerHTML = `
                <button class="track-play-btn">${isPlaying ? "⏸" : "▶"}</button>
                <div class="track-info">
                    <div class="track-name">${track.title}</div>
                    <div class="track-artist">${track.artist}</div>
                </div>
                <div class="track-reorder">
                    <button class="reorder-btn move-up" ${index === 0 ? "disabled" : ""}>▲</button>
                    <button class="reorder-btn move-down" ${index === tracks.length - 1 ? "disabled" : ""}>▼</button>
                </div>
                ${isCustom ? '<button class="track-remove-btn" title="Remove from playlist">✕</button>' : ""}
            `;

            // Play button
            item.querySelector(".track-play-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                if (track.id === this.music.currentTrackId && this.music.playing) {
                    this.music.pause();
                } else {
                    this.music.setActivePlaylist(this.activePlaylistTab);
                    this.music.playTrackById(track.id);
                }
            });

            // Reorder buttons
            item.querySelector(".move-up")?.addEventListener("click", (e) => {
                e.stopPropagation();
                if (index > 0) {
                    this.plMgr.moveTrack(this.activePlaylistTab, index, index - 1);
                    this.music.refreshQueue();
                    this._renderTrackList();
                }
            });
            item.querySelector(".move-down")?.addEventListener("click", (e) => {
                e.stopPropagation();
                if (index < tracks.length - 1) {
                    this.plMgr.moveTrack(this.activePlaylistTab, index, index + 1);
                    this.music.refreshQueue();
                    this._renderTrackList();
                }
            });

            // Remove from custom playlist
            const removeBtn = item.querySelector(".track-remove-btn");
            if (removeBtn) {
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.plMgr.removeTrackFromPlaylist(this.activePlaylistTab, track.id);
                    this.music.refreshQueue();
                    this._renderTrackList();
                });
            }

            // Click row to play
            item.addEventListener("click", () => {
                this.music.setActivePlaylist(this.activePlaylistTab);
                this.music.playTrackById(track.id);
            });

            container.appendChild(item);
        });
    }

    _openPlaylistModal(editName) {
        this._editingPlaylist = editName;
        this.els.playlistModalTitle.textContent = editName ? `Edit: ${editName}` : "New Playlist";
        this.els.playlistNameInput.value = editName || "";

        const existing = editName ? new Set(this.plMgr.getPlaylistTrackIds(editName)) : new Set();
        const picker = this.els.playlistTrackPicker;
        picker.innerHTML = "";

        for (const track of this.plMgr.allTracks) {
            const div = document.createElement("div");
            div.className = "picker-item";
            div.innerHTML = `
                <input type="checkbox" value="${track.id}" ${existing.has(track.id) ? "checked" : ""}>
                <div>
                    <div class="picker-track-name">${track.title}</div>
                    <div class="picker-track-artist">${track.artist}</div>
                </div>
            `;
            div.addEventListener("click", (e) => {
                if (e.target.tagName !== "INPUT") {
                    const cb = div.querySelector("input");
                    cb.checked = !cb.checked;
                }
            });
            picker.appendChild(div);
        }

        this.els.playlistModal.classList.add("active");
        this.els.playlistNameInput.focus();
    }

    _savePlaylistModal() {
        const name = this.els.playlistNameInput.value.trim();
        if (!name) { this.els.playlistNameInput.focus(); return; }

        const checked = [...this.els.playlistTrackPicker.querySelectorAll("input:checked")];
        const trackIds = checked.map(cb => cb.value);

        if (this._editingPlaylist) {
            // Rename if name changed
            if (this._editingPlaylist !== name) {
                this.plMgr.renamePlaylist(this._editingPlaylist, name);
            }
            // Update tracks: delete and recreate
            this.plMgr.deletePlaylist(name);
            this.plMgr.createPlaylist(name, trackIds);
        } else {
            if (!this.plMgr.createPlaylist(name, trackIds)) {
                alert("A playlist with that name already exists.");
                return;
            }
        }

        this.els.playlistModal.classList.remove("active");
        this.activePlaylistTab = name;
        this.music.refreshQueue();
        this._renderMusicScreen();
    }

    // ── Main loop ──
    _loop(timestamp) {
        const dt = this.lastTime ? Math.min((timestamp - this.lastTime) / 1000, 0.1) : 0;
        this.lastTime = timestamp;

        if (this.state === State.PLAYING) {
            // Periodic auto-save every 5 seconds
            this._autoSaveTimer += dt;
            if (this._autoSaveTimer >= 5) {
                this._autoSaveTimer = 0;
                this._saveGameState();
            }

            if (this.timeLimitSeconds > 0) {
                this.timeRemainingSeconds = Math.max(0, this.timeRemainingSeconds - dt);
                this._updateTimerDisplay();
                if (this.timeRemainingSeconds <= 0) {
                    this._gameOver("time");
                }
            }

            if (this.state !== State.PLAYING) {
                this.renderer.draw(this.grid, this.block, 0);
                requestAnimationFrame((t) => this._loop(t));
                return;
            }

            if (this.clearing) {
                this._processClearPhase(dt);
            } else if (this._wordPopupActive) {
                // Word popup is showing — freeze, don't fall or spawn
            } else if (this.block) {
                if (this.block.dropAnimating) {
                    const swipeDropSpeed = 18;
                    this.block.visualRow += swipeDropSpeed * dt;
                    if (this.block.visualRow >= this.block.row) {
                        this.block.visualRow = this.block.row;
                        this.block.dropAnimating = false;
                        this._landBlock();
                    }
                } else {
                    this.fallTimer += dt;
                    if (this.fallTimer >= this.fallInterval) {
                        this.fallTimer -= this.fallInterval;
                        // Try to move block down
                        const nextRow = this.block.row + 1;
                        if (nextRow < 0) {
                            // Still in buffer zone, always move down
                            this.block.row = nextRow;
                        } else if (nextRow < this.gridSize && this.grid.isEmpty(nextRow, this.block.col)) {
                            this.block.row = nextRow;
                        } else if (this.block.row < 0) {
                            // Block is in buffer and column below is full — hover, don't land
                            // Game over only if every column is full
                            if (this.grid.isGridFull()) {
                                this._gameOver();
                            }
                            // Otherwise just stay hovering at current buffer row
                        } else {
                            // Block is inside the grid and can't move down — land it
                            this.block.visualRow = this.block.row;
                            this._landBlock();
                        }
                    }
                    // Smooth visual interpolation
                    if (this.block) {
                        const t = this.fallTimer / this.fallInterval;
                        this.block.visualRow = this.block.row - 1 + t;
                        // Clamp to top of buffer zone
                        if (this.block.visualRow < -BUFFER_ROWS) this.block.visualRow = -BUFFER_ROWS;
                        // Clamp: don't show below actual row
                        if (this.block.visualRow > this.block.row) this.block.visualRow = this.block.row;
                    }
                }
            }

            // Render
            this.renderer.draw(this.grid, this.block, dt);
        } else if (this.state === State.PAUSED) {
            // Still draw but don't update
            this.renderer.draw(this.grid, this.block, 0);
        }

        requestAnimationFrame((t) => this._loop(t));
    }
}

// Handle window resize
let resizeTimeout;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const g = window._game;
        if (g && g.state !== State.MENU && g.state !== State.GAMEOVER && g.grid) {
            g.renderer.resize(g.grid.rows, g.grid.cols);
        }
    }, 150);
});

// Prevent scrolling on touch devices
document.addEventListener("touchmove", (e) => {
    const target = e.target;
    const game = window._game;
    const isScrollablePanel = target.closest("#words-found-list, #track-list, #profiles-list, #playlist-tabs, #playlist-track-picker, .overlay-content");
    if (isScrollablePanel) return;
    if (game?.state === State.PLAYING && target.closest("#play-screen")) {
        e.preventDefault();
    }
}, { passive: false });

// Auto-save when the user navigates away or closes the tab
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        const g = window._game;
        if (g && (g.state === State.PLAYING || g.state === State.PAUSED || g.state === State.CLEARING)) {
            g._saveGameState();
        }
    }
});
window.addEventListener("beforeunload", () => {
    const g = window._game;
    if (g && (g.state === State.PLAYING || g.state === State.PAUSED || g.state === State.CLEARING)) {
        g._saveGameState();
    }
});

// ── Bootstrap ──
// Load track list + dictionary, then start the game
Promise.all([
    loadTrackList(),
    loadDictionary().catch((err) => {
        console.error("Dictionary initialization failed.", err);
        DICTIONARY = new Set();
        _buildHintSets();
    })
]).then(() => {
    window._game = new Game();
});
