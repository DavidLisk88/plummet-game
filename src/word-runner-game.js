/**
 * Word Runner — PixiJS 8 + GSAP + Chance.js
 * ===========================================
 * A neon-aesthetic side-scrolling letter-platformer.
 *
 * Architecture:
 *   - PixiJS v8 for all rendering (WebGL/WebGPU)
 *   - Custom AABB physics (no external physics engine)
 *   - Camera follows player in world-space with parallax layers
 *   - Noise-based terrain heightmap (hills, valleys, natural gaps)
 *   - GSAP-driven character animation (run cycle, squash/stretch)
 *   - Chance.js for seeded procedural generation
 *   - Trie-based word prefix awareness
 *
 * Classes:
 *   - WordRunnerGame: lifecycle wrapper (creates/destroys PixiJS app)
 *   - WRScene:        main gameplay (physics, terrain, input, rendering)
 *   - NeonRunner:     animated geometric character with glow trail
 *   - Particles:      pooled world-space particle system
 *   - WordTrie:       fast prefix/word lookup
 */

import { Application, Container, Graphics, Text, Sprite, Texture } from "pixi.js";
import gsap from "gsap";
import Chance from "chance";

console.log(
    "%c[WordRunner v1-neon] PixiJS 8 · GSAP · Chance · noise terrain · camera follow",
    "color: #00ccaa; font-weight: bold; font-size: 14px;"
);

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const PAL = {
    BG:              "#0a0e1a",
    GROUND_FILL:     0x1a3040,
    GROUND_EDGE:     0x00ccaa,
    GROUND_DETAIL:   0x00ccaa,
    PLATFORM_FILL:   0x1a2838,
    PLATFORM_EDGE:   0x0088cc,
    PLAYER:          0xffaa00,
    PLAYER_GLOW:     0xffdd44,
    LETTER_COMMON:   0x00ddff,
    LETTER_UNCOMMON: 0x44ff88,
    LETTER_RARE:     0xff44aa,
    LETTER_LEGENDARY:0xffcc00,
    OBSTACLE_FILL:   0x661122,
    OBSTACLE_EDGE:   0xcc2244,
    DUST:            0x557799,
    SPARK:           0xffcc44,
    DEATH:           0xff4466,
    STAR:            0x334466,
    FLASH_VALID:     0x22c55e,
    FLASH_INVALID:   0xef4444,
};

const PHY = {
    GRAVITY:     1800,
    JUMP_VY:     -700,
    AIR_JUMP_VY: -580,
    MAX_FALL:    1100,
    PLAYER_W:    16,
    PLAYER_H:    38,
    AIR_JUMPS:   4,
    COYOTE_MS:   80,
    BUFFER_MS:   100,
};

const CFG = {
    INITIAL_SPEED: 180,
    MAX_SPEED:     560,
    SPEED_RAMP:    0.12,
    WORD_BOOST:    8,
    GROUND_Y_PCT:  0.80,
    CAM_LEAD:      100,
    CAM_LERP:      0.07,
    COL_W:         50,
    SPAWN_AHEAD:   1200,
    CULL_BEHIND:   400,
    LETTER_MAGNET: 0,
    LETTER_PULL:   0,
    LETTER_R:      14,
    COLLECT_R:     10,
    MAX_LETTERS:   8,
};

// ═══════════════════════════════════════════════════════════════════════════════
//  MATH UTILITIES + NOISE
// ═══════════════════════════════════════════════════════════════════════════════

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function smoothstep(t) { return t * t * (3 - 2 * t); }

function _hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
}

function noise1D(x) {
    const i = Math.floor(x);
    const f = x - i;
    return lerp(_hash(i), _hash(i + 1), smoothstep(f));
}

