/**
 * Word Runner — Phaser 3 Implementation (v5 — Game Feel Overhaul)
 * =================================================================
 * A polished side-scrolling letter-platformer powered by Phaser Arcade Physics.
 *
 * Architecture (matches Chrome Dino / classic auto-runner pattern):
 *   - Player pinned at fixed screen X (20%), only Y-axis physics
 *   - World scrolls LEFT past the player each frame
 *   - No camera follow — all positions are screen-space
 *   - Phaser Arcade Physics handles gravity, collisions, overlap
 *   - Coyote time, jump buffering, variable jump height for game feel
 *
 * Classes:
 *   - WordRunnerGame: creates/destroys the Phaser.Game instance
 *   - WRGameScene:    main gameplay scene (physics, spawning, input)
 */

import Phaser from "phaser";
import { applyJuice } from "./lib/juice-effects.js";

console.log("%c[WordRunner v6] asymmetric gravity, apex hang, speed trails, terrain variety", "color: #22cc44; font-weight: bold; font-size: 14px;");

// -- Constants ---------------------------------------------------------------

const PLAYER_W = 14;
const PLAYER_H = 36;
const HEAD_R = 5;
const TORSO_LEN = 13;
const UPPER_LIMB = 8;
const LOWER_LIMB = 7;
const LETTER_R = 14;

// Physics tuning (values calibrated to Chrome Dino feel: gravity ~2160px/s², jump ~-640px/s)
const GRAVITY = 1800;
const JUMP_VY = -680;
const AIR_JUMP_VY = -578;     // ~0.85x ground jump
const MAX_FALL_SPEED = 1200;
const INITIAL_SPEED = 160;
const MAX_SPEED = 520;
const GROUND_Y_PCT = 0.82;

// Asymmetric gravity (Mario / Celeste pattern: snappy fall, floaty rise)
const FALL_GRAVITY_MULT = 1.6;       // gravity multiplier when falling (vy > 0)
const APEX_VY_THRESHOLD = 80;        // |vy| below this = "apex" zone
const APEX_GRAVITY_MULT = 0.45;      // gravity multiplier at jump apex (hang time)

// Platformer feel
const COYOTE_TIME = 0.08;
const JUMP_BUFFER_TIME = 0.1;
const JUMP_CUT_MULT = 0.5;   // unused, kept for reference
const AIR_JUMPS_MAX = 1;

// Chrome Dino monochrome palette
const COLOR_FG = 0x535353;
const COLOR_FG_LIGHT = 0x757575;
const COLOR_BG = 0xf7f7f7;
const COLOR_LETTER = 0x1a1a2e;
const COLOR_LETTER_GLOW = 0x4a90d9;
const COLOR_OBSTACLE = 0x535353;
const COLOR_GROUND_LINE = 0x535353;

// -- Helper: Procedural Textures ---------------------------------------------

function createLetterTextures(scene) {
    const d = LETTER_R * 2 + 4;
    const cx = d / 2;
    for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i);
        const key = "letter_" + letter;
        const canvas = document.createElement("canvas");
        canvas.width = d;
        canvas.height = d;
        const ctx = canvas.getContext("2d");
        const gradient = ctx.createRadialGradient(cx, cx, 0, cx, cx, LETTER_R);
        gradient.addColorStop(0, "rgba(74, 144, 217, 0.10)");
        gradient.addColorStop(1, "rgba(74, 144, 217, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cx, LETTER_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 20px "SF Mono", "Fira Code", Consolas, monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(74, 144, 217, 0.3)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = "#1a1a2e";
        ctx.fillText(letter, cx, cx + 1);
        scene.textures.addCanvas(key, canvas);
    }
}

