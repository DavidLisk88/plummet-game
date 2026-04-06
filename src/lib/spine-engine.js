/**
 * spine-engine.js — Spine-TS skeletal animation system for PLUMMET
 *
 * Provides runtime-procedural Spine skeletons and animation management
 * for use across the entire application:
 *   - Phaser integration via @esotericsoftware/spine-phaser plugin
 *   - Canvas 2D renderer for non-Phaser contexts (challenge previews, tutorials)
 *   - Runtime skeleton builder for procedural characters (no .skel files needed)
 *   - Animation state machine with crossfade mixing
 *   - Skin/attachment system for character customization
 *   - Shared skeleton cache for performance
 */
import * as spine from '@esotericsoftware/spine-core';

// ── Skeleton Cache ──
const _skeletonCache = new Map();

/**
 * Create a runtime SkeletonData procedurally (no .skel/.atlas files needed).
 * Builds a simple stick-figure skeleton with bones and slots.
 *
 * @param {string} name - Unique skeleton identifier
 * @param {object} [opts] - Configuration for the skeleton structure
 * @returns {spine.SkeletonData}
 */
export function createProceduralSkeleton(name, opts = {}) {
    if (_skeletonCache.has(name)) return _skeletonCache.get(name);

    const {
        bones = DEFAULT_HUMANOID_BONES,
        width = 40,
        height = 60,
    } = opts;

    // Build skeleton data manually using Spine runtime structures
    const skeletonData = new spine.SkeletonData();
    skeletonData.name = name;
    skeletonData.width = width;
    skeletonData.height = height;

    // Root bone
    const rootBone = new spine.BoneData(0, 'root', null);
    rootBone.length = 0;
    skeletonData.bones.push(rootBone);

    // Build hierarchy from bone definitions
    const boneMap = new Map();
    boneMap.set('root', rootBone);

    bones.forEach((def, i) => {
        const parent = boneMap.get(def.parent) || rootBone;
        const bone = new spine.BoneData(i + 1, def.name, parent);
        bone.length = def.length || 10;
        bone.x = def.x || 0;
        bone.y = def.y || 0;
        bone.rotation = def.rotation || 0;
        bone.scaleX = def.scaleX || 1;
        bone.scaleY = def.scaleY || 1;
        skeletonData.bones.push(bone);
        boneMap.set(def.name, bone);
    });

    // Create default skin with slot/attachment placeholders
    const defaultSkin = new spine.Skin('default');
    skeletonData.defaultSkin = defaultSkin;
    skeletonData.skins.push(defaultSkin);

    _skeletonCache.set(name, skeletonData);
    return skeletonData;
}

// Default humanoid bone structure for a stick figure
const DEFAULT_HUMANOID_BONES = [
    { name: 'hip',        parent: 'root', x: 0, y: 0, length: 0 },
    { name: 'torso',      parent: 'hip',  x: 0, y: 14, length: 14, rotation: 0 },
    { name: 'neck',       parent: 'torso', x: 0, y: 14, length: 4 },
    { name: 'head',       parent: 'neck', x: 0, y: 4, length: 10 },
    { name: 'upperArmL',  parent: 'torso', x: 0, y: 12, length: 9, rotation: 30 },
    { name: 'lowerArmL',  parent: 'upperArmL', x: 0, y: 0, length: 8, rotation: -20 },
    { name: 'upperArmR',  parent: 'torso', x: 0, y: 12, length: 9, rotation: -30 },
    { name: 'lowerArmR',  parent: 'upperArmR', x: 0, y: 0, length: 8, rotation: 20 },
    { name: 'upperLegL',  parent: 'hip', x: -3, y: 0, length: 12, rotation: 180 },
    { name: 'lowerLegL',  parent: 'upperLegL', x: 0, y: 0, length: 10, rotation: 0 },
    { name: 'upperLegR',  parent: 'hip', x: 3, y: 0, length: 12, rotation: 180 },
    { name: 'lowerLegR',  parent: 'upperLegR', x: 0, y: 0, length: 10, rotation: 0 },
];

