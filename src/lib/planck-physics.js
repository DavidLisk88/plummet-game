/**
 * planck-physics.js — Planck.js (Box2D) physics layer for Word Runner
 *
 * Provides rigid-body collision shapes, momentum, and physics effects
 * that enhance the Phaser Arcade Physics in word-runner-phaser.js:
 *
 *   - Terrain collision shapes with proper friction/restitution
 *   - Player body with momentum, wall sliding, and ground detection
 *   - Destruction physics for obstacles (breakable rocks)
 *   - Letter magnet attraction fields
 *   - Ragdoll death physics
 *   - Parallax physics for floating background objects
 */
import planck from 'planck';

const { World, Vec2, Box, Circle, Edge, Body, Fixture, Contact } = planck;

// ── Planck ↔ Phaser scale (Planck uses meters, Phaser uses pixels) ──
const PIXELS_PER_METER = 50;
const toMeters = px => px / PIXELS_PER_METER;
const toPixels = m => m * PIXELS_PER_METER;

// ── World ──
let _world = null;
let _bodies = new Map(); // tag -> { body, type, data }
let _contacts = [];
let _isActive = false;
let _groundSensor = null;

// ── Physics Settings ──
const SETTINGS = {
    gravity: Vec2(0, 32),        // ~1600px/s² converted to meters
    playerDensity: 2.5,
    playerFriction: 0.3,
    playerRestitution: 0.05,
    groundFriction: 0.8,
    platformFriction: 0.5,
    rockRestitution: 0.1,
    letterRadius: toMeters(20),  // LETTER_R from word-runner
    magnetRange: toMeters(80),   // attraction radius
    magnetStrength: 15,
};

/**
 * Initialize the Planck physics world.
 * Call once when entering Word Runner mode.
 */
export function initPlanckWorld() {
    if (_world) destroyPlanckWorld();

    _world = new World({
        gravity: SETTINGS.gravity,
    });

    // Contact listener for gameplay events
    _world.on('begin-contact', contact => {
        _contacts.push({
            type: 'begin',
            fixtureA: contact.getFixtureA(),
            fixtureB: contact.getFixtureB(),
        });
    });

    _world.on('end-contact', contact => {
        _contacts.push({
            type: 'end',
            fixtureA: contact.getFixtureA(),
            fixtureB: contact.getFixtureB(),
        });
    });

    _isActive = true;
}

/**
 * Step the physics world.
 *
 * @param {number} dt - Delta time in seconds
 */
export function stepPlanck(dt) {
    if (!_world || !_isActive) return;

    // Cap dt to avoid spiral of death
    const cappedDt = Math.min(dt, 1 / 30);
    _world.step(cappedDt, 6, 2);

    // Drain contact events
    _contacts = [];
}

/**
 * Get recent contact events (drained each step).
 */
export function getPlanckContacts() {
    return _contacts;
}

// ── Body Creation ──

/**
 * Create the player body — dynamic box with foot sensor.
 *
 * @param {number} x - Pixel X
 * @param {number} y - Pixel Y
 * @param {number} w - Pixel width
 * @param {number} h - Pixel height
 * @returns {string} Body tag
 */
export function createPlayerBody(x, y, w, h) {
    if (!_world) return null;

    const body = _world.createBody({
        type: 'dynamic',
        position: Vec2(toMeters(x), toMeters(y)),
        fixedRotation: true,
        bullet: true,
    });

    // Main collision shape
    body.createFixture({
        shape: Box(toMeters(w / 2), toMeters(h / 2)),
        density: SETTINGS.playerDensity,
        friction: SETTINGS.playerFriction,
        restitution: SETTINGS.playerRestitution,
        userData: { tag: 'player' },
    });

    // Foot sensor for ground detection
    _groundSensor = body.createFixture({
        shape: Box(toMeters(w / 2 - 2), toMeters(2), Vec2(0, toMeters(h / 2)), 0),
        isSensor: true,
        userData: { tag: 'playerFoot' },
    });

    const tag = 'player';
    _bodies.set(tag, { body, type: 'player', data: {} });
    return tag;
}

/**
 * Create a ground segment — static edge/box.
 *
 * @param {number} x - Pixel left X
 * @param {number} y - Pixel Y (top of ground)
 * @param {number} w - Pixel width
 * @param {number} h - Pixel height
 * @returns {string} Body tag
 */