function fbm(x, octaves = 3, persistence = 0.5) {
    let val = 0, amp = 1, freq = 1, maxAmp = 0;
    for (let o = 0; o < octaves; o++) {
        val += noise1D(x * freq + o * 777.7) * amp;
        maxAmp += amp;
        amp *= persistence;
        freq *= 2;
    }
    return val / maxAmp;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WORD TRIE (prefix + word lookup)
// ═══════════════════════════════════════════════════════════════════════════════

class WordTrie {
    constructor(dictionary) {
        this.root = {};
        for (const w of dictionary) {
            let node = this.root;
            const upper = typeof w === "string" ? w.toUpperCase() : "";
            for (const ch of upper) {
                if (!node[ch]) node[ch] = {};
                node = node[ch];
            }
            node.$ = true;
        }
    }
    isWord(w) {
        let n = this.root;
        for (const ch of w) { if (!n[ch]) return false; n = n[ch]; }
        return n.$ === true;
    }
    isPrefix(p) {
        let n = this.root;
        for (const ch of p) { if (!n[ch]) return false; n = n[ch]; }
        return true;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function letterColor(letter, letterValues) {
    const val = (letterValues && letterValues[letter]) || 1;
    if (val >= 9) return PAL.LETTER_LEGENDARY;
    if (val >= 5) return PAL.LETTER_RARE;
    if (val >= 3) return PAL.LETTER_UNCOMMON;
    return PAL.LETTER_COMMON;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NEON RUNNER CHARACTER
// ═══════════════════════════════════════════════════════════════════════════════

class NeonRunner {
    constructor(worldLayer) {
        this.container = new Container();
        this.glowGfx = new Graphics();
        this.bodyGfx = new Graphics();
        this.container.addChild(this.glowGfx);
        this.container.addChild(this.bodyGfx);
        this.container.zIndex = 40;
        worldLayer.addChild(this.container);

        this.pose = { ll: 0, rl: 0, la: 0, ra: 0 };
        this.sq = { x: 1, y: 1 };

        this.trail = [];
        this.trailGfx = new Graphics();
        this.trailGfx.zIndex = 39;
        worldLayer.addChild(this.trailGfx);

        this._runTl = null;
        this._dead = false;
    }

    startRun() {
        if (this._runTl) this._runTl.kill();
        this._runTl = gsap.timeline({ repeat: -1 });
        this._runTl.to(this.pose, {
            ll: -32, rl: 32, la: 28, ra: -28,
            duration: 0.22, ease: "sine.inOut",
        });
        this._runTl.to(this.pose, {
            ll: 32, rl: -32, la: -28, ra: 28,
            duration: 0.22, ease: "sine.inOut",
        });
    }

    stopRun() {
        if (this._runTl) { this._runTl.kill(); this._runTl = null; }
        gsap.to(this.pose, { ll: 0, rl: 0, la: 0, ra: 0, duration: 0.15 });
    }

    onJump() {
        gsap.killTweensOf(this.sq);
        gsap.to(this.sq, { x: 0.82, y: 1.25, duration: 0.07, ease: "power2.out" });
        gsap.to(this.sq, { x: 1, y: 1, duration: 0.35, delay: 0.07, ease: "elastic.out(1, 0.4)" });
    }

    onLand(impactVy) {
        const i = clamp(Math.abs(impactVy) / 900, 0.05, 0.45);
        gsap.killTweensOf(this.sq);
        gsap.to(this.sq, { x: 1 + i * 0.5, y: 1 - i * 0.5, duration: 0.04, ease: "power2.out" });
        gsap.to(this.sq, { x: 1, y: 1, duration: 0.35, delay: 0.04, ease: "elastic.out(1, 0.5)" });
    }

    die() {
        this._dead = true;
        this.stopRun();
        gsap.to(this.container, { alpha: 0, duration: 0.4 });
    }

    draw(wx, wy) {
        this.container.position.set(wx, wy);
        this.bodyGfx.clear();
        this.glowGfx.clear();
        if (this._dead) return;

        const sx = this.sq.x, sy = this.sq.y;

        // Glow aura (behind everything)
        this.glowGfx.circle(0, -8, 24);
        this.glowGfx.fill({ color: PAL.PLAYER_GLOW, alpha: 0.10 });

        // Head
        this.bodyGfx.circle(0, -21 * sy, 5.5 * sx);
        this.bodyGfx.fill({ color: PAL.PLAYER });
        this.bodyGfx.circle(0, -21 * sy, 5.5 * sx);
        this.bodyGfx.stroke({ color: PAL.PLAYER_GLOW, width: 1.5, alpha: 0.6 });

        // Torso
        const tw = 10 * sx, tTop = -15 * sy, tH = 17 * sy;
        this.bodyGfx.roundRect(-tw / 2, tTop, tw, tH, 2);
        this.bodyGfx.fill({ color: PAL.PLAYER });

        // Legs (batched — same style)
        const legLen = 14 * sy, hipY = tTop + tH;
        const llr = this.pose.ll * Math.PI / 180;
        const rlr = this.pose.rl * Math.PI / 180;
        this.bodyGfx.moveTo(-3, hipY);
        this.bodyGfx.lineTo(-3 + Math.sin(llr) * legLen, hipY + Math.cos(llr) * legLen);
        this.bodyGfx.moveTo(3, hipY);
        this.bodyGfx.lineTo(3 + Math.sin(rlr) * legLen, hipY + Math.cos(rlr) * legLen);
        this.bodyGfx.stroke({ color: PAL.PLAYER, width: 3 });

        // Arms (batched)
        const armLen = 10 * sy, shY = tTop + 5;
        const lar = this.pose.la * Math.PI / 180;
        const rar = this.pose.ra * Math.PI / 180;
        this.bodyGfx.moveTo(-tw / 2, shY);
        this.bodyGfx.lineTo(-tw / 2 + Math.sin(lar) * armLen, shY + Math.cos(lar) * armLen);
        this.bodyGfx.moveTo(tw / 2, shY);
        this.bodyGfx.lineTo(tw / 2 + Math.sin(rar) * armLen, shY + Math.cos(rar) * armLen);
        this.bodyGfx.stroke({ color: PAL.PLAYER, width: 2 });
    }

    updateTrail(wx, wy) {
        this.trail.unshift({ x: wx, y: wy, a: 0.3 });
        if (this.trail.length > 5) this.trail.pop();
        for (const t of this.trail) t.a *= 0.78;
    }

    drawTrail() {
        this.trailGfx.clear();
        for (const t of this.trail) {
            if (t.a < 0.02) continue;
            this.trailGfx.circle(t.x, t.y - 8, 7);
            this.trailGfx.fill({ color: PAL.PLAYER, alpha: t.a * 0.3 });
        }
    }

    destroy() {
        gsap.killTweensOf(this.pose);
        gsap.killTweensOf(this.sq);
        gsap.killTweensOf(this.container);
        if (this._runTl) this._runTl.kill();
        this.container.destroy({ children: true });
        this.trailGfx.destroy();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PARTICLE SYSTEM (world-space, drawn via single Graphics)
// ═══════════════════════════════════════════════════════════════════════════════

class Particles {
    constructor(worldLayer) {
        this.gfx = new Graphics();
        this.gfx.zIndex = 55;
        worldLayer.addChild(this.gfx);
        this.list = [];
    }

    emit(wx, wy, count, cfg) {
        const aMin = cfg.aMin ?? 0, aMax = cfg.aMax ?? 360;
        const sMin = cfg.sMin ?? 30, sMax = cfg.sMax ?? 100;
        for (let i = 0; i < count; i++) {
            const angle = (aMin + Math.random() * (aMax - aMin)) * Math.PI / 180;
            const spd = sMin + Math.random() * (sMax - sMin);
            this.list.push({
                x: wx, y: wy,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd,
                life: (cfg.life ?? 0.4) * (0.6 + Math.random() * 0.4),
                ml: cfg.life ?? 0.4,
                sz: (cfg.size ?? 3) * (0.5 + Math.random() * 0.5),
                color: cfg.color ?? 0xffffff,
                grav: cfg.grav ?? 0,
            });
        }
        if (this.list.length > 300) this.list.splice(0, this.list.length - 300);
    }

    update(dt) {
        for (let i = this.list.length - 1; i >= 0; i--) {
            const p = this.list[i];
            p.life -= dt;
            if (p.life <= 0) { this.list.splice(i, 1); continue; }
            p.vy += p.grav * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
    }

    draw() {
        this.gfx.clear();
        for (const p of this.list) {
            const a = clamp(p.life / p.ml, 0, 1);
            this.gfx.circle(p.x, p.y, p.sz * (0.3 + 0.7 * a));
            this.gfx.fill({ color: p.color, alpha: a * 0.8 });
        }
    }

    destroy() { this.gfx.destroy(); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN GAME SCENE
// ═══════════════════════════════════════════════════════════════════════════════

class WRScene {
    constructor(app, options) {
        this.app = app;
        this.screenW = app.screen.width;
        this.screenH = app.screen.height;
        this.seed = options.seed;
        this.chance = this.seed != null ? new Chance(this.seed) : new Chance();

        // Options from host
        this.highScore = options.highScore || 0;
        this.randomLetterFn = options.randomLetterFn || (() => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)]);
        this.dictionaryRef = options.dictionaryRef || new Set();
        this.audioRef = options.audioRef;
        this.letterValuesRef = options.letterValuesRef || {};
        this.coinsForWordFn = options.coinsForWordFn || ((len) => len * 2);
        this.callbacks = options.callbacks || {};
        this.autoPilot = !!options.autoPilot;
        this.autoCollectWords = !!options.autoCollectWords;
        this.cinematicMode = !!options.cinematicMode;
        this.countdownDuration = Number.isFinite(options.countdownSeconds) ? Math.max(0, options.countdownSeconds) : 3;
        this.initialSpeed = Number.isFinite(options.initialSpeed) ? options.initialSpeed : CFG.INITIAL_SPEED;
        this.maxSpeed = Number.isFinite(options.maxSpeed) ? options.maxSpeed : CFG.MAX_SPEED;
        this.speedRamp = Number.isFinite(options.speedRamp) ? options.speedRamp : CFG.SPEED_RAMP;
        this.wordBoost = Number.isFinite(options.wordBoost) ? options.wordBoost : CFG.WORD_BOOST;
        this.overlayTitle = typeof options.overlayTitle === "string" ? options.overlayTitle.trim() : "";
        this.overlaySubtitle = typeof options.overlaySubtitle === "string" ? options.overlaySubtitle.trim() : "";
        this.overlayDuration = Number.isFinite(options.overlayDuration) ? Math.max(0, options.overlayDuration) : 5.5;
        this.targetWords = Array.isArray(options.targetWords)
            ? options.targetWords
                .filter((w) => typeof w === "string")
                .map((w) => w.toUpperCase().trim())
                .filter((w) => w.length >= 3 && w.length <= CFG.MAX_LETTERS)
            : [];
        this.targetWordIndex = 0;
        this.targetWordStallTimer = 0;
        this.targetWordStallLimit = Number.isFinite(options.targetWordStallSeconds)
            ? Math.max(0.8, options.targetWordStallSeconds)
            : 2.4;

        // Trie for prefix checking
        this.trie = new WordTrie(this.dictionaryRef);

        // ── Layer hierarchy ──
        this.bgLayer = new Container();
        this.worldLayer = new Container();
        this.hudLayer = new Container();
        this.bgLayer.zIndex = -10;
        this.worldLayer.zIndex = 0;
        this.worldLayer.sortableChildren = true;
        this.hudLayer.zIndex = 90;
        app.stage.sortableChildren = true;
        app.stage.addChild(this.bgLayer);
        app.stage.addChild(this.worldLayer);
        app.stage.addChild(this.hudLayer);

        // Camera
        this.cameraX = 0;

        // Ground baseline
        this.baseGroundY = Math.floor(this.screenH * CFG.GROUND_Y_PCT);

        // ── Player state ──
        this.player = {
            worldX: 120,
            y: this.baseGroundY - PHY.PLAYER_H,
            vy: 0,
            grounded: false,
            airJumps: 0,
            coyoteTimer: 0,
            jumpBuffer: 0,
            wasGrounded: false,
            prevVy: 0,
        };

        // ── Game state ──
        this.scrollSpeed = this.initialSpeed;
        this.distance = 0;
        this.score = 0;
        this.wordScore = 0;
        this.coins = 0;
        this.wordsFormed = [];
        this.wordStreak = 0;
        this.maxWordStreak = 0;
        this.collectedLetters = [];
        this.isPaused = false;
        this.dead = false;
        this.gameOver = false;
        this.countdownTimer = 0;
        this._lastCountSec = 0;
        this.autoPilotJumpCooldown = 0;
        this.autoCollectJumpCooldown = 0;
        this.autoCollectTarget = null;
        this.autoCollectPlan = null;
        this.overlayTimer = 0;

        // ── World objects ──
        this.columns = new Map();
        this.platforms = [];
        this.letters = [];
        this._nextPlatX = 0;
        this._nextLetterX = 0;
        this._gapRun = 0;

        // ── Visual effects ──
        this.flash = { timer: 0, color: 0 };
        this.shake = { timer: 0, intensity: 0 };
        this.flashGfx = new Graphics();
        this.flashGfx.zIndex = 95;
        this.hudLayer.addChild(this.flashGfx);

        // ── HUD ──
        this.hiScoreText = new Text({
            text: "",
            style: { fontFamily: "monospace", fontSize: 11, fill: "#6688aa", fontWeight: "bold" },
        });
        this.hiScoreText.anchor.set(1, 0);
        this.hiScoreText.position.set(this.screenW - 12, 10);
        this.hudLayer.addChild(this.hiScoreText);

        this.overlayTitleText = new Text({
            text: this.overlayTitle,
            style: { fontFamily: "sans-serif", fontSize: 28, fontWeight: "bold", fill: "#f4d35e", letterSpacing: 1 },
        });
        this.overlayTitleText.position.set(24, 22);
        this.overlayTitleText.alpha = 0;
        this.overlayTitleText.visible = false;
        this.hudLayer.addChild(this.overlayTitleText);

        this.overlaySubtitleText = new Text({
            text: this.overlaySubtitle,
            style: { fontFamily: "sans-serif", fontSize: 14, fontWeight: "bold", fill: "#8fd3ff", letterSpacing: 3 },
        });
        this.overlaySubtitleText.position.set(26, 58);
        this.overlaySubtitleText.alpha = 0;
        this.overlaySubtitleText.visible = false;
        this.hudLayer.addChild(this.overlaySubtitleText);

        this.streakText = new Text({
            text: "",
            style: { fontFamily: "sans-serif", fontSize: 14, fill: "#ffcc00", fontWeight: "bold" },
        });
        this.streakText.anchor.set(0.5, 0);
        this.streakText.position.set(this.screenW / 2, 14);
        this.streakText.visible = false;
        this.hudLayer.addChild(this.streakText);

        this.goText = new Text({
            text: "GAME OVER",
            style: { fontFamily: "sans-serif", fontSize: 28, fontWeight: "bold", fill: "#ff4466" },
        });
        this.goText.anchor.set(0.5);
        this.goText.position.set(this.screenW / 2, this.screenH * 0.4);
        this.goText.visible = false;
        this.hudLayer.addChild(this.goText);

        this.goScore = new Text({
            text: "",
            style: { fontFamily: "sans-serif", fontSize: 14, fill: "#88aacc" },
        });
        this.goScore.anchor.set(0.5);
        this.goScore.position.set(this.screenW / 2, this.screenH * 0.4 + 35);
        this.goScore.visible = false;
        this.hudLayer.addChild(this.goScore);

        // ── Countdown overlay ──
        this.countdownText = new Text({
            text: "3",
            style: { fontFamily: "sans-serif", fontSize: 64, fontWeight: "bold", fill: "#ffffff",
                     stroke: { color: "#000000", width: 4 } },
        });
        this.countdownText.anchor.set(0.5);
        this.countdownText.position.set(this.screenW / 2, this.screenH * 0.38);
        this.countdownText.visible = false;
        this.countdownText.zIndex = 200;
        this.hudLayer.addChild(this.countdownText);

        this.countdownLabel = new Text({
            text: "GET READY",
            style: { fontFamily: "sans-serif", fontSize: 14, fontWeight: "bold", fill: "#88aacc",
                     letterSpacing: 4 },
        });
        this.countdownLabel.anchor.set(0.5);
        this.countdownLabel.position.set(this.screenW / 2, this.screenH * 0.38 + 50);
        this.countdownLabel.visible = false;
        this.countdownLabel.zIndex = 200;
        this.hudLayer.addChild(this.countdownLabel);

        // ── Character & Particles ──
        this.runner = new NeonRunner(this.worldLayer);
        this.particles = new Particles(this.worldLayer);

        // ── Input ──
        this._setupInput();

        // ── Background ──
        this._drawBackground();
    }

    // ── Initialization ──────────────────────────────────────────────────────

    init(savedState) {
        if (savedState && savedState.type === "word-runner") {
            this._restoreState(savedState);
        } else {
            this._freshStart();
        }
        this.overlayTimer = (this.overlayTitle || this.overlaySubtitle) ? this.overlayDuration : 0;
        this.runner.startRun();
        if (this.callbacks.onResumed && savedState) {
            this.callbacks.onResumed(this.collectedLetters);
        }
        // Start 3-second countdown (both fresh and resumed games)
        this._startCountdown();
    }

    _startCountdown() {
        if (this.countdownDuration <= 0) {
            this.countdownTimer = 0;
            this.countdownText.visible = false;
            this.countdownLabel.visible = false;
            this.isPaused = false;
            if (this.runner._runTl) this.runner._runTl.resume();
            return;
        }
        this.countdownTimer = 3.0;
        this._lastCountSec = 0;
        this.countdownTimer = this.countdownDuration;
        this.countdownText.text = String(Math.max(1, Math.ceil(this.countdownDuration)));
        this.countdownText.visible = true;
        this.countdownText.alpha = 1;
        this.countdownText.scale.set(1);
        this.countdownLabel.visible = true;
        this.countdownLabel.alpha = 1;
        this.isPaused = true;
        if (this.runner._runTl) this.runner._runTl.pause();
    }

    _freshStart() {
        const safeCols = Math.ceil(600 / CFG.COL_W);
        for (let ci = -2; ci <= safeCols; ci++) {
            this._forceGroundColumn(ci, this.baseGroundY);
        }
        this._nextPlatX = this.screenW + 200;
        this._nextLetterX = 300;
        this._spawnTerrain();
        this._spawnLetters();
        this._spawnPlatforms();
    }

    _restoreState(saved) {
        this.player.worldX = saved.player?.worldX || 120;
        this.player.y = saved.player?.y || this.baseGroundY - PHY.PLAYER_H;
        this.player.vy = saved.player?.vy || 0;
        this.scrollSpeed = saved.scrollSpeed || this.initialSpeed;
        this.score = saved.score || 0;
        this.wordScore = saved.wordScore || 0;
        this.coins = saved.coins || 0;
        this.wordsFormed = saved.wordsFormed || [];
        this.wordStreak = saved.wordStreak || 0;
        this.maxWordStreak = saved.maxWordStreak || saved.wordStreak || 0;
        this.collectedLetters = saved.collectedLetters || [];
        this.distance = saved.distance || 0;
        this.cameraX = this.player.worldX - this.screenW * 0.25;

        const startCol = Math.floor((this.player.worldX - 300) / CFG.COL_W);
        const endCol = Math.ceil((this.player.worldX + this.screenW + CFG.SPAWN_AHEAD) / CFG.COL_W);
        for (let ci = startCol; ci <= endCol; ci++) {
            this._generateColumn(ci);
        }
        for (const p of (saved.platforms || [])) {
            this._addPlatform(p.worldX, p.y, p.w, p.h);
        }
        for (const l of (saved.letters || [])) {
            if (!l.collected) this._addLetter(l.worldX, l.worldY, l.letter);
        }
        this._nextPlatX = this.player.worldX + this.screenW;
        this._nextLetterX = this.player.worldX + 200;
    }

    // ── Input ───────────────────────────────────────────────────────────────

    _setupInput() {
        this._keyDown = (e) => {
            if (this.countdownTimer > 0) return;
            if (this.isPaused || this.dead) return;
            if (e.code === "Space" || e.code === "ArrowUp") {
                e.preventDefault();
                this._tryJump();
            }
            if (e.code === "Escape") this.pauseGame();
        };
        window.addEventListener("keydown", this._keyDown);

        this._pointerDown = () => {
            if (this.countdownTimer > 0) return;
            if (this.isPaused || this.dead) return;
            this._tryJump();
        };
        this.app.canvas.addEventListener("pointerdown", this._pointerDown);
    }

    _tryJump() {
        const p = this.player;
        const canCoyote = !p.grounded && p.coyoteTimer > 0 && p.airJumps === 0;

        if (p.grounded || canCoyote) {
            p.vy = PHY.JUMP_VY;
            p.airJumps = 0;
            p.coyoteTimer = 0;
            p.jumpBuffer = 0;
            this.runner.onJump();
            this.particles.emit(p.worldX, p.y + PHY.PLAYER_H / 2, 5, {
                aMin: 200, aMax: 340, sMin: 30, sMax: 80,
                life: 0.35, size: 2.5, color: PAL.DUST, grav: 200,
            });
            try { this.audioRef?._beep(440, 0.08, "sine", 0.08); } catch (e) { /* */ }
        } else if (p.airJumps < PHY.AIR_JUMPS) {
            p.vy = PHY.AIR_JUMP_VY;
            p.airJumps++;
            p.jumpBuffer = 0;
            this.runner.onJump();
            this.particles.emit(p.worldX, p.y, 4, {
                aMin: 0, aMax: 360, sMin: 20, sMax: 60,
                life: 0.3, size: 2, color: PAL.PLAYER_GLOW, grav: 100,
            });
            try { this.audioRef?._beep(470, 0.08, "sine", 0.08); } catch (e) { /* */ }
        } else {
            p.jumpBuffer = PHY.BUFFER_MS;
        }
    }

    // ── Core Update Loop ────────────────────────────────────────────────────

    update(dt) {
        // ── 3-second countdown ──
        if (this.countdownTimer > 0) {
            this.countdownTimer -= dt;
            const sec = Math.ceil(this.countdownTimer);
            if (this.countdownTimer <= 0) {
                // GO!
                this.countdownTimer = 0;
                this.countdownText.text = "GO!";
                this.countdownLabel.visible = false;
                this.isPaused = false;
                if (this.runner._runTl) this.runner._runTl.resume();
                gsap.to(this.countdownText, {
                    alpha: 0, duration: 0.4, ease: "power2.out",
                });
                gsap.to(this.countdownText.scale, {
                    x: 1.5, y: 1.5, duration: 0.4, ease: "power2.out",
                    onComplete: () => { this.countdownText.visible = false; },
                });
            } else {
                this.countdownText.text = String(sec);
                if (this._lastCountSec !== sec) {
                    this._lastCountSec = sec;
                    this.countdownText.scale.set(1.3);
                    gsap.to(this.countdownText.scale, { x: 1, y: 1, duration: 0.2, ease: "back.out" });
                }
            }
            return;
        }

        if (this.isPaused || this.dead) return;
        const p = this.player;
        p.prevVy = p.vy;

        // Speed ramp
        this.scrollSpeed = Math.min(this.maxSpeed, this.scrollSpeed + this.speedRamp * dt);

        // Forward motion
        const dx = this.scrollSpeed * dt;
        p.worldX += dx;
        this.distance += dx;

        // Gravity
        p.vy += PHY.GRAVITY * dt;
        p.vy = Math.min(p.vy, PHY.MAX_FALL);
        p.y += p.vy * dt;

        // ── Ground collision ──
        p.grounded = false;
        const groundY = this._getGroundAt(p.worldX);
        const feetY = p.y + PHY.PLAYER_H / 2;
        if (groundY !== null && feetY >= groundY && p.vy >= 0) {
            p.y = groundY - PHY.PLAYER_H / 2;
            p.vy = 0;
            p.grounded = true;
        }

        // ── Platform collision ──
        if (!p.grounded && p.vy >= 0) {
            for (const plat of this.platforms) {
                if (p.worldX + PHY.PLAYER_W / 2 > plat.worldX &&
                    p.worldX - PHY.PLAYER_W / 2 < plat.worldX + plat.w) {
                    const prevFeetY = (p.y - p.vy * dt) + PHY.PLAYER_H / 2;
                    if (prevFeetY <= plat.y + 4 && feetY >= plat.y) {
                        p.y = plat.y - PHY.PLAYER_H / 2;
                        p.vy = 0;
                        p.grounded = true;
                        break;
                    }
                }
            }
        }

        // ── Grounded state management ──
        if (p.grounded) {
            if (!p.wasGrounded && Math.abs(p.prevVy) > 80) {
                this.runner.onLand(p.prevVy);
                this.particles.emit(p.worldX, p.y + PHY.PLAYER_H / 2, 4, {
                    aMin: 170, aMax: 370, sMin: 15, sMax: 50,
                    life: 0.3, size: 2, color: PAL.DUST, grav: 150,
                });
            }
            p.airJumps = 0;
            p.coyoteTimer = PHY.COYOTE_MS;
        } else {
            p.coyoteTimer = Math.max(0, p.coyoteTimer - dt * 1000);
        }

        // Jump buffer
        if (p.grounded && p.jumpBuffer > 0) this._tryJump();
        p.jumpBuffer = Math.max(0, p.jumpBuffer - dt * 1000);
        p.wasGrounded = p.grounded;

        // ── Camera follow ──
        const targetCamX = p.worldX - this.screenW * 0.25 + CFG.CAM_LEAD;
        this.cameraX = lerp(this.cameraX, targetCamX, 1 - Math.pow(1 - CFG.CAM_LERP, dt * 60));

        let shakeX = 0, shakeY = 0;
        if (this.shake.timer > 0) {
            this.shake.timer -= dt;
            shakeX = (Math.random() - 0.5) * this.shake.intensity;
            shakeY = (Math.random() - 0.5) * this.shake.intensity;
        }
        this.worldLayer.x = -this.cameraX + shakeX;
        this.worldLayer.y = shakeY;

        // ── Spawn & cull (terrain/platforms also needed before autopilot jumps) ──
        this._spawnTerrain();
        this._spawnPlatforms();
        if (this.autoPilot) this._updateAutoPilot(dt);
        this._spawnLetters();
        this._cullObjects();

        // ── Letter collection (contact only, no magnet) ──
        if (this.autoCollectWords) this._updateAutoCollector(dt);
        for (const l of this.letters) {
            if (l.collected) continue;
            // In target-word mode: always strict — only collect the designated target
            // (null target means we're waiting for a plan; skip everything).
            // In free-form mode: skip only when there's an explicit non-matching target.
            if (this.autoCollectWords && this.targetWords.length > 0 && l !== this.autoCollectTarget) continue;
            if (this.autoCollectWords && this.targetWords.length === 0 && this.autoCollectTarget && l !== this.autoCollectTarget) continue;
            // AABB overlap: player box vs letter box
            const halfPW = PHY.PLAYER_W / 2;
            const halfPH = PHY.PLAYER_H / 2;
            const halfLR = CFG.COLLECT_R;
            const overlapX = Math.abs(p.worldX - l.worldX) < halfPW + halfLR;
            const overlapY = Math.abs(p.y - l.worldY) < halfPH + halfLR;

            if (overlapX && overlapY && this.collectedLetters.length < CFG.MAX_LETTERS) {
                this._collectLetter(l);
            }

            const bob = Math.sin(performance.now() / 1000 * 2.5 + l.bobPhase) * 3;
            l.container.position.set(l.worldX, l.worldY + bob);
        }

        // ── Spike collision ──
        this._checkSpikeCollision();

        // ── Fall death ──
        if (p.y > this.screenH + 30) {
            if (this.cinematicMode) {
                // Snap back to ground — never let the showcase die from a fall.
                const safeGround = this._getGroundAt(p.worldX) ?? this.baseGroundY;
                p.y = safeGround - PHY.PLAYER_H / 2;
                p.vy = PHY.JUMP_VY * 0.6;
                p.grounded = false;
            } else {
                this._die(); return;
            }
        }

        // ── Score ──
        this.score = this.wordScore + Math.floor(this.distance / 15);
        if (this.score > this.highScore) this.highScore = this.score;

        // ── Render character ──
        this.runner.updateTrail(p.worldX, p.y);
        this.runner.draw(p.worldX, p.y);
        this.runner.drawTrail();

        // Running dust
        if (p.grounded && Math.random() < 0.12) {
            this.particles.emit(p.worldX - 4, p.y + PHY.PLAYER_H / 2, 1, {
                aMin: 210, aMax: 330, sMin: 15, sMax: 40,
                life: 0.3, size: 1.8, color: PAL.DUST, grav: 100,
            });
        }

        // Speed lines at high speed
        const speedPct = this.scrollSpeed / CFG.MAX_SPEED;
        if (speedPct > 0.45 && Math.random() < speedPct * 0.35) {
            this.particles.emit(
                p.worldX - 12 - Math.random() * 10,
                p.y - PHY.PLAYER_H * 0.3 + Math.random() * PHY.PLAYER_H * 0.6,
                1, { aMin: 170, aMax: 190, sMin: 60, sMax: 120, life: 0.25, size: 1.5, color: PAL.PLAYER_GLOW, grav: 0 }
            );
        }

        // Particles
        this.particles.update(dt);
        this.particles.draw();

        // Flash overlay
        if (this.flash.timer > 0) {
            this.flash.timer -= dt;
            this.flashGfx.clear();
            const fa = Math.min(0.25, this.flash.timer * 0.5);
            this.flashGfx.rect(0, 0, this.screenW, this.screenH);
            this.flashGfx.fill({ color: this.flash.color, alpha: fa });
        } else {
            this.flashGfx.clear();
        }

        // HUD
        this._updateShowcaseOverlay(dt);
        this._updateHUD();

        // Callback
        if (this.callbacks.onStateUpdate) {
            this.callbacks.onStateUpdate({
                score: this.score, distance: this.distance,
                coins: this.coins, highScore: this.highScore,
            });
        }
    }

    // ── Terrain Columns ─────────────────────────────────────────────────────

    _getGroundAt(worldX) {
        const ci = Math.floor(worldX / CFG.COL_W);
        const col = this.columns.get(ci);
        if (!col || col.groundY === null) return null;
        return col.groundY;
    }

    _generateColumn(ci) {
        if (this.columns.has(ci)) return;
        const worldX = ci * CFG.COL_W;
        const diff = clamp(this.distance / 10000, 0, 1);

        // Noise-based height
        const n = fbm(worldX * 0.003, 3, 0.5);

        // Gap detection (separate noise layer)
        const gn = fbm(worldX * 0.007 + 500, 2, 0.4);
        let gapThresh = 0.13 + diff * 0.07;
        if (this.cinematicMode) gapThresh *= 0.25;

        // Max gap enforcement (based on jump distance at current speed)
        const airTime = 2 * Math.abs(PHY.JUMP_VY) / PHY.GRAVITY + Math.abs(PHY.AIR_JUMP_VY) / PHY.GRAVITY;
        const maxGapPx = Math.max(80, this.scrollSpeed * airTime * 0.7);
        let maxGapCols = Math.max(1, Math.floor(maxGapPx / CFG.COL_W));
        if (this.cinematicMode) maxGapCols = Math.max(1, Math.floor(maxGapCols * 0.55));

        if (gn < gapThresh && this._gapRun < maxGapCols && worldX > 500) {
            this._gapRun++;
            this.columns.set(ci, { worldX, groundY: null, gfx: null, spikeGfx: null, spikeBox: null });
            return;
        }
        this._gapRun = 0;

        // Ground height with noise variation
        const heightRange = 50 + diff * 20;
        const groundY = this.baseGroundY - (n - 0.5) * heightRange;

        // Draw column
        const bottomY = this.screenH + 30;
        const colH = bottomY - groundY;
        const gfx = new Graphics();
        gfx.rect(0, 0, CFG.COL_W + 1, colH);
        gfx.fill({ color: PAL.GROUND_FILL });
        gfx.moveTo(0, 0);
        gfx.lineTo(CFG.COL_W + 1, 0);
        gfx.stroke({ color: PAL.GROUND_EDGE, width: 2, alpha: 0.65 });

        // Surface detail
        const dCount = 1 + Math.floor(Math.random() * 3);
        for (let d = 0; d < dCount; d++) {
            const ddx = 4 + Math.random() * (CFG.COL_W - 8);
            gfx.circle(ddx, 4 + Math.random() * 3, 0.5 + Math.random() * 0.8);
            gfx.fill({ color: PAL.GROUND_DETAIL, alpha: 0.2 });
        }
        gfx.position.set(worldX, groundY);
        gfx.zIndex = 2;
        this.worldLayer.addChild(gfx);

        // Spike obstacle
        let spikeGfx = null, spikeBox = null;
        const spikeLikelihood = this.cinematicMode ? 0.8 + diff * 3 : 4 + diff * 14;
        if (diff > 0.08 && this.chance.bool({ likelihood: spikeLikelihood })) {
            let canSpike = true;
            for (let j = ci - 4; j < ci; j++) {
                const prev = this.columns.get(j);
                if (prev && prev.spikeBox) { canSpike = false; break; }
            }
            if (canSpike) {
                const sw = 18 + Math.random() * 10;
                const sh = 22 + Math.random() * 12;
                spikeGfx = new Graphics();
                spikeGfx.moveTo(0, sh);
                spikeGfx.lineTo(sw / 2, 0);
                spikeGfx.lineTo(sw, sh);
                spikeGfx.closePath();
                spikeGfx.fill({ color: PAL.OBSTACLE_FILL });
                spikeGfx.moveTo(0, sh);
                spikeGfx.lineTo(sw / 2, 0);
                spikeGfx.lineTo(sw, sh);
                spikeGfx.closePath();
                spikeGfx.stroke({ color: PAL.OBSTACLE_EDGE, width: 1.5 });
                const spX = worldX + (CFG.COL_W - sw) / 2;
                const spY = groundY - sh;
                spikeGfx.position.set(spX, spY);
                spikeGfx.zIndex = 3;
                this.worldLayer.addChild(spikeGfx);
                spikeBox = { x: spX + 3, y: spY + 4, w: sw - 6, h: sh - 4 };
            }
        }

        this.columns.set(ci, { worldX, groundY, gfx, spikeGfx, spikeBox });
    }

    _forceGroundColumn(ci, gy) {
        if (this.columns.has(ci)) return;
        const worldX = ci * CFG.COL_W;
        const bottomY = this.screenH + 30;
        const colH = bottomY - gy;
        const gfx = new Graphics();
        gfx.rect(0, 0, CFG.COL_W + 1, colH);
        gfx.fill({ color: PAL.GROUND_FILL });
        gfx.moveTo(0, 0);
        gfx.lineTo(CFG.COL_W + 1, 0);
        gfx.stroke({ color: PAL.GROUND_EDGE, width: 2, alpha: 0.65 });
        gfx.position.set(worldX, gy);
        gfx.zIndex = 2;
        this.worldLayer.addChild(gfx);
        this.columns.set(ci, { worldX, groundY: gy, gfx, spikeGfx: null, spikeBox: null });
    }

    _spawnTerrain() {
        const rightEdge = this.cameraX + this.screenW + CFG.SPAWN_AHEAD;
        const endCol = Math.ceil(rightEdge / CFG.COL_W);
        const startCol = Math.floor((this.cameraX - CFG.CULL_BEHIND) / CFG.COL_W);
        for (let ci = startCol; ci <= endCol; ci++) {
            this._generateColumn(ci);
        }
    }

    // ── Platforms ────────────────────────────────────────────────────────────

    // Check if a world-X position is above a hole (no ground within range)
    _isAboveHole(wx, halfSpan) {
        halfSpan = halfSpan || 20;
        for (let x = wx - halfSpan; x <= wx + halfSpan; x += CFG.COL_W) {
            const ci = Math.floor(x / CFG.COL_W);
            const col = this.columns.get(ci);
            if (!col || col.groundY === null) return true;
        }
        return false;
    }

    // Check if a world-X is near a spike within `dist` pixels
    _isNearSpike(wx, dist) {
        const colRange = Math.ceil(dist / CFG.COL_W);
        const centerCol = Math.floor(wx / CFG.COL_W);
        for (let c = centerCol - colRange; c <= centerCol + colRange; c++) {
            const col = this.columns.get(c);
            if (col && col.spikeBox) {
                if (Math.abs(wx - (col.spikeBox.x + col.spikeBox.w / 2)) < dist) return true;
            }
        }
        return false;
    }

    // Check if a world-X is near a hole edge within `dist` pixels
    _isNearHole(wx, dist) {
        const colRange = Math.ceil(dist / CFG.COL_W) + 1;
        const centerCol = Math.floor(wx / CFG.COL_W);
        for (let c = centerCol - colRange; c <= centerCol + colRange; c++) {
            const col = this.columns.get(c);
            // Only count actual generated columns with no ground as holes
            // Ungenerated columns (!col) are NOT holes — just not loaded yet
            if (col && col.groundY === null) {
                const holeX = c * CFG.COL_W + CFG.COL_W / 2;
                if (Math.abs(wx - holeX) < dist) return true;
            }
        }
        return false;
    }

    _spawnPlatforms() {
        const rightEdge = this.cameraX + this.screenW + CFG.SPAWN_AHEAD;
        // Forced minimum height: platforms must be HIGH (require multi-jump)
        // Single jump peak ≈ VY²/(2g) ≈ 136px → min 180px forces double jump
        const MIN_PLAT_ELEVATION = 90;
        const MAX_PLAT_ELEVATION = 140;

        while (this._nextPlatX < rightEdge) {
            const diff = clamp(this.distance / 10000, 0, 1);
            const platformLikelihood = this.cinematicMode ? 55 + diff * 18 : 30 + diff * 20;
            if (this.chance.bool({ likelihood: platformLikelihood })) {
                const groundY = this._getGroundAt(this._nextPlatX);
                if (groundY !== null) {
                    // FORCE: no floating platform above holes
                    const pw = 90 + this.chance.floating({ min: 0, max: 60 });
                    const ph = 10;

                    if (!this._isAboveHole(this._nextPlatX, pw / 2 + 30)) {
                        // FORCE: elevation always between MIN and MAX (high up)
                        const elevation = MIN_PLAT_ELEVATION +
                            this.chance.floating({ min: 0, max: MAX_PLAT_ELEVATION - MIN_PLAT_ELEVATION });
                        this._addPlatform(this._nextPlatX, groundY - elevation, pw, ph);
                    }
                }
            }
            const minGap = this.cinematicMode ? 130 : 180;
            const gapVariance = this.cinematicMode ? 95 : 150;
            this._nextPlatX += minGap + this.chance.floating({ min: 0, max: gapVariance });
        }
    }

    _addPlatform(wx, wy, w, h) {
        const gfx = new Graphics();
        gfx.roundRect(0, 0, w, h, 3);
        gfx.fill({ color: PAL.PLATFORM_FILL });
        gfx.roundRect(0, 0, w, h, 3);
        gfx.stroke({ color: PAL.PLATFORM_EDGE, width: 2, alpha: 0.8 });
        gfx.position.set(wx, wy);
        gfx.zIndex = 2;
        this.worldLayer.addChild(gfx);
        this.platforms.push({ worldX: wx, y: wy, w, h, gfx });
    }

    // ── Letters ─────────────────────────────────────────────────────────────

    _spawnLetters() {
        const rightEdge = this.cameraX + this.screenW + CFG.SPAWN_AHEAD;
        const SPIKE_CLEARANCE = 100;   // letters must be this far from any spike
        const HOLE_CLEARANCE = 80;     // letters must be this far from any hole edge

        while (this._nextLetterX < rightEdge) {
            let targetY = null;
            let blocked = false;

            // Check spike proximity — if too close, jump past the spike zone in one step
            if (this._isNearSpike(this._nextLetterX, SPIKE_CLEARANCE)) {
                blocked = true;
            }

            // Check hole proximity for ground-level placement
            const nearHole = !blocked && this._isNearHole(this._nextLetterX, HOLE_CLEARANCE);

            if (!blocked) {
                // Try ground first (only if not near a hole)
                if (!nearHole) {
                    const groundY = this._getGroundAt(this._nextLetterX);
                    if (groundY !== null) {
                        const ci = Math.floor(this._nextLetterX / CFG.COL_W);
                        const col = this.columns.get(ci);
                        if (!col || !col.spikeBox) {
                            targetY = groundY - 30 - Math.random() * 10;
                        }
                    }
                }

                // Or place on a platform (safe regardless of holes — platforms are high up)
                if (targetY === null || this.chance.bool({ likelihood: 50 })) {
                    for (const plat of this.platforms) {
                        if (Math.abs(plat.worldX + plat.w / 2 - this._nextLetterX) < plat.w / 2 + 20) {
                            targetY = plat.y - 26;
                            break;
                        }
                    }
                }

                if (targetY !== null) {
                    const letter = this.randomLetterFn();
                    this._addLetter(this._nextLetterX, targetY, letter);
                }
            }

            // Always advance by the normal gap — no micro-stepping
            const baseGap = Math.max(160, this.scrollSpeed * 0.9);
            this._nextLetterX += baseGap + this.chance.floating({ min: 0, max: baseGap * 0.6 });
        }
    }

    _addLetter(wx, wy, letter) {
        const color = letterColor(letter, this.letterValuesRef);
        const container = new Container();

        const circle = new Graphics();
        circle.circle(0, 0, CFG.LETTER_R + 3);
        circle.fill({ color, alpha: 0.08 });
        circle.circle(0, 0, CFG.LETTER_R);
        circle.fill({ color, alpha: 0.15 });
        circle.circle(0, 0, CFG.LETTER_R);
        circle.stroke({ color, width: 2, alpha: 0.8 });
        container.addChild(circle);

        const text = new Text({
            text: letter,
            style: {
                fontFamily: "monospace", fontSize: 18, fontWeight: "bold",
                fill: "#ffffff", stroke: { color: "#000000", width: 2 },
            },
        });
        text.anchor.set(0.5);
        container.addChild(text);

        container.position.set(wx, wy);
        container.zIndex = 10;
        this.worldLayer.addChild(container);

        this.letters.push({
            worldX: wx, worldY: wy, letter, color,
            collected: false, container, text,
            bobPhase: Math.random() * Math.PI * 2,
        });
    }

    _collectLetter(l) {
        l.collected = true;
        if (this.autoCollectTarget === l) this.autoCollectTarget = null;
        if (this.autoCollectPlan && this.autoCollectPlan.seq && this.autoCollectPlan.seq.length > 0) {
            if (this.autoCollectPlan.seq[0] === l) {
                this.autoCollectPlan.seq.shift();
            } else {
                this.autoCollectPlan = null;
            }
            if (this.autoCollectPlan && this.autoCollectPlan.seq.length === 0) this.autoCollectPlan = null;
        }
        this.collectedLetters.push(l.letter);

        gsap.to(l.container, {
            y: l.container.y - 30, alpha: 0,
            duration: 0.25, ease: "power2.out",
            onComplete: () => { if (l.container.parent) l.container.destroy({ children: true }); },
        });
        gsap.to(l.container.scale, { x: 1.4, y: 1.4, duration: 0.25, ease: "power2.out" });

        this.particles.emit(l.worldX, l.worldY, 8, {
            aMin: 0, aMax: 360, sMin: 40, sMax: 130,
            life: 0.4, size: 2.5, color: l.color, grav: -50,
        });

        try { this.audioRef?._beep(660 + this.collectedLetters.length * 80, 0.12, "sine", 0.12); } catch (e) { /* */ }
        if (this.callbacks.onLetterCollected) this.callbacks.onLetterCollected([...this.collectedLetters]);
    }

    _getForwardLetters(minAhead = 12, maxAhead = 380, maxCount = 20) {
        const p = this.player;
        const minX = p.worldX + minAhead;
        const maxX = p.worldX + maxAhead;
        const letters = [];

        for (const l of this.letters) {
            if (l.collected) continue;
            if (l.worldX < minX || l.worldX > maxX) continue;
            letters.push(l);
        }
        letters.sort((a, b) => a.worldX - b.worldX);
        return letters.slice(0, maxCount);
    }

    _isAutoLetterReachable(letter) {
        const p = this.player;
        const dx = letter.worldX - p.worldX;
        if (dx < 12 || dx > 380) return false;

        const dy = letter.worldY - p.y;
        // Too high relative to current runner position tends to produce misses.
        if (dy < -230) return false;
        // Too far below usually means it is effectively missed while airborne.
        if (dy > 250) return false;

        return true;
    }

    _letterRiskPenalty(letter) {
        let penalty = 0;

        if (this._isNearSpike(letter.worldX, 70)) penalty += 180;

        // Hole-adjacent low letters are risky because pathing often requires
        // awkward descent timing.
        if (this._isNearHole(letter.worldX, 70) && letter.worldY > this.baseGroundY - 100) {
            penalty += 145;
        }

        return penalty;
    }

    _buildWordPlanFromPrefix(prefix) {
        const p = this.player;
        const forward = this._getForwardLetters();
        if (forward.length === 0) return null;

        const maxDepth = Math.min(6, CFG.MAX_LETTERS - prefix.length);
        if (maxDepth <= 0) return null;

        let nodeBudget = 1400;

        let frontier = [{
            word: prefix,
            seq: [],
            lastIndex: -1,
            score: 0,
            hasWord: prefix.length >= 3 && this.dictionaryRef.has(prefix),
        }];

        const beamWidth = 16;

        for (let depth = 0; depth < maxDepth; depth++) {
            const nextFrontier = [];

            for (const state of frontier) {
                for (let i = state.lastIndex + 1; i < forward.length; i++) {
                    if (--nodeBudget <= 0) break;
                    const l = forward[i];
                    if (!this._isAutoLetterReachable(l)) continue;

                    const nextWord = state.word + l.letter;
                    if (nextWord.length > CFG.MAX_LETTERS) continue;

                    const isWord = nextWord.length >= 3 && this.dictionaryRef.has(nextWord);
                    const isPrefix = this.trie.isPrefix(nextWord);
                    if (!isWord && !isPrefix) continue;

                    const dx = l.worldX - p.worldX;
                    const dy = Math.abs(l.worldY - p.y);
                    const risk = this._letterRiskPenalty(l);

                    // Score rewards word completion and coherent continuation,
                    // while penalizing risky/awkward letters.
                    let delta = 0;
                    if (isWord) delta += 240 + nextWord.length * 20;
                    if (isPrefix) delta += 24;
                    delta += Math.max(0, 210 - dx) * 0.25;
                    delta += Math.max(0, 220 - dy) * 0.09;
                    delta -= risk;

                    // Avoid spending starters on letters that don't progress far.
                    if (state.word.length < 2 && !isWord) delta -= 16;

                    nextFrontier.push({
                        word: nextWord,
                        seq: [...state.seq, l],
                        lastIndex: i,
                        score: state.score + delta,
                        hasWord: state.hasWord || isWord,
                    });
                }
                if (nodeBudget <= 0) break;
            }

            if (nextFrontier.length === 0) break;

            nextFrontier.sort((a, b) => b.score - a.score);
            frontier = nextFrontier.slice(0, beamWidth);
        }

        if (frontier.length === 0) return null;

        // Prefer plans that actually complete at least one word. Only fall back
        // to prefix-only chains when already mid-sequence.
        let ranked = frontier.filter((s) => s.seq.length > 0 && s.hasWord);
        if (ranked.length === 0 && prefix.length >= 1) {
            ranked = frontier.filter((s) => s.seq.length > 0);
        }
        if (ranked.length === 0) return null;

        ranked.sort((a, b) => b.score - a.score);
        const best = ranked[0];

        // Avoid starting weak 3-letter plans when we have no committed letters.
        if (prefix.length === 0 && best.word.length < 4) return null;

        return {
            word: best.word,
            seq: [...best.seq],
            score: best.score,
        };
    }

    _currentTargetWord() {
        if (!this.targetWords.length) return null;
        return this.targetWords[this.targetWordIndex % this.targetWords.length] || null;
    }

    _advanceTargetWord() {
        if (!this.targetWords.length) return;
        this.targetWordIndex = (this.targetWordIndex + 1) % this.targetWords.length;
        this.targetWordStallTimer = 0;
        this.autoCollectPlan = null;
        this.autoCollectTarget = null;
    }

    _buildPlanForTargetWord(prefix, targetWord) {
        if (!targetWord) return null;
        if (!targetWord.startsWith(prefix)) return null;

        const remaining = targetWord.slice(prefix.length);
        if (remaining.length === 0) {
            return { word: targetWord, seq: [], score: 9999 };
        }

        const p = this.player;
        const forward = this._getForwardLetters(12, 460, 28);
        if (!forward.length) return null;

        let states = [{ seq: [], lastIndex: -1, step: 0, score: 0 }];
        const beamWidth = 12;

        for (let step = 0; step < remaining.length; step++) {
            const ch = remaining[step];
            const nextStates = [];

            for (const state of states) {
                for (let i = state.lastIndex + 1; i < forward.length; i++) {
                    const l = forward[i];
                    if (l.letter !== ch) continue;
                    if (!this._isAutoLetterReachable(l)) continue;

                    const dx = l.worldX - p.worldX;
                    const dy = Math.abs(l.worldY - p.y);
                    const risk = this._letterRiskPenalty(l);

                    let delta = 140;
                    delta += Math.max(0, 260 - dx) * 0.22;
                    delta += Math.max(0, 220 - dy) * 0.08;
                    delta -= risk;

                    nextStates.push({
                        seq: [...state.seq, l],
                        lastIndex: i,
                        step: state.step + 1,
                        score: state.score + delta,
                    });
                }
            }

            if (nextStates.length === 0) return null;
            nextStates.sort((a, b) => b.score - a.score);
            states = nextStates.slice(0, beamWidth);
        }

        if (!states.length) return null;
        states.sort((a, b) => b.score - a.score);
        return {
            word: targetWord,
            seq: [...states[0].seq],
            score: states[0].score,
        };
    }

    _isPlanStillValid(plan) {
        if (!plan || !plan.seq || plan.seq.length === 0) return false;
        const next = plan.seq[0];
        if (!next || next.collected) return false;
        if (!this._isAutoLetterReachable(next)) return false;
        return true;
    }

    _refreshAutoCollectPlan(dt) {
        const prefix = this.collectedLetters.join("");

        if (this.targetWords.length > 0) {
            const targetWord = this._currentTargetWord();
            if (!targetWord) { this.autoCollectTarget = null; return; }

            // If collected letters drift from the target prefix, reset.
            if (prefix.length > 0 && !targetWord.startsWith(prefix)) {
                this.collectedLetters = [];
                this.autoCollectPlan = null;
                this.autoCollectTarget = null;
            }

            const cleanPrefix = this.collectedLetters.join("");

            // Whole word collected — validate it.
            if (cleanPrefix === targetWord) {
                const result = this.validateWord();
                if (!result || result.word !== targetWord) {
                    this.collectedLetters = [];
                    this._advanceTargetWord();
                }
                return;
            }

            // Simple next-letter targeting: no beam search needed because the
            // letter tape is deterministic and the needed letter WILL appear ahead.
            const nextLetterNeeded = targetWord[cleanPrefix.length];
            if (!nextLetterNeeded) return;

            // Keep current target if it's still valid.
            if (
                this.autoCollectTarget &&
                !this.autoCollectTarget.collected &&
                this.autoCollectTarget.letter === nextLetterNeeded
            ) {
                this.targetWordStallTimer = 0;
                return;
            }

            // Find nearest uncollected matching letter in the forward window.
            const forward = this._getForwardLetters(12, 900, 50);
            let found = null;
            for (const l of forward) {
                if (l.letter === nextLetterNeeded) { found = l; break; }
            }

            if (found) {
                this.targetWordStallTimer = 0;
                this.autoCollectTarget = found;
            } else {
                this.targetWordStallTimer += dt;
                if (this.targetWordStallTimer >= this.targetWordStallLimit) {
                    this.collectedLetters = [];
                    this._advanceTargetWord();
                }
                this.autoCollectTarget = null;
            }
            return;
        }

        // If current prefix is already invalid, drop it to avoid spiraling into
        // bad picks. This is showcase-only behavior.
        if (prefix.length > 0 && !this.trie.isPrefix(prefix) && !this.dictionaryRef.has(prefix)) {
            this.collectedLetters = [];
        }

        if (this._isPlanStillValid(this.autoCollectPlan)) return;

        const effectivePrefix = this.collectedLetters.join("");
        this.autoCollectPlan = this._buildWordPlanFromPrefix(effectivePrefix);
        this.autoCollectTarget = this.autoCollectPlan?.seq?.[0] || null;
    }

    _updateAutoCollector(dt) {
        this.autoCollectJumpCooldown = Math.max(0, this.autoCollectJumpCooldown - dt);
        if (this.autoCollectJumpCooldown > 0) {
            if (this.autoCollectTarget && this.autoCollectTarget.collected) this.autoCollectTarget = null;
            return;
        }
        if (this.collectedLetters.length >= CFG.MAX_LETTERS) return;

        this._refreshAutoCollectPlan(dt);

        const p = this.player;
        const target = this.autoCollectTarget;
        if (!target) return;

        // No magnetic pull: we only steer jump timing so the runner physically
        // passes through letters in sequence.
        const dx = target.worldX - p.worldX;
        const dy = target.worldY - p.y;
        const inApproachWindow = dx > 12 && dx < 500;
        if (!inApproachWindow) return;

        // Only jump if the letter is well above ground level (i.e., on a platform).
        // Ground-level letters (dy ≈ -10..30) are collected by simply running through them.
        if (p.grounded && dy < -38) {
            this._tryJump();
            this.autoCollectJumpCooldown = 0.12;
            return;
        }

        if (!p.grounded && p.vy > 80 && dy < -30 && p.airJumps < PHY.AIR_JUMPS) {
            this._tryJump();
            this.autoCollectJumpCooldown = 0.14;
        }
    }

    // ── Spike collision ─────────────────────────────────────────────────────

    _checkSpikeCollision() {
        const p = this.player;
        const px = p.worldX - PHY.PLAYER_W / 2;
        const py = p.y - PHY.PLAYER_H / 2;
        const ci = Math.floor(p.worldX / CFG.COL_W);

        for (let j = ci - 1; j <= ci + 1; j++) {
            const col = this.columns.get(j);
            if (!col || !col.spikeBox) continue;
            const s = col.spikeBox;
            if (px < s.x + s.w && px + PHY.PLAYER_W > s.x && py < s.y + s.h && py + PHY.PLAYER_H > s.y) {
                if (this.cinematicMode) {
                    // Bounce over the spike — never die in cinematic mode.
                    p.vy = PHY.JUMP_VY;
                    p.airJumps = 0;
                    this.autoPilotJumpCooldown = 0.22;
                    return;
                }
                this._die();
                return;
            }
        }
    }

    _hasHoleAhead(distanceAhead) {
        const startX = this.player.worldX + PHY.PLAYER_W * 0.75;
        const endX = startX + distanceAhead;
        const step = Math.max(12, CFG.COL_W * 0.5);
        for (let x = startX; x <= endX; x += step) {
            if (this._getGroundAt(x) === null) return true;
        }
        return false;
    }

    _hasSpikeAhead(distanceAhead) {
        const startX = this.player.worldX + PHY.PLAYER_W * 0.75;
        const endX = startX + distanceAhead;
        const startCol = Math.floor(startX / CFG.COL_W) - 1;
        const endCol = Math.ceil(endX / CFG.COL_W) + 1;
        for (let ci = startCol; ci <= endCol; ci++) {
            const col = this.columns.get(ci);
            if (!col || !col.spikeBox) continue;
            if (col.spikeBox.x < endX && col.spikeBox.x + col.spikeBox.w > startX) return true;
        }
        return false;
    }

    _hasPlatformAhead(worldX) {
        for (const plat of this.platforms) {
            if (worldX >= plat.worldX - 18 && worldX <= plat.worldX + plat.w + 18) return true;
        }
        return false;
    }

    // Returns true if a non-target letter is at roughly the player's height
    // within distanceAhead pixels. Used by autopilot to jump over wrong letters.
    _hasWrongLetterAhead(distanceAhead) {
        if (!this.autoCollectWords) return false;
        const p = this.player;
        const minX = p.worldX + PHY.PLAYER_W;
        const maxX = p.worldX + distanceAhead;
        for (const l of this.letters) {
            if (l.collected) continue;
            if (l === this.autoCollectTarget) continue; // the letter we WANT is not an obstacle
            if (l.worldX < minX || l.worldX > maxX) continue;
            // Only treat letters in the player's travel plane as obstacles:
            // roughly ground-level (within ~55px above or 35px below player center).
            const dy = l.worldY - p.y;
            if (dy > -55 && dy < 35) return true;
        }
        return false;
    }

    _updateAutoPilot(dt) {
        this.autoPilotJumpCooldown = Math.max(0, this.autoPilotJumpCooldown - dt);

        const p = this.player;
        const speedRatio = clamp(this.scrollSpeed / Math.max(this.maxSpeed, 1), 0, 1);

        // ── Emergency: spike or hole directly underfoot / imminent ──
        // Bypass cooldown for life-threatening situations.
        const emergencySpike = this._hasSpikeAhead(32);
        const emergencyHole  = p.grounded && this._hasHoleAhead(28);
        if ((emergencySpike || emergencyHole) && p.grounded) {
            this.autoPilotJumpCooldown = 0;
        }

        if (this.autoPilotJumpCooldown > 0) return;

        const holeTrigger        = 150 + speedRatio * 110;
        const spikeTrigger       = 120 + speedRatio * 90;
        const wrongLetterTrigger = 90  + speedRatio * 60;

        if (p.grounded && (
            this._hasHoleAhead(holeTrigger) ||
            this._hasSpikeAhead(spikeTrigger) ||
            this._hasWrongLetterAhead(wrongLetterTrigger)
        )) {
            this._tryJump();
            this.autoPilotJumpCooldown = 0.14;
            return;
        }

        // ── Airborne rescue: keep jumping if falling toward a gap or spike ──
        if (!p.grounded && p.airJumps < PHY.AIR_JUMPS) {
            const tooLow = p.y > this.baseGroundY - 90 || p.y > this.screenH * 0.58;
            const spikeBelow = this._hasSpikeAhead(Math.max(30, this.scrollSpeed * 0.12));
            const rescueProbe = p.worldX + Math.max(30, this.scrollSpeed * 0.15);
            const noGroundAhead = this._getGroundAt(rescueProbe) === null;
            const noPlatformAhead = !this._hasPlatformAhead(rescueProbe);

            if (p.vy > 120 && (spikeBelow || (tooLow && noGroundAhead && noPlatformAhead))) {
                this._tryJump();
                this.autoPilotJumpCooldown = 0.16;
            }
        }
    }

    // ── Death ───────────────────────────────────────────────────────────────

    _die() {
        if (this.dead) return;
        this.dead = true;
        this.gameOver = true;
        this.runner.die();

        // Clamp death particles to visible area (player may be off-screen in a hole)
        const deathY = Math.min(this.player.y, this.screenH - 10);
        this.particles.emit(this.player.worldX, deathY, 20, {
            aMin: 0, aMax: 360, sMin: 80, sMax: 250,
            life: 0.7, size: 3.5, color: PAL.DEATH, grav: 400,
        });

        this.shake = { timer: 0.4, intensity: 8 };
        this.flash = { timer: 0.5, color: PAL.FLASH_INVALID };

        try { this.audioRef?.gameOver(); } catch (e) { /* */ }

        gsap.delayedCall(0.5, () => {
            this.goText.visible = true;
            this.goText.alpha = 0;
            this.goScore.text = "Score: " + this.score;
            this.goScore.visible = true;
            this.goScore.alpha = 0;
            gsap.to(this.goText, { alpha: 1, duration: 0.4 });
            gsap.to(this.goScore, { alpha: 1, duration: 0.4, delay: 0.1 });
        });

        gsap.delayedCall(1.5, () => {
            if (this.callbacks.onGameOver) {
                this.callbacks.onGameOver({
                    score: this.score, coins: this.coins,
                    wordsFormed: this.wordsFormed, wordStreak: this.wordStreak,
                    maxWordStreak: this.maxWordStreak, distance: this.distance,
                });
            }
        });
    }

    // ── Word Validation ─────────────────────────────────────────────────────

    validateWord() {
        const letters = this.collectedLetters;
        console.log("[WR validateWord] letters:", letters.join(""), "dictSize:", this.dictionaryRef.size);
        if (letters.length < 3) { this._wordInvalid(); return null; }

        // Find longest valid contiguous substring from ANY starting position
        let bestWord = null;
        let bestStart = 0;
        for (let len = letters.length; len >= 3; len--) {
            for (let start = 0; start <= letters.length - len; start++) {
                const candidate = letters.slice(start, start + len).join("");
                const found = this.dictionaryRef.has(candidate);
                if (len >= letters.length - 1) console.log("[WR]  check:", candidate, "→", found);
                if (found) { bestWord = candidate; bestStart = start; break; }
            }
            if (bestWord) break;
        }
        console.log("[WR] bestWord:", bestWord, "bestStart:", bestStart);
        if (!bestWord) { this._wordInvalid(); return null; }

        const word = bestWord;
        let pts = Math.floor(word.length * 150 * word.length / 3);
        if (word.length >= 4) pts = Math.floor(pts * (1 + 0.15 * Math.pow(word.length - 3, 1.4)));
        let letterBonus = 0;
        for (const ch of word) {
            const val = this.letterValuesRef[ch] || 1;
            if (val > 1) letterBonus += val * 3;
        }
        pts += letterBonus;

        this.wordStreak++;
        if (this.wordStreak > this.maxWordStreak) this.maxWordStreak = this.wordStreak;
        const streakMult = Math.min(3.0, 1.0 + (this.wordStreak - 1) * 0.5);
        pts = Math.floor(pts * streakMult);
        this.wordScore += pts;
        this.score += pts;

        const wordCoins = this.coinsForWordFn(word.length);
        this.coins += wordCoins;
        this.wordsFormed.push({ word, pts });
        this.scrollSpeed = Math.min(this.maxSpeed, this.scrollSpeed + this.wordBoost);

        this.flash = { timer: 0.4, color: PAL.FLASH_VALID };
        this.shake = { timer: 0.2, intensity: 4 };
        this.particles.emit(this.player.worldX, this.player.y, 14, {
            aMin: 0, aMax: 360, sMin: 60, sMax: 180,
            life: 0.5, size: 3, color: PAL.SPARK, grav: -80,
        });

        try { this.audioRef?._beep(880, 0.15, "sine", 0.15); } catch (e) { /* */ }

        // Clear all letters after extracting the word
        this.collectedLetters = [];

        // In target-word mode, advance to the next word automatically whenever
        // the validated word matches the current target.
        if (this.targetWords.length > 0 && word === this._currentTargetWord()) {
            this._advanceTargetWord();
        }

        return { word, pts, coins: wordCoins, streak: this.wordStreak, startIndex: bestStart };
    }

    _wordInvalid() {
        this.wordStreak = 0;
        this.flash = { timer: 0.25, color: PAL.FLASH_INVALID };
        this.shake = { timer: 0.15, intensity: 3 };
        try { this.audioRef?._beep(220, 0.1, "square", 0.15); } catch (e) { /* */ }
        this.collectedLetters = [];
    }

    // ── HUD ─────────────────────────────────────────────────────────────────

    _updateHUD() {
        if (this.highScore > 0) {
            this.hiScoreText.text = "HI " + String(this.highScore).padStart(5, "0");
        }
        if (this.wordStreak >= 2) {
            const mult = Math.min(3.0, 1.0 + (this.wordStreak - 1) * 0.5);
            this.streakText.text = this.wordStreak + "x STREAK (" + mult.toFixed(1) + "x)";
            this.streakText.visible = true;
        } else {
            this.streakText.visible = false;
        }
    }

    _updateShowcaseOverlay(dt) {
        if (!this.overlayTitle && !this.overlaySubtitle) return;
        if (this.overlayTimer > 0) this.overlayTimer = Math.max(0, this.overlayTimer - dt);

        const fadeWindow = Math.min(1.25, Math.max(0.35, this.overlayDuration || 1.25));
        const alpha = this.overlayTimer > fadeWindow ? 1 : clamp(this.overlayTimer / fadeWindow, 0, 1);

        this.overlayTitleText.visible = !!this.overlayTitle && alpha > 0.01;
        this.overlaySubtitleText.visible = !!this.overlaySubtitle && alpha > 0.01;
        this.overlayTitleText.alpha = alpha;
        this.overlaySubtitleText.alpha = alpha;
    }

    // ── Culling ─────────────────────────────────────────────────────────────

    _cullObjects() {
        const cullX = this.cameraX - CFG.CULL_BEHIND;
        const cullCol = Math.floor(cullX / CFG.COL_W);

        for (const [ci, col] of this.columns) {
            if (ci < cullCol) {
                if (col.gfx) col.gfx.destroy();
                if (col.spikeGfx) col.spikeGfx.destroy();
                this.columns.delete(ci);
            }
        }

        for (let i = this.platforms.length - 1; i >= 0; i--) {
            if (this.platforms[i].worldX + this.platforms[i].w < cullX) {
                this.platforms[i].gfx.destroy();
                this.platforms.splice(i, 1);
            }
        }

        for (let i = this.letters.length - 1; i >= 0; i--) {
            const l = this.letters[i];
            if (l.worldX < cullX || (l.collected && !l.container.parent)) {
                if (!l.collected && l.container.parent) l.container.destroy({ children: true });
                this.letters.splice(i, 1);
            }
        }
    }

    // ── Background ──────────────────────────────────────────────────────────

    _drawBackground() {
        // Gradient via canvas
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = this.screenH;
        const ctx = canvas.getContext("2d");
        const grad = ctx.createLinearGradient(0, 0, 0, this.screenH);
        grad.addColorStop(0, "#0a0e1a");
        grad.addColorStop(1, "#141830");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1, this.screenH);
        const bgTex = Texture.from(canvas);
        const bgSprite = new Sprite(bgTex);
        bgSprite.width = this.screenW;
        bgSprite.height = this.screenH;
        this.bgLayer.addChild(bgSprite);

        // Stars
        const starGfx = new Graphics();
        for (let i = 0; i < 80; i++) {
            const sx = this.chance.floating({ min: 0, max: this.screenW });
            const sy = this.chance.floating({ min: 0, max: this.screenH * 0.75 });
            const sr = this.chance.floating({ min: 0.3, max: 1.5 });
            const sa = this.chance.floating({ min: 0.1, max: 0.4 });
            starGfx.circle(sx, sy, sr);
            starGfx.fill({ color: PAL.STAR, alpha: sa });
        }
        this.bgLayer.addChild(starGfx);

        // Distant city silhouette
        const cityGfx = new Graphics();
        const baseCity = this.screenH * 0.65;
        for (let i = 0; i < 25; i++) {
            const bx = this.chance.floating({ min: -20, max: this.screenW + 20 });
            const bw = this.chance.floating({ min: 15, max: 45 });
            const bh = this.chance.floating({ min: 20, max: 60 });
            cityGfx.rect(bx, baseCity - bh, bw, bh + this.screenH * 0.2);
            cityGfx.fill({ color: 0x0a1528, alpha: 0.5 });
        }
        this.bgLayer.addChild(cityGfx);
    }

    // ── Pause / Resume ──────────────────────────────────────────────────────

    pauseGame() {
        this.isPaused = true;
        if (this.runner._runTl) this.runner._runTl.pause();
        if (this.callbacks.onPause) this.callbacks.onPause();
    }

    resumeGame() {
        // Don't immediately resume — start a countdown
        this._startCountdown();
    }

    // ── State Serialization ─────────────────────────────────────────────────

    getState() {
        return {
            version: 3, type: "word-runner",
            player: { worldX: this.player.worldX, y: this.player.y, vy: this.player.vy },
            scrollSpeed: this.scrollSpeed,
            platforms: this.platforms.map(p => ({ worldX: p.worldX, y: p.y, w: p.w, h: p.h })),
            letters: this.letters.filter(l => !l.collected).map(l => ({
                worldX: l.worldX, worldY: l.worldY, letter: l.letter, collected: false,
            })),
            collectedLetters: [...this.collectedLetters],
            score: this.score, coins: this.coins,
            wordsFormed: [...this.wordsFormed],
            distance: this.distance, wordScore: this.wordScore,
            wordStreak: this.wordStreak, maxWordStreak: this.maxWordStreak,
            highScore: this.highScore,
        };
    }

    // ── Resize ──────────────────────────────────────────────────────────────

    onResize(w, h) {
        this.screenW = w;
        this.screenH = h;
        this.baseGroundY = Math.floor(h * CFG.GROUND_Y_PCT);
        this.hiScoreText.position.set(w - 12, 10);
        this.overlayTitleText.position.set(24, 22);
        this.overlaySubtitleText.position.set(26, 58);
        this.streakText.position.set(w / 2, 14);
        this.goText.position.set(w / 2, h * 0.4);
        this.goScore.position.set(w / 2, h * 0.4 + 35);
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────

    destroy() {
        try { window.removeEventListener("keydown", this._keyDown); } catch (_) {}
        try { this.app?.canvas?.removeEventListener("pointerdown", this._pointerDown); } catch (_) {}
        try { this.runner?.destroy(); } catch (_) {}
        try { this.particles?.destroy(); } catch (_) {}

        // Kill all gsap activity on scene objects
        gsap.killTweensOf(this);
        if (this.goText) gsap.killTweensOf(this.goText);
        if (this.goScore) gsap.killTweensOf(this.goScore);
        if (this.streakText) gsap.killTweensOf(this.streakText);

        try {
            for (const [, col] of this.columns) {
                if (col.gfx) col.gfx.destroy();
                if (col.spikeGfx) col.spikeGfx.destroy();
            }
        } catch (_) {}
        try {
            for (const plat of this.platforms) if (plat.gfx) plat.gfx.destroy();
        } catch (_) {}
        try {
            for (const l of this.letters) {
                if (l.container?.parent) l.container.destroy({ children: true });
            }
        } catch (_) {}

        try { this.bgLayer?.destroy({ children: true }); } catch (_) {}
        try { this.worldLayer?.destroy({ children: true }); } catch (_) {}
        try { this.hudLayer?.destroy({ children: true }); } catch (_) {}
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPORT: WordRunnerGame WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════

export class WordRunnerGame {
    constructor(container, options) {
        this.container = container;
        this.options = options;
        this.app = null;
        this.scene = null;
        this._destroyed = false;
    }

    async start(savedState) {
        const cw = this.options.width || this.container.clientWidth || 800;
        const ch = this.options.height || this.container.clientHeight || Math.floor(window.innerHeight * 0.45);
        const resolution = Number.isFinite(this.options.resolution)
            ? this.options.resolution
            : Math.min(window.devicePixelRatio || 1, 2);

        this.app = new Application();
        await this.app.init({
            width: cw,
            height: ch,
            background: PAL.BG,
            antialias: true,
            resolution,
            autoDensity: true,
        });

        if (this._destroyed) { this.app.destroy(true); return; }
        this.container.appendChild(this.app.canvas);

        this._createScene(savedState);

        let _lastTime = performance.now();
        this.app.ticker.add(() => {
            const now = performance.now();
            const dt = Math.min((now - _lastTime) / 1000, 0.05);
            _lastTime = now;
            if (!this._destroyed && this.scene) {
                this.scene.update(dt);
            }
        });
    }

    _createScene(savedState) {
        this.scene = new WRScene(this.app, this.options);
        this.scene.init(savedState);
    }

    async restart(savedState, nextOptions) {
        if (nextOptions) this.options = { ...this.options, ...nextOptions };
        if (!this.app) {
            await this.start(savedState);
            return;
        }
        if (this.scene) {
            gsap.killTweensOf(this.scene);
            try { this.scene.destroy(); } catch (e) { console.warn('[WR] scene restart destroy error:', e); }
        }
        this.scene = null;
        this._createScene(savedState);
    }

    getScene() { return this.scene; }
    getCanvas() { return this.app?.canvas || null; }
    validateWord() { return this.scene ? this.scene.validateWord() : null; }
    getCollectedLetters() { return this.scene ? [...this.scene.collectedLetters] : []; }
    getState() { return this.scene ? this.scene.getState() : null; }

    resize(w, h) {
        if (this.app && this.app.renderer) {
            this.app.renderer.resize(w, h);
            if (this.scene) this.scene.onResize(w, h);
        }
    }

    endGame() {
        if (this.scene && !this.scene.dead) this.scene._die();
    }

    destroy() {
        this._destroyed = true;
        // Kill any pending gsap delayedCalls/tweens from the scene (death animation etc.)
        if (this.scene) {
            gsap.killTweensOf(this.scene);
            try { this.scene.destroy(); } catch (e) { console.warn('[WR] scene destroy error:', e); }
            this.scene = null;
        }
        if (this.app) {
            // Stop the ticker before destroying to prevent texturePool errors
            try { this.app.ticker.stop(); } catch (_) {}
            // Delay app.destroy by one frame so PixiJS can finish its current cycle
            const app = this.app;
            this.app = null;
            requestAnimationFrame(() => {
                try { app.destroy(true); } catch (e) { console.warn('[WR] app destroy error:', e); }
            });
        }
    }
}