/**
 * Create a Skeleton instance from SkeletonData.
 *
 * @param {spine.SkeletonData} data
 * @returns {spine.Skeleton}
 */
export function createSkeleton(data) {
    const skeleton = new spine.Skeleton(data);
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform(spine.Physics.update);
    return skeleton;
}

// ── Animation State Machine ──

/**
 * Create an AnimationState with mixing configured.
 *
 * @param {spine.SkeletonData} data
 * @param {object} [mixConfig] - Pairs of [from, to, duration] for crossfade mixing
 * @returns {spine.AnimationState}
 */
export function createAnimationState(data, mixConfig = {}) {
    const stateData = new spine.AnimationStateData(data);

    // Default mix duration
    stateData.defaultMix = 0.2;

    // Custom mixes
    for (const [key, duration] of Object.entries(mixConfig)) {
        const [from, to] = key.split('->');
        if (from && to) {
            const fromAnim = data.findAnimation(from.trim());
            const toAnim = data.findAnimation(to.trim());
            if (fromAnim && toAnim) {
                stateData.setMixWith(fromAnim, toAnim, duration);
            }
        }
    }

    return new spine.AnimationState(stateData);
}

// ── Procedural Animation Builder ──

/**
 * Build a runtime animation for a procedural skeleton.
 * Creates keyframed bone rotations for common poses.
 *
 * @param {spine.SkeletonData} skeletonData
 * @param {string} animName
 * @param {Array<{time: number, bones: Object<string, {rotation?: number, x?: number, y?: number}>}>} keyframes
 * @param {number} duration - Total animation length in seconds
 * @returns {spine.Animation}
 */
export function buildProceduralAnimation(skeletonData, animName, keyframes, duration) {
    const timelines = [];

    // Collect all bones referenced in keyframes
    const boneNames = new Set();
    for (const kf of keyframes) {
        for (const name of Object.keys(kf.bones)) boneNames.add(name);
    }

    // Create a RotateTimeline for each bone
    for (const boneName of boneNames) {
        const boneIndex = skeletonData.bones.findIndex(b => b.name === boneName);
        if (boneIndex < 0) continue;

        // Gather rotation keyframes for this bone
        const rotFrames = [];
        for (const kf of keyframes) {
            if (kf.bones[boneName] && kf.bones[boneName].rotation !== undefined) {
                rotFrames.push({ time: kf.time, value: kf.bones[boneName].rotation });
            }
        }

        if (rotFrames.length > 0) {
            const timeline = new spine.RotateTimeline(rotFrames.length, 0, boneIndex);
            rotFrames.forEach((frame, i) => {
                timeline.setFrame(i, frame.time, frame.value);
            });
            timelines.push(timeline);
        }
    }

    const animation = new spine.Animation(animName, timelines, duration);
    skeletonData.animations.push(animation);
    return animation;
}

// ── Pre-built Animation Presets ──

/**
 * Build standard animation set for a humanoid skeleton.
 *
 * @param {spine.SkeletonData} skeletonData
 * @returns {Object<string, spine.Animation>}
 */