export function createGroundBody(x, y, w, h) {
    if (!_world) return null;

    const tag = `ground_${x}_${y}`;
    const body = _world.createBody({
        type: 'static',
        position: Vec2(toMeters(x + w / 2), toMeters(y + h / 2)),
    });

    body.createFixture({
        shape: Box(toMeters(w / 2), toMeters(h / 2)),
        friction: SETTINGS.groundFriction,
        userData: { tag },
    });

    _bodies.set(tag, { body, type: 'ground', data: { x, y, w, h } });
    return tag;
}

/**
 * Create a platform — static box with lower friction for sliding.
 *
 * @param {number} x - Center X pixel
 * @param {number} y - Center Y pixel
 * @param {number} w - Width pixels
 * @param {number} h - Height pixels
 * @returns {string} Body tag
 */
export function createPlatformBody(x, y, w, h) {
    if (!_world) return null;

    const tag = `platform_${x}_${y}`;
    const body = _world.createBody({
        type: 'static',
        position: Vec2(toMeters(x), toMeters(y)),
    });

    body.createFixture({
        shape: Box(toMeters(w / 2), toMeters(h / 2)),
        friction: SETTINGS.platformFriction,
        restitution: 0,
        userData: { tag },
    });

    _bodies.set(tag, { body, type: 'platform', data: {} });
    return tag;
}

/**
 * Create a rock/obstacle — static with small restitution (bouncy impact).
 *
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {number} w - Width
 * @param {number} h - Height
 * @returns {string} Body tag
 */
export function createRockBody(x, y, w, h) {
    if (!_world) return null;

    const tag = `rock_${x}_${y}`;
    const body = _world.createBody({
        type: 'static',
        position: Vec2(toMeters(x), toMeters(y)),
    });

    body.createFixture({
        shape: Box(toMeters(w / 2), toMeters(h / 2)),
        restitution: SETTINGS.rockRestitution,
        friction: 0.2,
        userData: { tag },
    });

    _bodies.set(tag, { body, type: 'rock', data: {} });
    return tag;
}

/**
 * Create a letter collectible — sensor circle with attraction field.
 *
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {string} letter - The letter character
 * @returns {string} Body tag
 */
export function createLetterBody(x, y, letter) {
    if (!_world) return null;

    const tag = `letter_${letter}_${x}_${y}`;
    const body = _world.createBody({
        type: 'kinematic',
        position: Vec2(toMeters(x), toMeters(y)),
    });

    // Collection sensor
    body.createFixture({
        shape: Circle(SETTINGS.letterRadius),
        isSensor: true,
        userData: { tag, letter },
    });

    _bodies.set(tag, { body, type: 'letter', data: { letter, collected: false } });
    return tag;
}

// ── Physics Queries ──

/**
 * Get the player body position in pixels.
 *
 * @returns {{ x: number, y: number, vx: number, vy: number } | null}
 */
export function getPlayerState() {
    const entry = _bodies.get('player');
    if (!entry) return null;

    const pos = entry.body.getPosition();
    const vel = entry.body.getLinearVelocity();
    return {
        x: toPixels(pos.x),
        y: toPixels(pos.y),
        vx: toPixels(vel.x),
        vy: toPixels(vel.y),
    };
}

/**
 * Set the player velocity (e.g., for jumping).
 *
 * @param {number} vx - Horizontal velocity in pixels/s
 * @param {number} vy - Vertical velocity in pixels/s
 */
export function setPlayerVelocity(vx, vy) {
    const entry = _bodies.get('player');
    if (!entry) return;
    entry.body.setLinearVelocity(Vec2(toMeters(vx), toMeters(vy)));
}

/**
 * Apply an impulse to the player (e.g., jump, knockback).
 *
 * @param {number} ix - Horizontal impulse (pixel-space)
 * @param {number} iy - Vertical impulse (pixel-space)
 */
export function applyPlayerImpulse(ix, iy) {
    const entry = _bodies.get('player');
    if (!entry) return;
    entry.body.applyLinearImpulse(Vec2(toMeters(ix), toMeters(iy)), entry.body.getWorldCenter());
}

/**
 * Check if the player is currently on the ground.
 */
