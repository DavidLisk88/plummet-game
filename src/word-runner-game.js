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
        this.chance = new Chance();

        // Options from host
        this.highScore = options.highScore || 0;
        this.randomLetterFn = options.randomLetterFn || (() => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)]);
        this.dictionaryRef = options.dictionaryRef || new Set();
        this.audioRef = options.audioRef;
        this.letterValuesRef = options.letterValuesRef || {};
        this.coinsForWordFn = options.coinsForWordFn || ((len) => len * 2);
        this.callbacks = options.callbacks || {};

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
        this.scrollSpeed = CFG.INITIAL_SPEED;
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
        this.runner.startRun();
        if (this.callbacks.onResumed && savedState) {
            this.callbacks.onResumed(this.collectedLetters);
        }
        // Start 3-second countdown (both fresh and resumed games)
        this._startCountdown();
    }

    _startCountdown() {
        this.countdownTimer = 3.0;
        this._lastCountSec = 0;
        this.countdownText.text = "3";
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
        this.scrollSpeed = saved.scrollSpeed || CFG.INITIAL_SPEED;
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
        this.scrollSpeed = Math.min(CFG.MAX_SPEED, this.scrollSpeed + CFG.SPEED_RAMP * dt);

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

        // ── Spawn & cull ──
        this._spawnTerrain();
        this._spawnPlatforms();
        this._spawnLetters();
        this._cullObjects();

        // ── Letter collection (contact only, no magnet) ──
        for (const l of this.letters) {
            if (l.collected) continue;
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
        if (p.y > this.screenH + 30) { this._die(); return; }

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
        const gapThresh = 0.13 + diff * 0.07;

        // Max gap enforcement (based on jump distance at current speed)
        const airTime = 2 * Math.abs(PHY.JUMP_VY) / PHY.GRAVITY + Math.abs(PHY.AIR_JUMP_VY) / PHY.GRAVITY;
        const maxGapPx = Math.max(80, this.scrollSpeed * airTime * 0.7);
        const maxGapCols = Math.max(1, Math.floor(maxGapPx / CFG.COL_W));

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
        if (diff > 0.08 && this.chance.bool({ likelihood: 4 + diff * 14 })) {
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
            if (this.chance.bool({ likelihood: 30 + diff * 20 })) {
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
            this._nextPlatX += 180 + this.chance.floating({ min: 0, max: 150 });
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
                this._die();
                return;
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
        let pts = word.length * 10 * word.length;
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
        this.scrollSpeed = Math.min(CFG.MAX_SPEED, this.scrollSpeed + CFG.WORD_BOOST);

        this.flash = { timer: 0.4, color: PAL.FLASH_VALID };
        this.shake = { timer: 0.2, intensity: 4 };
        this.particles.emit(this.player.worldX, this.player.y, 14, {
            aMin: 0, aMax: 360, sMin: 60, sMax: 180,
            life: 0.5, size: 3, color: PAL.SPARK, grav: -80,
        });

        try { this.audioRef?._beep(880, 0.15, "sine", 0.15); } catch (e) { /* */ }

        // Clear all letters after extracting the word
        this.collectedLetters = [];

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
        const cw = this.container.clientWidth || 800;
        const ch = this.container.clientHeight || Math.floor(window.innerHeight * 0.45);

        this.app = new Application();
        await this.app.init({
            width: cw,
            height: ch,
            background: PAL.BG,
            antialias: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoDensity: true,
        });

        if (this._destroyed) { this.app.destroy(true); return; }
        this.container.appendChild(this.app.canvas);

        this.scene = new WRScene(this.app, this.options);
        this.scene.init(savedState);

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

    getScene() { return this.scene; }
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