export function buildHumanoidAnimations(skeletonData) {
    const anims = {};

    // Run cycle
    anims.run = buildProceduralAnimation(skeletonData, 'run', [
        {
            time: 0,
            bones: {
                upperLegL: { rotation: 210 },
                lowerLegL: { rotation: -30 },
                upperLegR: { rotation: 150 },
                lowerLegR: { rotation: 10 },
                upperArmL: { rotation: -10 },
                upperArmR: { rotation: 50 },
                torso: { rotation: 3 },
            },
        },
        {
            time: 0.2,
            bones: {
                upperLegL: { rotation: 150 },
                lowerLegL: { rotation: 10 },
                upperLegR: { rotation: 210 },
                lowerLegR: { rotation: -30 },
                upperArmL: { rotation: 50 },
                upperArmR: { rotation: -10 },
                torso: { rotation: -3 },
            },
        },
        {
            time: 0.4,
            bones: {
                upperLegL: { rotation: 210 },
                lowerLegL: { rotation: -30 },
                upperLegR: { rotation: 150 },
                lowerLegR: { rotation: 10 },
                upperArmL: { rotation: -10 },
                upperArmR: { rotation: 50 },
                torso: { rotation: 3 },
            },
        },
    ], 0.4);

    // Jump
    anims.jump = buildProceduralAnimation(skeletonData, 'jump', [
        {
            time: 0,
            bones: {
                upperLegL: { rotation: 170 },
                lowerLegL: { rotation: 20 },
                upperLegR: { rotation: 190 },
                lowerLegR: { rotation: 20 },
                upperArmL: { rotation: 60 },
                upperArmR: { rotation: -60 },
                torso: { rotation: -5 },
            },
        },
    ], 0.5);

    // Idle
    anims.idle = buildProceduralAnimation(skeletonData, 'idle', [
        {
            time: 0,
            bones: {
                torso: { rotation: 0 },
                upperArmL: { rotation: 30 },
                upperArmR: { rotation: -30 },
                upperLegL: { rotation: 180 },
                upperLegR: { rotation: 180 },
            },
        },
        {
            time: 0.5,
            bones: {
                torso: { rotation: 1 },
                upperArmL: { rotation: 32 },
                upperArmR: { rotation: -32 },
            },
        },
        {
            time: 1.0,
            bones: {
                torso: { rotation: 0 },
                upperArmL: { rotation: 30 },
                upperArmR: { rotation: -30 },
            },
        },
    ], 1.0);

    // Death
    anims.death = buildProceduralAnimation(skeletonData, 'death', [
        {
            time: 0,
            bones: {
                torso: { rotation: 0 },
                head: { rotation: 0 },
            },
        },
        {
            time: 0.3,
            bones: {
                torso: { rotation: -80 },
                head: { rotation: -20 },
                upperArmL: { rotation: 90 },
                upperArmR: { rotation: -120 },
                upperLegL: { rotation: 140 },
                upperLegR: { rotation: 220 },
            },
        },
    ], 0.5);

    // Celebrate
    anims.celebrate = buildProceduralAnimation(skeletonData, 'celebrate', [
        {
            time: 0,
            bones: {
                upperArmL: { rotation: 80 },
                upperArmR: { rotation: -80 },
                torso: { rotation: 0 },
            },
        },
        {
            time: 0.2,
            bones: {
                upperArmL: { rotation: 130 },
                upperArmR: { rotation: -130 },
                torso: { rotation: 5 },
                hip: { y: 5 },
            },
        },
        {
            time: 0.5,
            bones: {
                upperArmL: { rotation: 80 },
                upperArmR: { rotation: -80 },
                torso: { rotation: 0 },
                hip: { y: 0 },
            },
        },
    ], 0.5);

    return anims;
}

// ── Canvas 2D Renderer ──

/**
 * Simplified Spine skeleton renderer for HTML5 Canvas 2D.
 * Used for challenge previews, tutorials, and non-Phaser contexts.
 */