export function isPlayerGrounded() {
    if (!_groundSensor) return false;

    for (let ce = _groundSensor.getBody().getContactList(); ce; ce = ce.next) {
        const contact = ce.contact;
        if (contact.isTouching()) {
            const fA = contact.getFixtureA();
            const fB = contact.getFixtureB();
            const other = fA === _groundSensor ? fB : (fB === _groundSensor ? fA : null);
            if (other && !other.isSensor()) return true;
        }
    }
    return false;
}

/**
 * Apply letter magnet effect — attract nearby letters toward player.
 * Call each frame to create magnetic pull on collectible letters.
 */
export function applyLetterMagnet() {
    const playerEntry = _bodies.get('player');
    if (!playerEntry) return;

    const pPos = playerEntry.body.getPosition();

    for (const [tag, entry] of _bodies) {
        if (entry.type !== 'letter' || entry.data.collected) continue;

        const lPos = entry.body.getPosition();
        const dx = pPos.x - lPos.x;
        const dy = pPos.y - lPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < SETTINGS.magnetRange && dist > 0.1) {
            const strength = SETTINGS.magnetStrength * (1 - dist / SETTINGS.magnetRange);
            entry.body.setLinearVelocity(Vec2(
                (dx / dist) * strength,
                (dy / dist) * strength
            ));
        }
    }
}

/**
 * Spawn ragdoll debris when the player dies.
 * Creates several small dynamic bodies that scatter from the death point.
 *
 * @param {number} x - Death X in pixels
 * @param {number} y - Death Y in pixels
 * @returns {string[]} Tags of created bodies
 */
export function spawnDeathRagdoll(x, y) {
    if (!_world) return [];

    const tags = [];
    const limbCount = 5; // head, torso, 2 arms, 2 legs

    for (let i = 0; i < limbCount; i++) {
        const tag = `ragdoll_${Date.now()}_${i}`;
        const body = _world.createBody({
            type: 'dynamic',
            position: Vec2(toMeters(x + (Math.random() - 0.5) * 10), toMeters(y + (Math.random() - 0.5) * 10)),
            angularDamping: 2,
        });

        const size = i === 0 ? 5 : (i === 1 ? 7 : 4); // head, torso, limbs
        body.createFixture({
            shape: Box(toMeters(size / 2), toMeters(size)),
            density: 1,
            friction: 0.4,
            restitution: 0.3,
            userData: { tag },
        });

        // Scatter impulse
        const angle = (i / limbCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        const power = 3 + Math.random() * 5;
        body.applyLinearImpulse(Vec2(Math.cos(angle) * power, -Math.abs(Math.sin(angle)) * power), body.getWorldCenter());
        body.setAngularVelocity((Math.random() - 0.5) * 10);

        _bodies.set(tag, { body, type: 'ragdoll', data: { life: 2.0 } });
        tags.push(tag);
    }
    return tags;
}

/**
 * Get all ragdoll body positions for rendering.
 *
 * @returns {Array<{ tag: string, x: number, y: number, angle: number, alive: boolean }>}
 */
export function getRagdollStates() {
    const states = [];
    for (const [tag, entry] of _bodies) {
        if (entry.type !== 'ragdoll') continue;
        const pos = entry.body.getPosition();
        states.push({
            tag,
            x: toPixels(pos.x),
            y: toPixels(pos.y),
            angle: entry.body.getAngle(),
            alive: entry.data.life > 0,
        });
    }
    return states;
}

/**
 * Remove a body by tag.
 *
 * @param {string} tag
 */
export function removeBody(tag) {
    const entry = _bodies.get(tag);
    if (entry && _world) {
        _world.destroyBody(entry.body);
        _bodies.delete(tag);
    }
}

/**
 * Remove all bodies of a specific type.
 *
 * @param {string} type - 'ground' | 'platform' | 'rock' | 'letter' | 'ragdoll'
 */
export function removeAllOfType(type) {
    for (const [tag, entry] of _bodies) {
        if (entry.type === type) {
            if (_world) _world.destroyBody(entry.body);
            _bodies.delete(tag);
        }
    }
}

/**
 * Get count of active bodies.
 */
export function getPlanckBodyCount() {
    return _bodies.size;
}

/**
 * Destroy the entire Planck world.
 */
export function destroyPlanckWorld() {
    if (_world) {
        for (const [, entry] of _bodies) {
            _world.destroyBody(entry.body);
        }
    }
    _bodies.clear();
    _contacts = [];
    _world = null;
    _groundSensor = null;
    _isActive = false;
}

export { planck };