function createParticleTexture(scene, key, color) {
    const g = scene.add.graphics();
    g.fillStyle(color, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture(key, 8, 8);
    g.destroy();
}

function createSpeedLineTexture(scene) {
    const g = scene.add.graphics();
    g.fillStyle(COLOR_FG, 0.35);
    g.fillRect(0, 1, 18, 2);  // horizontal dash
    g.generateTexture("speed_line", 18, 4);
    g.destroy();
}

// -- Animation State Machine -------------------------------------------------

const ANIM_STATE = { RUN: 0, JUMP_UP: 1, FALL: 2, LAND: 3, DEAD: 4 };

class StickAnimator {
    constructor() {
        this.state = ANIM_STATE.RUN;
        this.phase = 0;
        this.blend = 0;
        this.landSquash = 0;
        this.jumpStretch = 0;
    }

    tick(dt, onGround, vy, speed) {
        const phaseSpeed = onGround ? speed * 0.04 : speed * 0.012;
        this.phase += dt * phaseSpeed;

        // Match v1 blend speed: 0.18 per frame at 120fps = snappy transitions
        const target = onGround ? 0 : 1;
        this.blend += (target - this.blend) * 0.18;
        this.blend = Math.max(0, Math.min(1, this.blend));

        if (this.state === ANIM_STATE.DEAD) return;

        if (onGround) {
            if (this.state === ANIM_STATE.FALL || this.state === ANIM_STATE.JUMP_UP) {
                this.state = ANIM_STATE.LAND;
                this.landSquash = 0.6;
            } else if (this.state === ANIM_STATE.LAND) {
                this.landSquash -= dt * 6;
                if (this.landSquash <= 0) { this.landSquash = 0; this.state = ANIM_STATE.RUN; }
            } else {
                this.state = ANIM_STATE.RUN;
            }
        } else {
            this.state = vy < -20 ? ANIM_STATE.JUMP_UP : ANIM_STATE.FALL;
        }

        this.jumpStretch *= Math.max(0, 1 - dt * 8);
    }

    onJump() { this.jumpStretch = 0.5; }
    die() { this.state = ANIM_STATE.DEAD; }

    draw(g, px, py) {
        g.clear();
        const legLen = UPPER_LIMB + LOWER_LIMB;
        const bodyBase = py - legLen + 1;
        const hipY = bodyBase - 1;
        const shoulderY = hipY - TORSO_LEN;
        const headCY = shoulderY - HEAD_R - 1;

        let scaleX = 1, scaleY = 1;
        if (this.landSquash > 0) {
            scaleX = 1 + this.landSquash * 0.3;
            scaleY = 1 - this.landSquash * 0.2;
        } else if (this.jumpStretch > 0) {
            scaleX = 1 - this.jumpStretch * 0.15;
            scaleY = 1 + this.jumpStretch * 0.25;
        }

        const shadowAlpha = 0.08 * (1 - this.blend);
        if (shadowAlpha > 0.005) {
            g.fillStyle(COLOR_FG, shadowAlpha);
            g.fillEllipse(px, py + 2, 14 * scaleX, 4);
        }

        g.lineStyle(2, COLOR_FG, 1);
        const stretchOffY = (scaleY - 1) * TORSO_LEN * 0.5;
        const adjHeadCY = headCY - stretchOffY;
        const adjShoulderY = shoulderY - stretchOffY * 0.5;

        if (this.state === ANIM_STATE.DEAD) {
            this._drawDead(g, px, adjHeadCY, adjShoulderY, hipY, bodyBase);
            return;
        }

        g.strokeCircle(px, adjHeadCY, HEAD_R);
        g.fillStyle(COLOR_FG, 1);
        g.fillCircle(px + 2, adjHeadCY - 1, 1);

        g.beginPath();
        g.moveTo(px, adjShoulderY);
        g.lineTo(px, hipY);
        g.strokePath();

        this._drawLimbs(g, px, adjShoulderY, hipY, scaleX);
    }

    _drawLimbs(g, px, shoulderY, hipY, scaleX) {
        const b = this.blend;
        const mix = (a, c) => a + (c - a) * b;
        const phase = this.phase;

        const armSwing = Math.sin(phase) * 0.8;
        const legSwing = Math.sin(phase) * 0.75;
        const airArm = -0.6;
        const airLegTuck = 0.3;

        const laAngle = mix(armSwing, airArm);
        const raAngle = mix(-armSwing, -airArm);

        const drawArm = (angle, side) => {
            const elbowX = px + Math.sin(angle) * UPPER_LIMB * scaleX;
            const elbowY = shoulderY + 2 + Math.cos(angle) * UPPER_LIMB;
            const handAngle = mix(angle * 0.5 + 0.3, angle - side * 0.4);
            const handLen = mix(LOWER_LIMB, LOWER_LIMB * 0.7);
            g.lineBetween(px, shoulderY + 2, elbowX, elbowY);
            g.lineBetween(elbowX, elbowY,
                elbowX + Math.sin(handAngle) * handLen * scaleX,
                elbowY + Math.cos(handAngle) * handLen);
        };
        drawArm(laAngle, 1);
        drawArm(raAngle, -1);

        const drawLeg = (runAngle, airOffX, airTuck) => {
            const runKneeX = px + Math.sin(runAngle) * UPPER_LIMB * scaleX;
            const runKneeY = hipY + Math.cos(runAngle) * UPPER_LIMB;
            const airKneeX = px + airOffX;
            const airKneeY = hipY + UPPER_LIMB * (0.5 - airTuck * 0.2);
            const kneeX = mix(runKneeX, airKneeX);
            const kneeY = mix(runKneeY, airKneeY);
            g.lineBetween(px, hipY, kneeX, kneeY);
            const footRunA = runAngle * 0.4;
            const runFootX = runKneeX + Math.sin(footRunA) * LOWER_LIMB * scaleX;
            const runFootY = runKneeY + Math.abs(Math.cos(footRunA)) * LOWER_LIMB;
            const airFootX = px + airOffX * 0.3;
            const airFootY = hipY + 3;
            g.lineBetween(kneeX, kneeY, mix(runFootX, airFootX), mix(runFootY, airFootY));
        };
        drawLeg(-legSwing, -4, airLegTuck);
        drawLeg(legSwing, 4, airLegTuck);
    }

    _drawDead(g, px, headCY, shoulderY, hipY, bodyBase) {
        g.lineStyle(1.5, 0xCC3333, 1);
        g.lineBetween(px - 3, headCY - 2, px - 1, headCY);
        g.lineBetween(px - 3, headCY, px - 1, headCY - 2);
        g.lineBetween(px + 1, headCY - 2, px + 3, headCY);
        g.lineBetween(px + 1, headCY, px + 3, headCY - 2);
        g.lineStyle(2, COLOR_FG, 1);
        g.strokeCircle(px, headCY, HEAD_R);
        g.beginPath(); g.moveTo(px, shoulderY); g.lineTo(px, hipY); g.strokePath();
        g.lineBetween(px, shoulderY + 2, px - 6, hipY + 5);
        g.lineBetween(px, shoulderY + 2, px + 6, hipY + 5);
        g.lineBetween(px, hipY, px - 5, bodyBase + 8);
        g.lineBetween(px, hipY, px + 5, bodyBase + 8);
    }
}

// -- Main Game Scene ---------------------------------------------------------

class WRGameScene extends Phaser.Scene {
    constructor() { super({ key: "WRGameScene" }); }

    init(data) {
        this.callbacks = data.callbacks || {};
        this.savedState = data.savedState || null;
        this.initialHighScore = data.highScore || 0;
        this.randomLetterFn = data.randomLetterFn || (() => "A");
        this.dictionaryRef = data.dictionaryRef || new Set();
        this.audioRef = data.audioRef || null;
        this.letterValuesRef = data.letterValuesRef || {};
        this.coinsForWordFn = data.coinsForWordFn || (() => 1);
    }

    create() {
        const w = this.scale.width;
        const h = this.scale.height;
        this.worldW = w;
        this.worldH = h;
        this.groundY = Math.floor(h * GROUND_Y_PCT);
        this.playerScreenX = Math.floor(w * 0.2);

        // Procedural textures
        createLetterTextures(this);
        createParticleTexture(this, "dust_particle", COLOR_FG_LIGHT);
        createParticleTexture(this, "spark_particle", COLOR_LETTER_GLOW);
        createParticleTexture(this, "death_particle", 0xCC3333);
        createSpeedLineTexture(this);

        const hbGfx = this.add.graphics();
        hbGfx.fillStyle(0x000000, 1);
        hbGfx.fillRect(0, 0, PLAYER_W, PLAYER_H);
        hbGfx.generateTexture("_player_hitbox", PLAYER_W, PLAYER_H);
        hbGfx.destroy();

        // Background layers (all screen-space — no scrollFactor, manual parallax)
        this.bgLayer = this.add.graphics().setDepth(-10);
        this._drawBackground();
        this.mountainLayer = this.add.graphics().setDepth(-8);
        this._drawMountains();
        this.hillLayer = this.add.graphics().setDepth(-6);
        this._drawHills();
        this._parallaxOffset = 0;

        // Physics groups
        this.physics.world.setBounds(-500, 0, 999999, h + 200);
        this.physics.world.setBoundsCollision(false, false, false, false);

        this.groundGroup = this.physics.add.staticGroup();
        this.platformGroup = this.physics.add.staticGroup();
        this.rockGroup = this.physics.add.staticGroup();
        this.letterGroup = this.physics.add.group({ allowGravity: false });

        // Particles
        this.dustEmitter = this.add.particles(0, 0, "dust_particle", {
            speed: { min: 20, max: 60 }, angle: { min: 200, max: 340 },
            scale: { start: 0.8, end: 0 }, lifespan: 400, alpha: { start: 0.6, end: 0 }, emitting: false,
        });
        this.sparkEmitter = this.add.particles(0, 0, "spark_particle", {
            speed: { min: 50, max: 150 }, angle: { min: 0, max: 360 },
            scale: { start: 1, end: 0 }, lifespan: 500, alpha: { start: 1, end: 0 }, emitting: false,
        });
        this.deathEmitter = this.add.particles(0, 0, "death_particle", {
            speed: { min: 80, max: 200 }, angle: { min: 200, max: 340 },
            scale: { start: 1.2, end: 0 }, lifespan: 800, alpha: { start: 1, end: 0 }, gravityY: 400, emitting: false,
        });
        // Speed-line trails — horizontal dashes that stream behind player at high speed
        this.speedLineEmitter = this.add.particles(0, 0, "speed_line", {
            speedX: { min: -80, max: -40 }, speedY: { min: -8, max: 8 },
            angle: 180, scale: { start: 1, end: 0.3 }, lifespan: 300,
            alpha: { start: 0.5, end: 0 }, emitting: false,
        });

        // Player
        this.playerGfx = this.add.graphics();
        this.playerBody = this.physics.add.sprite(this.playerScreenX, this.groundY - PLAYER_H, "_player_hitbox")
            .setVisible(false).setSize(PLAYER_W, PLAYER_H);
        this.playerBody.body.setCollideWorldBounds(false);
        this.playerBody.body.setGravityY(GRAVITY);
        this.playerBody.body.setMaxVelocityY(MAX_FALL_SPEED);

        // Animator
        this.animator = new StickAnimator();

        // Player state
        this.playerState = { worldX: 100, dead: false, airJumps: 0 };
        this._coyoteTimer = 0;
        this._jumpBufferTimer = 0;
        this._wasGrounded = false;

        // Game state
        this.scrollSpeed = INITIAL_SPEED;
        this.distance = 0;
        this.score = 0;
        this.wordScore = 0;
        this.coins = 0;
        this.wordsFormed = [];
        this.wordStreak = 0;
        this.maxWordStreak = 0;
        this.highScore = this.initialHighScore;
        this.collectedLetters = [];
        this.wordLength = 8;
        this.gameOver = false;
        this.isPaused = false;
        this.nextSpawnX = 0;
        this.letterSprites = [];

        // Visual effects
        this.flashTimer = 0;
        this.flashType = null;
        this.screenShake = { intensity: 0, duration: 0 };

        // Previous Y for landing detection
        this._prevVelY_render = 0;

        // Collision handlers
        this.physics.add.collider(this.playerBody, this.groundGroup, this._onLand, null, this);
        this.physics.add.collider(this.playerBody, this.platformGroup, this._onLandPlatform, null, this);
        this.physics.add.overlap(this.playerBody, this.rockGroup, this._onHitRock, null, this);
        this.physics.add.overlap(this.playerBody, this.letterGroup, this._onCollectLetter, null, this);

        // NO camera follow — player stays at fixed screenX, world scrolls left

        // Input
        this.input.on("pointerdown", this._onTap, this);
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.upKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
        this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

        // Initialize world
        if (this.savedState) {
            this._restoreFromSave(this.savedState);
        } else {
            this._initFreshWorld();
        }

        // HUD
        this.hudGfx = this.add.graphics().setDepth(90);
        this.hiScoreText = this.add.text(w - 12, 10, "", {
            fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
            fontSize: "11px", fontStyle: "bold", color: "rgba(83,83,83,0.5)",
        }).setOrigin(1, 0).setDepth(100);
        this.streakText = this.add.text(w / 2, 14, "", {
            fontFamily: "Inter, sans-serif",
            fontSize: "14px", fontStyle: "bold", color: "rgba(83,83,83,0.8)",
        }).setOrigin(0.5, 0).setDepth(100);
        this.gameOverText = this.add.text(w / 2, h * 0.4, "GAME OVER", {
            fontFamily: "Inter, sans-serif",
            fontSize: "28px", fontStyle: "bold", color: "rgba(204,51,51,0.9)",
        }).setOrigin(0.5).setDepth(100).setVisible(false);
        this.gameOverScore = this.add.text(w / 2, h * 0.4 + 35, "", {
            fontFamily: "Inter, sans-serif",
            fontSize: "14px", color: "rgba(83,83,83,0.8)",
        }).setOrigin(0.5).setDepth(100).setVisible(false);

        // Depth sorting
        this.dustEmitter.setDepth(5);
        this.speedLineEmitter.setDepth(4);
        this.sparkEmitter.setDepth(50);
        this.deathEmitter.setDepth(50);
        this.playerGfx.setDepth(40);
    }

    // -- World init -----------------------------------------------------------

    _initFreshWorld() {
        this.playerState.worldX = this.playerScreenX;
        this.playerBody.setPosition(this.playerScreenX, this.groundY - PLAYER_H);
        this.playerBody.body.setVelocity(0, 0);
        // Spawn ground starting before the player, extending past screen
        this._addGround(this.playerScreenX - 100, this.worldW + 400);
        this.nextSpawnX = this.worldW + 300;
        this._spawnContent();
    }

    _restoreFromSave(saved) {
        this.playerState.worldX = saved.player?.worldX || this.playerScreenX;
        this.scrollSpeed = saved.scrollSpeed || INITIAL_SPEED;
        this.score = saved.score || 0;
        this.coins = saved.coins || 0;
        this.wordsFormed = saved.wordsFormed || [];
        this.distance = saved.distance || 0;
        this.wordScore = saved.wordScore || 0;
        this.wordStreak = saved.wordStreak || 0;
        this.collectedLetters = saved.collectedLetters || [];
        this.nextSpawnX = saved.nextSpawnX || this.worldW;

        // Player pinned at screenX, only Y from save
        this.playerBody.setPosition(this.playerScreenX, saved.player?.y || this.groundY - PLAYER_H);
        this.playerBody.body.setVelocity(0, saved.player?.vy || 0);

        for (const seg of (saved.groundSegments || [])) {
            this._addGround(seg.startX, seg.endX - seg.startX);
        }
        for (const plat of (saved.platforms || [])) {
            this._addPlatformSprite(plat.x, plat.y, plat.w, plat.h);
        }
        for (const rock of (saved.rocks || [])) {
            this._addRockSprite(rock.x, rock.y, rock.w, rock.h);
        }
        for (const letter of (saved.letters || [])) {
            if (!letter.collected) this._addLetterSprite(letter.x, letter.y, letter.letter, letter.bobPhase);
        }
        this._spawnContent();
        if (this.callbacks.onResumed) this.callbacks.onResumed(this.collectedLetters);
    }

    // -- Object creation (world-space) ----------------------------------------

    _addGround(worldX, width) {
        const h = this.worldH - this.groundY + 10;
        const go = this.add.zone(worldX + width / 2, this.groundY + h / 2, width, h);
        this.physics.add.existing(go, true);
        go.body.setSize(width, h, false);
        go.body.position.set(worldX, this.groundY);
        go.body.updateCenter();
        this.groundGroup.add(go);

        const gfx = this.add.graphics();
        gfx.fillStyle(COLOR_FG, 0.04);
        gfx.fillRect(0, 3, width, h - 3);
        gfx.lineStyle(2, COLOR_GROUND_LINE, 1);
        gfx.lineBetween(0, 0, width, 0);
        gfx.fillStyle(COLOR_FG, 0.12);
        for (let x = 8; x < width; x += 20 + Math.random() * 35) {
            gfx.fillCircle(x, 5 + Math.random() * 4, 0.5 + Math.random() * 1);
        }
        gfx.setPosition(worldX, this.groundY);
        gfx.setDepth(2);
        go._visual = gfx;
    }

    _addPlatformSprite(worldX, worldY, w, h) {
        const go = this.add.zone(worldX + w / 2, worldY + h / 2, w, h);
        this.physics.add.existing(go, true);
        go.body.setSize(w, h, false);
        go.body.position.set(worldX, worldY);
        go.body.updateCenter();
        go.body.checkCollision.down = false;
        go.body.checkCollision.left = false;
        go.body.checkCollision.right = false;
        this.platformGroup.add(go);

        const gfx = this.add.graphics();
        gfx.fillStyle(COLOR_FG, 0.08);
        gfx.fillRect(0, 2, w, h + 4);
        gfx.lineStyle(2, COLOR_GROUND_LINE, 0.8);
        gfx.lineBetween(0, 0, w, 0);
        gfx.lineStyle(1, COLOR_FG, 0.2);
        gfx.lineBetween(0, 0, 0, h + 2);
        gfx.lineBetween(w - 1, 0, w - 1, h + 2);
        gfx.setPosition(worldX, worldY - 2);
        gfx.setDepth(2);
        go._visual = gfx;
    }

    _addRockSprite(worldX, worldY, w, h) {
        const go = this.add.zone(worldX + w / 2, worldY + h / 2, w, h);
        this.physics.add.existing(go, true);
        go.body.setSize(w - 4, h - 2, false);
        go.body.position.set(worldX + 2, worldY + 1);
        go.body.updateCenter();
        this.rockGroup.add(go);

        const gfx = this.add.graphics();
        const cx = w / 2;
        gfx.fillStyle(COLOR_OBSTACLE, 1);
        gfx.fillRect(cx - 3, 0, 6, h);
        if (w > 14) {
            gfx.fillRect(cx - w * 0.35, h * 0.25, 4, h * 0.35);
            gfx.fillRect(cx - w * 0.35, h * 0.25, w * 0.2, 4);
        }
        if (w > 16) {
            gfx.fillRect(cx + w * 0.15, h * 0.35, 4, h * 0.3);
            gfx.fillRect(cx + w * 0.15, h * 0.35, w * 0.25, 4);
        }
        gfx.lineStyle(1, COLOR_FG, 0.3);
        gfx.strokeRect(cx - 3, 0, 6, h);
        gfx.setPosition(worldX, worldY);
        gfx.setDepth(3);
        go._visual = gfx;
    }

    _addLetterSprite(worldX, worldY, letter, bobPhase) {
        const textureKey = "letter_" + letter;
        const hasTexture = this.textures.exists(textureKey);
        const sprite = this.letterGroup.create(worldX, worldY, hasTexture ? textureKey : "dust_particle")
            .setCircle(LETTER_R + 2).setOffset(-2, -2);
        sprite.body.setAllowGravity(false);
        sprite.setDepth(10);

        let txt = null;
        if (!hasTexture) {
            txt = this.add.text(worldX, worldY, letter, {
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: "22px", fontStyle: "bold", color: "#ffffff",
                stroke: "#3d2200", strokeThickness: 3.5,
            }).setOrigin(0.5).setDepth(11);
        }

        sprite._letterText = txt;
        sprite._letter = letter;
        sprite._bobPhase = bobPhase || Math.random() * Math.PI * 2;
        sprite._baseY = worldY;
        sprite._collected = false;
        this.letterSprites.push(sprite);
        return sprite;
    }

    // -- Collision callbacks ---------------------------------------------------

    _onLand(player, ground) {
        if (this.playerState.dead) return;
        this.playerState.airJumps = 0;
        this._coyoteTimer = COYOTE_TIME;
        if (!this._wasGrounded) {
            this.dustEmitter.emitParticleAt(this.playerScreenX, this.groundY, 3);
            this.animator.landSquash = Math.min(0.6, Math.abs(this._prevVelY_render) / 800);
            applyJuice(this, this.playerGfx, "land");
        }
        this._wasGrounded = true;
    }

    _onLandPlatform(player, platform) {
        if (this.playerState.dead) return;
        if (this.playerBody.body.velocity.y < 0) return false;
        this.playerState.airJumps = 0;
        this._coyoteTimer = COYOTE_TIME;
        this._wasGrounded = true;
    }

    _onHitRock(player, rock) {
        if (this.playerState.dead) return;
        applyJuice(this, null, "hit");
        this._die();
    }

    _onCollectLetter(player, letterSprite) {
        if (this.playerState.dead || letterSprite._collected) return;
        if (this.collectedLetters.length >= this.wordLength) return;

        letterSprite._collected = true;
        letterSprite.body.enable = false;

        this.tweens.add({
            targets: letterSprite, scaleX: 1.5, scaleY: 1.5, alpha: 0,
            duration: 250, ease: "Quad.easeOut", onComplete: () => letterSprite.destroy(),
        });

        const txt = letterSprite._letterText;
        if (txt) {
            this.tweens.add({
                targets: txt, y: 20, x: this.worldW / 2, scaleX: 2, scaleY: 2, alpha: 0,
                duration: 350, ease: "Quad.easeIn", onComplete: () => txt.destroy(),
            });
        }

        this.sparkEmitter.emitParticleAt(letterSprite.x, letterSprite.y, 8);
        this.collectedLetters.push(letterSprite._letter);
        if (this.audioRef) { try { this.audioRef._beep(660 + this.collectedLetters.length * 80, 0.12, "sine", 0.12); } catch (e) { /* */ } }
        if (this.callbacks.onLetterCollected) this.callbacks.onLetterCollected(this.collectedLetters);
    }

    // -- Input ----------------------------------------------------------------

    _onTap() {
        if (this.gameOver || this.isPaused) return;
        this._tryJump();
    }

    _tryJump() {
        if (this.playerState.dead) return;
        const onGround = this._isGrounded();
        const canCoyoteJump = !onGround && this._coyoteTimer > 0 && this.playerState.airJumps === 0;

        if (onGround || canCoyoteJump) {
            this.playerBody.body.setVelocityY(JUMP_VY);
            this.playerState.airJumps = 0;
            this._coyoteTimer = 0;
            this._jumpBufferTimer = 0;
            this.animator.onJump();
            this.dustEmitter.emitParticleAt(this.playerScreenX, this.playerBody.y + PLAYER_H / 2, 4);
            applyJuice(this, this.playerGfx, "jump");
            if (this.audioRef) { try { this.audioRef._beep(440, 0.08, "sine", 0.08); } catch (e) { /* */ } }
        } else if (this.playerState.airJumps < AIR_JUMPS_MAX) {
            this.playerBody.body.setVelocityY(AIR_JUMP_VY);
            this.playerState.airJumps++;
            this._jumpBufferTimer = 0;
            this.animator.onJump();
            applyJuice(this, this.playerGfx, "jump");
            if (this.audioRef) { try { this.audioRef._beep(470, 0.08, "sine", 0.08); } catch (e) { /* */ } }
        }
    }

    _isGrounded() {
        return this.playerBody.body.blocked.down || this.playerBody.body.touching.down;
    }

    // -- Core update loop (Chrome Dino pattern: player fixed, world scrolls) --

    update(time, delta) {
        if (this.gameOver || this.isPaused || this.playerState.dead) return;
        const dt = Math.min(delta / 1000, 0.05);

        // Input polling (v1 pattern: simple JustDown → jump, no hold tracking)
        if (Phaser.Input.Keyboard.JustDown(this.escKey)) { this.pauseGame(); return; }
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey) || Phaser.Input.Keyboard.JustDown(this.upKey)) {
            this._tryJump();
        }

        // Track previous velocity for landing squash
        this._prevVelY_render = this.playerBody.body.velocity.y;

        // Timers
        this._jumpBufferTimer = Math.max(0, this._jumpBufferTimer - dt);
        const grounded = this._isGrounded();
        if (grounded) {
            this._coyoteTimer = COYOTE_TIME;
            this._wasGrounded = true;
        } else {
            this._coyoteTimer = Math.max(0, this._coyoteTimer - dt);
            this._wasGrounded = false;
        }

        // Jump buffer: land within buffer window = auto-jump
        if (grounded && this._jumpBufferTimer > 0) this._tryJump();

        // Asymmetric gravity: snappy fall, floaty apex
        const vy = this.playerBody.body.velocity.y;
        if (!grounded) {
            if (Math.abs(vy) < APEX_VY_THRESHOLD) {
                // Apex hang time — reduced gravity near peak of jump
                this.playerBody.body.setGravityY(GRAVITY * APEX_GRAVITY_MULT);
            } else if (vy > 0) {
                // Falling — heavier gravity for snappy descent
                this.playerBody.body.setGravityY(GRAVITY * FALL_GRAVITY_MULT);
            } else {
                // Rising — normal gravity
                this.playerBody.body.setGravityY(GRAVITY);
            }
        } else {
            this.playerBody.body.setGravityY(GRAVITY);
        }

        // Speed ramp (Chrome Dino: acceleration 0.001 per frame at 60fps)
        this.scrollSpeed = Math.min(MAX_SPEED, this.scrollSpeed + 0.15 * dt);
        const dx = this.scrollSpeed * dt;

        // Pin player at fixed screen X (only Y-axis has physics)
        this.playerBody.setX(this.playerScreenX);
        this.playerState.worldX += dx;
        this.distance += dx;

        // ── Scroll all world objects LEFT ──
        this._scrollWorld(dx);

        // Animation
        this.animator.tick(dt, grounded, this.playerBody.body.velocity.y, this.scrollSpeed);

        // Spawn new content & cull off-screen
        this._spawnContent();
        this._cullObjects();

        // Fall death
        if (this.playerBody.y > this.worldH + 80) { this._die(); return; }

        // Score
        this.score = this.wordScore + Math.floor(this.distance / 15);
        if (this.score > this.highScore) this.highScore = this.score;

        // ── Render ──

        // Draw player directly at physics position (no smoothing — physics at 120fps is already smooth)
        const screenX = this.playerScreenX;
        const screenY = this.playerBody.y + PLAYER_H / 2 - 2;
        this.animator.draw(this.playerGfx, screenX, screenY);

        // Running dust at player's feet
        if (grounded && Math.random() < 0.15) {
            this.dustEmitter.emitParticleAt(
                this.playerScreenX - 5 + Math.random() * 3,
                this.playerBody.y + PLAYER_H / 2, 1);
        }

        // Speed-line trails — emit behind player when moving fast
        const speedPct = this.scrollSpeed / MAX_SPEED;
        if (speedPct > 0.4 && Math.random() < speedPct * 0.4) {
            this.speedLineEmitter.emitParticleAt(
                this.playerScreenX - 10 - Math.random() * 8,
                this.playerBody.y - PLAYER_H * 0.3 + Math.random() * PLAYER_H * 0.6, 1);
        }

        // Parallax: shift mountain/hill layers slowly
        this._parallaxOffset += dx;
        this.mountainLayer.setX(-this._parallaxOffset * 0.02);
        this.hillLayer.setX(-this._parallaxOffset * 0.05);

        // Letter bobbing
        const now = time / 1000;
        for (const ls of this.letterSprites) {
            if (ls._collected || !ls.active) continue;
            const bob = Math.sin(now * 2.5 + ls._bobPhase) * 3;
            ls.y = ls._baseY + bob;
            if (ls._letterText && ls._letterText.active) ls._letterText.y = ls._baseY + bob;
        }

        // Screen flash
        if (this.flashTimer > 0) { this.flashTimer -= dt; this._drawFlash(); }

        // Screen shake
        if (this.screenShake.duration > 0) {
            this.screenShake.duration -= dt;
            const sx = (Math.random() - 0.5) * this.screenShake.intensity;
            const sy = (Math.random() - 0.5) * this.screenShake.intensity;
            this.cameras.main.setScroll(sx, sy);
        } else {
            this.cameras.main.setScroll(0, 0);
        }

        this._updateHUD();

        if (this.callbacks.onStateUpdate) {
            this.callbacks.onStateUpdate({
                score: this.score, distance: this.distance,
                coins: this.coins, highScore: this.highScore,
            });
        }
    }

    // -- World scrolling (move everything LEFT by dx) -------------------------

    _scrollWorld(dx) {
        const tree = this.physics.world.staticTree;
        const moveStatic = (child) => {
            if (!child) return;
            child.x -= dx;
            const b = child.body;
            tree.remove(b);
            b.position.x -= dx;
            b.updateCenter();
            tree.insert(b);
            if (child._visual) child._visual.x -= dx;
        };
        this.groundGroup.children.iterate(moveStatic);
        this.platformGroup.children.iterate(moveStatic);
        this.rockGroup.children.iterate(moveStatic);

        // Letters are dynamic bodies — move directly
        for (const ls of this.letterSprites) {
            if (!ls.active) continue;
            ls.x -= dx;
            if (ls.body) ls.body.x -= dx;
            if (ls._letterText && ls._letterText.active) ls._letterText.x -= dx;
        }
    }

    // -- Culling and Background -----------------------------------------------

    _cullObjects() {
        const cullX = -250;  // Screen-space: anything past left edge
        const _cullGroup = (group) => {
            group.children.iterate(child => {
                if (!child) return;
                if (child.body.position.x + child.body.width < cullX) {
                    if (child._visual) child._visual.destroy();
                    child.destroy();
                }
            });
        };
        _cullGroup(this.groundGroup);
        _cullGroup(this.platformGroup);
        _cullGroup(this.rockGroup);

        for (let i = this.letterSprites.length - 1; i >= 0; i--) {
            const ls = this.letterSprites[i];
            if (!ls.active || ls.x < cullX) {
                if (ls._letterText && ls._letterText.active) ls._letterText.destroy();
                if (ls.active) ls.destroy();
                this.letterSprites.splice(i, 1);
            }
        }
    }

    _drawBackground() {
        this.bgLayer.clear();
        this.bgLayer.fillStyle(COLOR_BG, 1);
        this.bgLayer.fillRect(0, 0, this.worldW, this.worldH);
    }

    _drawMountains() {
        const w = this.worldW * 3;
        this.mountainLayer.clear();
        this.mountainLayer.fillStyle(COLOR_FG, 0.04);
        for (let i = 0; i < 9; i++) {
            const cx = (w / 9) * (i + 0.5);
            const baseW = 100 + Math.random() * 80;
            const peakH = 30 + Math.random() * 20;
            this.mountainLayer.beginPath();
            this.mountainLayer.moveTo(cx - baseW, this.groundY);
            this.mountainLayer.lineTo(cx, this.groundY - peakH);
            this.mountainLayer.lineTo(cx + baseW, this.groundY);
            this.mountainLayer.closePath();
            this.mountainLayer.fillPath();
        }
    }

    _drawHills() {
        const w = this.worldW * 3;
        this.hillLayer.clear();
        this.hillLayer.fillStyle(COLOR_FG, 0.03);
        for (let i = 0; i < 15; i++) {
            const cx = (w / 15) * (i + 0.5);
            const radius = 35 + Math.random() * 20;
            this.hillLayer.fillCircle(cx, this.groundY + 3, radius);
        }
    }

    // -- Visual effects -------------------------------------------------------

    _drawFlash() {
        this.hudGfx.clear();
        if (this.flashTimer <= 0) return;
        const alphaVal = Math.min(0.3, this.flashTimer * 0.6);
        const color = this.flashType === "valid" ? 0x22c55e : 0xef4444;
        this.hudGfx.fillStyle(color, alphaVal);
        this.hudGfx.fillRect(0, 0, this.worldW, this.worldH);
    }

    _updateHUD() {
        if (this.highScore > 0) this.hiScoreText.setText("HI " + String(this.highScore).padStart(5, "0"));
        if (this.wordStreak >= 2) {
            const mult = Math.min(3.0, 1.0 + (this.wordStreak - 1) * 0.5);
            this.streakText.setText(this.wordStreak + "x STREAK (" + mult.toFixed(1) + "x)");
            this.streakText.setVisible(true);
        } else {
            this.streakText.setVisible(false);
        }
    }

    // -- Death ----------------------------------------------------------------

    _die() {
        if (this.playerState.dead) return;
        this.playerState.dead = true;
        this.gameOver = true;
        this.animator.die();

        this.playerBody.body.setVelocity(0, 0);
        this.playerBody.body.setAllowGravity(false);
        this.deathEmitter.emitParticleAt(this.playerScreenX, this.playerBody.y + PLAYER_H / 2, 15);
        this.screenShake = { intensity: 8, duration: 0.4 };
        this.flashTimer = 0.6;
        this.flashType = "invalid";
        this._drawFlash();

        const sx = this.playerScreenX;
        const sy = this.playerBody.y + PLAYER_H / 2 - 2;
        this.animator.draw(this.playerGfx, sx, sy);

        this.tweens.add({ targets: this.cameras.main, zoom: 1.05, duration: 300, ease: "Quad.easeOut" });

        this.time.delayedCall(600, () => {
            this.gameOverText.setVisible(true).setAlpha(0);
            this.gameOverScore.setText("Score: " + this.score).setVisible(true).setAlpha(0);
            this.tweens.add({ targets: [this.gameOverText, this.gameOverScore], alpha: 1, duration: 400, ease: "Quad.easeOut" });
        });

        if (this.audioRef) { try { this.audioRef.gameOver(); } catch (e) { /* */ } }

        this.time.delayedCall(1500, () => {
            if (this.callbacks.onGameOver) {
                this.callbacks.onGameOver({
                    score: this.score, coins: this.coins,
                    wordsFormed: this.wordsFormed, wordStreak: this.wordStreak,
                    distance: this.distance,
                });
            }
        });
    }

    // -- Word validation ------------------------------------------------------

    validateWord() {
        const letters = this.collectedLetters;
        if (letters.length < 3) { this._wordInvalid(); return null; }

        let bestWord = null;
        for (let len = letters.length; len >= 3; len--) {
            const candidate = letters.slice(0, len).join("");
            if (this.dictionaryRef.has(candidate)) { bestWord = candidate; break; }
        }
        if (!bestWord) { this._wordInvalid(); return null; }

        const word = bestWord;
        let pts = word.length * 10 * word.length;
        if (word.length >= 4) pts = Math.floor(pts * (1 + 0.15 * Math.pow(word.length - 3, 1.4)));
        let letterBonus = 0;
        for (const ch of word) { const val = this.letterValuesRef[ch] || 1; if (val > 1) letterBonus += val * 3; }
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
        this.scrollSpeed = Math.min(MAX_SPEED, this.scrollSpeed + 6);
        this.flashTimer = 0.5;
        this.flashType = "valid";
        this.screenShake = { intensity: 4, duration: 0.2 };
        applyJuice(this, null, "word-valid");
        this.sparkEmitter.emitParticleAt(this.playerScreenX, this.playerBody.y, 12);

        if (word.length >= letters.length) { this.collectedLetters = []; }
        else { this.collectedLetters = letters.slice(word.length); }

        if (this.audioRef) { try { this.audioRef._beep(880, 0.15, "sine", 0.15); } catch (e) { /* */ } }
        return { word, pts, coins: wordCoins, streak: this.wordStreak };
    }

    _wordInvalid() {
        this.wordStreak = 0;
        this.flashTimer = 0.3;
        this.flashType = "invalid";
        this.screenShake = { intensity: 3, duration: 0.15 };
        applyJuice(this, null, "word-invalid");
        if (this.audioRef) { try { this.audioRef._beep(220, 0.1, "square", 0.15); } catch (e) { /* */ } }
        this.collectedLetters = [];
    }

    // -- Spawning -------------------------------------------------------------

    _spawnContent() {
        const spawnTo = this.worldW + 800;  // Screen-space: spawn ahead of right edge
        const speed = Math.max(this.scrollSpeed, 140);
        const jumpVy = Math.abs(JUMP_VY);
        const airTime = (2 * jumpVy) / GRAVITY;
        const maxJumpDist = speed * airTime;

        const MIN_LETTER_GAP = speed * 0.9;
        const MIN_LETTER_GAP_Y = 50;
        const ROCK_CLEARANCE = 70;
        const REST_GAP = speed * 1.8;
        const LOW_STEP = 35;
        const MID_JUMP = 70;
        const HIGH_JUMP = 100;

        const recentLetters = [];
        for (const ls of this.letterSprites) {
            if (ls._collected || !ls.active) continue;
            recentLetters.push({ x: ls.x, y: ls._baseY });
        }

        const _letterOk = (x, y) => {
            for (const l of recentLetters) {
                if (Math.abs(x - l.x) < MIN_LETTER_GAP && Math.abs(y - l.y) < MIN_LETTER_GAP_Y) return false;
            }
            return true;
        };

        const _clearOfRocks = (x, y) => {
            let ok = true;
            this.rockGroup.children.iterate(r => {
                if (!r || !ok) return;
                if (Math.abs(x - r.x) < ROCK_CLEARANCE && Math.abs(y - r.y) < ROCK_CLEARANCE) ok = false;
            });
            return ok;
        };

        const _tryLetter = (worldX, worldY) => {
            if (!_letterOk(worldX, worldY)) return false;
            if (!_clearOfRocks(worldX, worldY)) return false;
            this._addLetterSprite(worldX, worldY, this.randomLetterFn(), Math.random() * Math.PI * 2);
            recentLetters.push({ x: worldX, y: worldY });
            return true;
        };

        while (this.nextSpawnX < spawnTo) {
            // Distance-based difficulty: harder phrases more likely over time
            const difficulty = Math.min(1.0, this.distance / 8000);  // 0→1 over ~8000px
            const roll = Math.random();

            // Phrase weights shift with distance:
            //   Early: Open Run (40%), Staircase (25%), Gap Bridge (15%), Sky Route (10%), Valley (5%), Sprint (5%)
            //   Late:  Open Run (15%), Staircase (15%), Gap Bridge (20%), Sky Route (20%), Valley (15%), Ruins (15%)
            const openRunCut   = 0.40 - difficulty * 0.25;
            const stairCut     = openRunCut + 0.25 - difficulty * 0.10;
            const gapBridgeCut = stairCut + 0.15 + difficulty * 0.05;
            const skyRouteCut  = gapBridgeCut + 0.10 + difficulty * 0.10;
            const valleyCut    = skyRouteCut + 0.05 + difficulty * 0.10;
            // remainder = Ruins (sprint zone)

            if (roll < openRunCut) {
                // Open Run
                const segLen = 400 + Math.random() * 300;
                const gStart = this.nextSpawnX;
                const gEnd = gStart + segLen;
                this._addGround(gStart, segLen);

                let rx = gStart + 120 + Math.random() * 80;
                while (rx < gEnd - 80) {
                    if (Math.random() < 0.50) {
                        const rh = 28 + Math.random() * 18;
                        const rw = 20 + Math.random() * 14;
                        this._addRockSprite(rx, this.groundY - rh, rw, rh);
                    }
                    rx += 140 + Math.random() * 160;
                }

                const numLetters = 2 + (Math.random() < 0.4 ? 1 : 0);
                const usable = segLen - 120;
                const step = Math.max(MIN_LETTER_GAP, usable / (numLetters + 1));
                for (let i = 1; i <= numLetters; i++) {
                    const lx = gStart + 60 + step * i;
                    if (lx < gEnd - 50) _tryLetter(lx, this.groundY - 44 - Math.random() * 12);
                }
                this.nextSpawnX = gEnd + 60 + Math.random() * 40;

            } else if (roll < stairCut) {
                // Staircase
                const gLen1 = 200 + Math.random() * 150;
                const g1Start = this.nextSpawnX;
                const g1End = g1Start + gLen1;
                this._addGround(g1Start, gLen1);
                if (Math.random() < 0.60) _tryLetter(g1Start + 80 + Math.random() * 40, this.groundY - 44);

                const gap1 = 35 + Math.random() * 25;
                const platW = 90 + Math.random() * 50;
                const platX = g1End + gap1;
                const heights = [LOW_STEP, MID_JUMP];
                const platH = heights[Math.floor(Math.random() * heights.length)];
                const platY = this.groundY - platH;
                this._addPlatformSprite(platX, platY, platW, 12);
                if (Math.random() < 0.65) _tryLetter(platX + platW / 2, platY - 26);

                const gap2 = 30 + Math.random() * 20;
                const gLen2 = 200 + Math.random() * 150;
                const g2Start = platX + platW + gap2;
                this._addGround(g2Start, gLen2);
                if (Math.random() < 0.45) _tryLetter(g2Start + 100 + Math.random() * 60, this.groundY - 44);
                this.nextSpawnX = g2Start + gLen2 + 50 + Math.random() * 40;

            } else if (roll < gapBridgeCut) {
                // Gap Bridge
                const gLen = 250 + Math.random() * 200;
                const gStart = this.nextSpawnX;
                const gEnd = gStart + gLen;
                this._addGround(gStart, gLen);
                if (Math.random() < 0.50) _tryLetter(gStart + 70 + Math.random() * 50, this.groundY - 44);

                const maxSafe = Math.min(maxJumpDist * 0.75, 140);
                const gapLen = 60 + Math.random() * Math.max(20, maxSafe - 60);
                const bridgeW = 70 + Math.random() * 30;
                const bridgeX = gEnd + (gapLen - bridgeW) / 2;
                const bridgeY = this.groundY - 15 - Math.random() * 20;
                this._addPlatformSprite(bridgeX, bridgeY, bridgeW, 12);
                if (Math.random() < 0.55) _tryLetter(bridgeX + bridgeW / 2, bridgeY - 26);

                const g2Len = 200 + Math.random() * 200;
                const g2Start = gEnd + gapLen;
                this._addGround(g2Start, g2Len);
                if (Math.random() < 0.40) _tryLetter(g2Start + 90 + Math.random() * 60, this.groundY - 44);
                this.nextSpawnX = g2Start + g2Len + 40 + Math.random() * 40;

            } else if (roll < skyRouteCut) {
                const gLen = 350 + Math.random() * 250;
                const gStart = this.nextSpawnX;
                const gEnd = gStart + gLen;
                this._addGround(gStart, gLen);
                if (Math.random() < 0.50) {
                    const rockX = gStart + 140 + Math.random() * 100;
                    this._addRockSprite(rockX, this.groundY - 28 - Math.random() * 18, 24, 28 + Math.random() * 18);
                }
                if (Math.random() < 0.55) _tryLetter(gStart + 80 + Math.random() * 60, this.groundY - 44);

                const skyW = 80 + Math.random() * 50;
                const skyX = gStart + gLen * 0.4 + Math.random() * gLen * 0.2;
                const skyY = this.groundY - HIGH_JUMP - Math.random() * 15;
                if (skyX + skyW < gEnd - 40) {
                    this._addPlatformSprite(skyX, skyY, skyW, 12);
                    if (Math.random() < 0.70) _tryLetter(skyX + skyW / 2, skyY - 26);
                }
                this.nextSpawnX = gEnd + 50 + Math.random() * 50;

            } else if (roll < valleyCut) {
                // Valley — ground dips down with platforms stepping into a gap, letters below
                const gLen1 = 200 + Math.random() * 120;
                const g1Start = this.nextSpawnX;
                this._addGround(g1Start, gLen1);
                if (Math.random() < 0.45) _tryLetter(g1Start + 60 + Math.random() * 50, this.groundY - 44);

                // Gap (the valley) — wider than normal, with stepping-stone platforms descending
                const valleyWidth = 180 + Math.random() * 100;
                const numStones = 2 + (Math.random() < 0.5 ? 1 : 0);
                const stoneSpacing = valleyWidth / (numStones + 1);
                for (let i = 1; i <= numStones; i++) {
                    const sx = g1Start + gLen1 + stoneSpacing * i - 30;
                    const sy = this.groundY + 10 + i * 18;  // descending steps
                    const sw = 55 + Math.random() * 25;
                    this._addPlatformSprite(sx, sy, sw, 12);
                    if (Math.random() < 0.60) _tryLetter(sx + sw / 2, sy - 26);
                }

                const g2Start = g1Start + gLen1 + valleyWidth;
                const gLen2 = 200 + Math.random() * 150;
                this._addGround(g2Start, gLen2);
                if (Math.random() < 0.40) _tryLetter(g2Start + 80 + Math.random() * 50, this.groundY - 44);
                this.nextSpawnX = g2Start + gLen2 + 40 + Math.random() * 40;

            } else {
                // Ruins — stacked platforms with letters, like a crumbling tower
                const gLen = 300 + Math.random() * 200;
                const gStart = this.nextSpawnX;
                const gEnd = gStart + gLen;
                this._addGround(gStart, gLen);

                // 2-3 platforms stacked at different heights, clustered together
                const numPlats = 2 + (Math.random() < 0.4 ? 1 : 0);
                const clusterX = gStart + gLen * 0.25 + Math.random() * gLen * 0.3;
                for (let i = 0; i < numPlats; i++) {
                    const pw = 60 + Math.random() * 40;
                    const px = clusterX + i * (pw * 0.6 + 15 + Math.random() * 20);
                    const py = this.groundY - LOW_STEP - i * (MID_JUMP * 0.6 + Math.random() * 15);
                    if (px + pw < gEnd - 30) {
                        this._addPlatformSprite(px, py, pw, 12);
                        if (Math.random() < 0.70) _tryLetter(px + pw / 2, py - 26);
                    }
                }

                // Rocks guarding the ground level
                if (Math.random() < 0.55) {
                    const rx = gStart + 80 + Math.random() * 60;
                    this._addRockSprite(rx, this.groundY - 30 - Math.random() * 15, 22, 30 + Math.random() * 15);
                }
                if (Math.random() < 0.45) _tryLetter(gStart + 50 + Math.random() * 40, this.groundY - 44);
                this.nextSpawnX = gEnd + 50 + Math.random() * 50;
            }

            this.nextSpawnX += REST_GAP * (0.4 + Math.random() * 0.3);
        }
    }

    // -- State management -----------------------------------------------------

    getState() {
        const grounds = [];
        this.groundGroup.children.iterate(child => {
            if (!child) return;
            grounds.push({ startX: child.body.position.x, endX: child.body.position.x + child.body.width });
        });
        const platforms = [];
        this.platformGroup.children.iterate(child => {
            if (!child) return;
            platforms.push({ x: child.body.position.x, y: child.body.position.y, w: child.body.width, h: child.body.height });
        });
        const rocks = [];
        this.rockGroup.children.iterate(child => {
            if (!child) return;
            rocks.push({ x: child.body.position.x, y: child.body.position.y, w: child.body.width, h: child.body.height });
        });
        const letters = [];
        for (const ls of this.letterSprites) {
            if (ls._collected || !ls.active) continue;
            letters.push({ x: ls.x, y: ls._baseY, letter: ls._letter, bobPhase: ls._bobPhase, collected: false });
        }
        return {
            version: 2, type: "word-runner",
            player: { worldX: this.playerState.worldX, y: this.playerBody.y, vy: this.playerBody.body.velocity.y },
            scrollSpeed: this.scrollSpeed, groundSegments: grounds, platforms, rocks, letters,
            nextSpawnX: this.nextSpawnX, collectedLetters: this.collectedLetters,
            score: this.score, coins: this.coins, wordsFormed: this.wordsFormed,
            distance: this.distance, wordScore: this.wordScore, wordStreak: this.wordStreak, maxWordStreak: this.maxWordStreak, highScore: this.highScore,
        };
    }

    pauseGame() {
        this.isPaused = true;
        this.physics.pause();
        if (this.callbacks.onPause) this.callbacks.onPause();
    }

    resumeGame() {
        this.isPaused = false;
        this.physics.resume();
    }

    endGame() {
        if (this.gameOver) return;
        this.gameOver = true;
        this.playerState.dead = true;
        this.animator.die();
        this.animator.draw(this.playerGfx, this.playerScreenX, this.playerBody.y + PLAYER_H / 2 - 2);
        if (this.callbacks.onGameOver) {
            this.callbacks.onGameOver({
                score: this.score, coins: this.coins, wordsFormed: this.wordsFormed,
                wordStreak: this.wordStreak, maxWordStreak: this.maxWordStreak, distance: this.distance,
            });
        }
    }
}