export class SpineCanvasRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.skeleton = null;
        this.animState = null;
        this._lastTime = 0;
        this._rafId = null;
        this._running = false;
        this.boneStyle = {
            color: '#60a5fa',
            jointColor: '#93c5fd',
            headColor: '#60a5fa',
            lineWidth: 2.5,
            jointRadius: 3,
            headRadius: 7,
        };
    }

    /**
     * Load a procedural skeleton and start rendering.
     */
    load(skeletonData, animName = 'idle') {
        this.skeleton = createSkeleton(skeletonData);
        this.animState = createAnimationState(skeletonData);

        const anim = skeletonData.findAnimation(animName);
        if (anim) {
            this.animState.setAnimation(0, animName, true);
        }

        this.skeleton.x = this.canvas.width / 2;
        this.skeleton.y = this.canvas.height * 0.75;
    }

    /**
     * Set the current animation with optional looping and crossfade.
     */
    setAnimation(trackIndex, animName, loop = true) {
        if (this.animState) {
            this.animState.setAnimation(trackIndex, animName, loop);
        }
    }

    /**
     * Add an animation to a track (queued after current).
     */
    addAnimation(trackIndex, animName, loop, delay = 0) {
        if (this.animState) {
            this.animState.addAnimation(trackIndex, animName, loop, delay);
        }
    }

    /**
     * Update and render one frame.
     */
    update(delta) {
        if (!this.skeleton || !this.animState) return;

        try {
            this.animState.update(delta);
            this.animState.apply(this.skeleton);
            this.skeleton.update(delta);
            this.skeleton.updateWorldTransform(spine.Physics.update);
        } catch {
            // Spine update failure — skip this frame silently
            return;
        }

        this._render();
    }

    /**
     * Start the render loop.
     */
    start() {
        if (this._running) return;
        this._running = true;
        this._lastTime = performance.now();
        this._tick();
    }

    /**
     * Stop the render loop.
     */
    stop() {
        this._running = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /**
     * Destroy and clean up.
     */
    destroy() {
        this.stop();
        this.skeleton = null;
        this.animState = null;
    }

    _tick() {
        if (!this._running) return;
        const now = performance.now();
        const delta = (now - this._lastTime) / 1000;
        this._lastTime = now;

        this.update(delta);
        this._rafId = requestAnimationFrame(() => this._tick());
    }

    _render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);

        if (!this.skeleton) return;

        ctx.save();

        // Draw each bone as a line with joints
        const bones = this.skeleton.bones;
        const { color, jointColor, headColor, lineWidth, jointRadius, headRadius } = this.boneStyle;

        for (let i = 1; i < bones.length; i++) {
            const bone = bones[i];
            const parent = bone.parent;
            if (!parent) continue;

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.moveTo(parent.worldX, parent.worldY);
            ctx.lineTo(bone.worldX, bone.worldY);
            ctx.stroke();

            // Joint circle
            ctx.beginPath();
            ctx.fillStyle = jointColor;
            ctx.arc(bone.worldX, bone.worldY, jointRadius, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw head as a larger circle
        const headBone = this.skeleton.findBone('head');
        if (headBone) {
            ctx.beginPath();
            ctx.fillStyle = headColor;
            ctx.arc(headBone.worldX, headBone.worldY - headRadius, headRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.arc(headBone.worldX, headBone.worldY - headRadius, headRadius, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Position the skeleton within the canvas.
     */
    setPosition(x, y) {
        if (this.skeleton) {
            this.skeleton.x = x;
            this.skeleton.y = y;
        }
    }

    /**
     * Scale the skeleton (useful for different preview sizes).
     */
    setScale(sx, sy) {
        if (this.skeleton) {
            this.skeleton.scaleX = sx;
            this.skeleton.scaleY = sy || sx;
        }
    }
}

// ── Phaser Integration Helper ──

/**
 * Configuration for adding Spine to a Phaser game.
 * Returns a scene plugin configuration that can be passed to Phaser's game config.
 * 
 * Note: Full Spine-Phaser integration requires .skel + .atlas assets.
 * For runtime procedural skeletons (like the stick figure), use the
 * SpineCanvasRenderer or drawSpineSkeleton() helper below.
 * 
 * Currently returns null — procedural skeletons are rendered via Canvas 2D.
 * If .skel assets are added later, this can be updated to load the SpinePlugin.
 */
export function getSpinePhaserConfig() {
    // Procedural skeletons use our Canvas 2D renderer, not the Phaser plugin.
    // Return null so Phaser config omits the plugin gracefully.
    return null;
}

// ── Draw Helper for Phaser Graphics ──

/**
 * Draw a Spine skeleton onto a Phaser Graphics object.
 * Used in word-runner to render the player character with skeletal animation.
 *
 * @param {Phaser.GameObjects.Graphics} graphics - Phaser graphics context
 * @param {spine.Skeleton} skeleton - The Spine skeleton instance
 * @param {object} [style] - Visual style overrides
 */
export function drawSpineSkeletonOnGraphics(graphics, skeleton, style = {}) {
    if (!graphics || !skeleton) return;

    const {
        color = 0x60a5fa,
        jointColor = 0x93c5fd,
        headColor = 0x60a5fa,
        lineWidth = 2.5,
        jointRadius = 3,
        headRadius = 7,
    } = style;

    const bones = skeleton.bones;

    graphics.lineStyle(lineWidth, color, 1);

    for (let i = 1; i < bones.length; i++) {
        const bone = bones[i];
        const parent = bone.parent;
        if (!parent) continue;

        graphics.beginPath();
        graphics.moveTo(parent.worldX, parent.worldY);
        graphics.lineTo(bone.worldX, bone.worldY);
        graphics.strokePath();

        // Joint
        graphics.fillStyle(jointColor, 1);
        graphics.fillCircle(bone.worldX, bone.worldY, jointRadius);
    }

    // Head
    const headBone = skeleton.findBone('head');
    if (headBone) {
        graphics.fillStyle(headColor, 1);
        graphics.fillCircle(headBone.worldX, headBone.worldY - headRadius, headRadius);
        graphics.lineStyle(lineWidth, color, 1);
        graphics.strokeCircle(headBone.worldX, headBone.worldY - headRadius, headRadius);
    }
}

// ── Challenge Preview Spine Renderer ──

/**
 * Create a Spine-animated character for challenge preview cards.
 * Returns a controller object for managing the preview.
 *
 * @param {HTMLCanvasElement} canvas - The preview canvas
 * @param {string} animName - Starting animation ('run', 'idle', 'jump', 'celebrate')
 * @param {object} [opts]
 * @returns {{ renderer: SpineCanvasRenderer, destroy: Function, setAnimation: Function }}
 */
export function createChallengePreviewCharacter(canvas, animName = 'run', opts = {}) {
    const {
        scale = 1.5,
        x = null,
        y = null,
        boneStyle = {},
    } = opts;

    const skData = createProceduralSkeleton('plummet-humanoid');
    buildHumanoidAnimations(skData);

    const renderer = new SpineCanvasRenderer(canvas);
    Object.assign(renderer.boneStyle, boneStyle);
    renderer.load(skData, animName);
    renderer.setScale(scale, scale);
    renderer.setPosition(
        x !== null ? x : canvas.width / 2,
        y !== null ? y : canvas.height * 0.7
    );
    renderer.start();

    return {
        renderer,
        setAnimation(name, loop = true) {
            renderer.setAnimation(0, name, loop);
        },
        destroy() {
            renderer.destroy();
        },
    };
}

// ── Tutorial Scene Builder ──

/**
 * Create animated spine characters for tutorial screens.
 * Orchestrates a sequence of animations to demonstrate gameplay.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} tutorialType - 'run', 'jump', 'collect', 'word'
 * @returns {{ destroy: Function }}
 */
export function createTutorialAnimation(canvas, tutorialType = 'run') {
    const character = createChallengePreviewCharacter(canvas, 'idle', {
        scale: 2,
        boneStyle: {
            color: '#60a5fa',
            headColor: '#93c5fd',
            lineWidth: 3,
            headRadius: 9,
        },
    });

    const sequences = {
        run: ['run'],
        jump: ['run', 'jump', 'run'],
        collect: ['run', 'celebrate', 'idle'],
        word: ['idle', 'celebrate', 'idle'],
    };

    const animSequence = sequences[tutorialType] || sequences.run;
    let currentIndex = 0;

    character.setAnimation(animSequence[0], true);

    // Cycle through animation sequence
    const intervalId = setInterval(() => {
        currentIndex = (currentIndex + 1) % animSequence.length;
        character.setAnimation(animSequence[currentIndex], true);
    }, 2000);

    return {
        destroy() {
            clearInterval(intervalId);
            character.destroy();
        },
    };
}

// ── Re-exports ──

export { spine };