// -- Public API ---------------------------------------------------------------

export class WordRunnerGame {
    constructor(parentElement, config) {
        this.parentElement = parentElement;
        this.config = config;
        this.game = null;
        this.scene = null;
    }

    start(savedState = null) {
        const rect = this.parentElement.getBoundingClientRect();
        const w = Math.floor(rect.width) || 360;
        const h = Math.floor(rect.height) || Math.floor(window.innerHeight * 0.45);
        if (this.game) this.destroy();

        this.game = new Phaser.Game({
            type: Phaser.AUTO, width: w, height: h,
            parent: this.parentElement, backgroundColor: "#f7f7f7",
            transparent: false,
            physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false, fps: 120 } },
            scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
            scene: [],
            audio: { noAudio: true },
            input: { touch: { target: this.parentElement } },
            render: { pixelArt: false, antialias: true },
        });

        this.game.scene.add("WRGameScene", WRGameScene, true, {
            callbacks: this.config.callbacks || {},
            savedState, highScore: this.config.highScore || 0,
            randomLetterFn: this.config.randomLetterFn,
            dictionaryRef: this.config.dictionaryRef,
            audioRef: this.config.audioRef,
            letterValuesRef: this.config.letterValuesRef,
            coinsForWordFn: this.config.coinsForWordFn,
        });

        this.scene = this.game.scene.getScene("WRGameScene");
    }

    resize(w, h) { if (this.game) this.game.scale.resize(w, h); }
    getScene() { return this.game?.scene.getScene("WRGameScene"); }
    validateWord() { const s = this.getScene(); return s ? s.validateWord() : null; }
    pause() { const s = this.getScene(); if (s) s.pauseGame(); }
    resume() { const s = this.getScene(); if (s) s.resumeGame(); }
    endGame() { const s = this.getScene(); if (s) s.endGame(); }
    getState() { const s = this.getScene(); return s ? s.getState() : null; }
    getCollectedLetters() { const s = this.getScene(); return s ? s.collectedLetters : []; }
    getWordsFormed() { const s = this.getScene(); return s ? s.wordsFormed : []; }

    destroy() {
        if (this.game) { this.game.destroy(true); this.game = null; this.scene = null; }
    }
}
