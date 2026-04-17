/**
 * howler-audio.js — Enhanced audio system using Howler.js
 * 
 * Replaces the basic Web Audio API beep system with Howler.js for:
 *   - Better cross-browser/mobile audio support
 *   - Proper audio sprites for game SFX
 *   - Improved music streaming with crossfade
 *   - Volume control that works on iOS
 *   - Audio pooling for performance
 * 
 * Maintains full backwards compatibility with the existing AudioManager API.
 */
import { Howl, Howler } from 'howler';

// ── SFX Synthesizer using Howler.js + Web Audio ──

/**
 * Synthesize a beep tone and return a Howl-compatible audio buffer.
 * Uses the Web Audio API offline context for synthesis, then wraps in Howler.
 */
function _synthBeep(freq, duration, type = 'square', vol = 0.12) {
    const sampleRate = 44100;
    const length = Math.ceil(sampleRate * duration);
    const ctx = new OfflineAudioContext(1, length, sampleRate);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, 0);
    gain.gain.exponentialRampToValueAtTime(0.001, duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(0);
    osc.stop(duration);

    return ctx.startRendering();
}

/**
 * Convert an AudioBuffer to a WAV Blob URL for Howler.
 */
function _bufferToWavUrl(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = length * blockAlign;
    const headerSize = 44;
    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    // Write samples
    const data = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, data[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
    }

    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
}

// Pre-synthesized SFX cache
const _sfxCache = new Map();

async function _getOrSynthSfx(key, freq, duration, type, vol) {
    if (_sfxCache.has(key)) return _sfxCache.get(key);

    try {
        const buffer = await _synthBeep(freq, duration, type, vol);
        const url = _bufferToWavUrl(buffer);
        const howl = new Howl({ src: [url], format: ['wav'], volume: vol, preload: true });
        _sfxCache.set(key, howl);
        return howl;
    } catch {
        return null;
    }
}

// ── Enhanced AudioManager using Howler.js ──

export class HowlerAudioManager {
    constructor() {
        this.muted = false;
        this.sfxVolume = 0.5;
        this._initialized = false;
        this._initPromise = null;
    }

    /**
     * Lazy-initialize SFX on first user interaction.
     */
    async _ensureInit() {
        if (this._initialized) return;
        if (this._initPromise) return this._initPromise;

        this._initPromise = this._initSfx();
        await this._initPromise;
        this._initialized = true;
    }

    async _initSfx() {
        // Pre-synthesize common SFX
        const sfxDefs = [
            ['land', 220, 0.1, 'triangle', 0.12],
            ['land_fast', 160, 0.12, 'triangle', 0.18],
            ['land_fast2', 100, 0.08, 'triangle', 0.08],
            ['clear3', 440, 0.2, 'sine', 0.15],
            ['clear4', 520, 0.2, 'sine', 0.15],
            ['clear5', 600, 0.2, 'sine', 0.15],
            ['clear5b', 750, 0.15, 'sine', 0.10],
            ['clear6', 680, 0.2, 'sine', 0.15],
            ['clear7', 760, 0.2, 'sine', 0.15],
            ['chain1', 660, 0.25, 'sine', 0.18],
            ['chain1b', 792, 0.15, 'sine', 0.12],
            ['chain2', 770, 0.25, 'sine', 0.18],
            ['chain2b', 924, 0.15, 'sine', 0.12],
            ['chain3', 880, 0.25, 'sine', 0.18],
            ['chain3b', 1056, 0.15, 'sine', 0.12],
            ['bomb', 140, 0.2, 'sawtooth', 0.12],
            ['bomb2', 90, 0.35, 'triangle', 0.1],
            ['gameover1', 200, 0.4, 'sawtooth', 0.10],
            ['gameover2', 150, 0.5, 'sawtooth', 0.08],
            ['collect', 660, 0.12, 'sine', 0.12],
            ['jump', 440, 0.08, 'sine', 0.08],
            ['valid', 880, 0.15, 'sine', 0.15],
            ['invalid', 220, 0.1, 'square', 0.15],
        ];

        await Promise.all(sfxDefs.map(([key, freq, dur, type, vol]) =>
            _getOrSynthSfx(key, freq, dur, type, vol)
        ));
    }

    _play(key) {
        if (this.muted) return;
        const sfx = _sfxCache.get(key);
        if (sfx) {
            sfx.volume(this.sfxVolume);
            sfx.play();
        }
    }

    /**
     * Play a synthesized beep (backwards-compatible with old AudioManager._beep).
     */
    async _beep(freq, duration, type = 'square', vol = 0.12) {
        if (this.muted) return;
        const key = `beep_${freq}_${duration}_${type}`;
        const sfx = await _getOrSynthSfx(key, freq, duration, type, vol);
        if (sfx) {
            sfx.volume(vol * (this.sfxVolume / 0.5));
            sfx.play();
        }
    }

    land(isFastDrop = false) {
        this._ensureInit();
        if (isFastDrop) {
            this._play('land_fast');
            setTimeout(() => this._play('land_fast2'), 30);
        } else {
            this._play('land');
        }
    }

    clear(wordLength = 3) {
        this._ensureInit();
        const key = `clear${Math.min(wordLength, 7)}`;
        this._play(key);
        if (wordLength >= 5) {
            setTimeout(() => this._play(`clear5b`), 60);
        }
    }

    chain(chainCount = 1) {
        this._ensureInit();
        const idx = Math.min(chainCount, 3);
        this._play(`chain${idx}`);
        setTimeout(() => this._play(`chain${idx}b`), 80);
    }

    bomb() {
        this._ensureInit();
        this._play('bomb');
        setTimeout(() => this._play('bomb2'), 80);
    }

    gameOver() {
        this._ensureInit();
        this._play('gameover1');
        setTimeout(() => this._play('gameover2'), 400);
    }

    collect(letterIndex = 0) {
        this._ensureInit();
        const freq = 660 + letterIndex * 80;
        this._beep(freq, 0.12, 'sine', 0.12);
    }

    jump(airJumps = 0) {
        this._ensureInit();
        const freq = 440 + airJumps * 30;
        this._beep(freq, 0.08, 'sine', 0.08);
    }

    wordValid() {
        this._ensureInit();
        this._play('valid');
    }

    wordInvalid() {
        this._ensureInit();
        this._play('invalid');
    }

    toggle() {
        this.muted = !this.muted;
        Howler.mute(this.muted);
        return this.muted;
    }

    setSfxVolume(vol) {
        this.sfxVolume = Math.max(0, Math.min(1, vol));
    }
}

// ── Enhanced Music Player using Howler.js ──

export class HowlerMusicPlayer {
    constructor(playlistManager) {
        this.plMgr = playlistManager;
        // Initialize muted state from localStorage (same key used by Game._initMutePref)
        this.muted = localStorage.getItem('wf_music_muted') === '1';
        this._volume = parseFloat(localStorage.getItem('wf_music_volume') || '0.7');
        this.playing = false;
        this.currentTrackId = null;
        this.activePlaylist = '__default';
        this.queue = [];
        this.queueIndex = -1;

        // Current Howl instance
        this._currentHowl = null;

        // Web Audio API for volume control on mobile (iOS ignores html5 audio.volume)
        this._audioCtx = null;
        this._gainNode = null;
        this._connectedSources = new WeakMap(); // Track which Howls we've connected

        // Shuffle & repeat
        this.shuffleOn = localStorage.getItem('wf_music_shuffle') === '1';
        this._shuffledQueue = [];
        this._shuffledIndex = -1;
        this.repeatMode = localStorage.getItem('wf_music_repeat') || 'all';

        // Track user-initiated pause vs OS-killed audio
        this._intentionallyPaused = localStorage.getItem('wf_music_paused') === '1';

        // Crossfade
        this._crossfadeDuration = 1.5;
        this._crossfadeHowl = null;
        this._crossfading = false;

        // VBR duration stability tracking (F2)
        this._lastKnownDuration = 0;
        this._durationStableSince = 0;

        // Circuit breaker: consecutive load failures across tracks (F3)
        this._consecutiveTrackFailures = 0;

        // Sleep timer
        this.sleepTimerEnd = 0;
        this.sleepTimerInterval = null;
        this.onSleepTimerTick = null;

        // Callbacks
        this.onStateChange = null;
        this.onTimeUpdate = null;

        // Time update interval
        this._timeUpdateInterval = null;

        // iOS AudioContext suspension watchdog
        this._watchdogTimer = setInterval(() => this._audioWatchdog(), 3000);

        this._buildQueue();
        this._restoreMusicState();
    }

    // ── Web Audio GainNode for volume control (mobile support) ──
    
    _ensureAudioContext() {
        // If we have a context but it's been closed, discard it
        if (this._audioCtx && this._audioCtx.state === 'closed') {
            this._audioCtx = null;
            this._gainNode = null;
        }
        if (!this._audioCtx) {
            this._audioCtx = Howler.ctx || new (window.AudioContext || window.webkitAudioContext)();
            // Listen for iOS-triggered suspensions so we can auto-resume
            this._audioCtx.onstatechange = () => {
                if (this._audioCtx.state === 'suspended' && this.playing) {
                    this._audioCtx.resume().catch(() => {});
                }
                // iOS reports 'interrupted' when system audio takes over
                if (this._audioCtx.state === 'interrupted' && this.playing) {
                    this._audioCtx.resume().catch(() => {});
                }
            };
        }
        if (this._audioCtx.state === 'suspended' || this._audioCtx.state === 'interrupted') {
            this._audioCtx.resume().catch(() => {});
        }
        if (!this._gainNode) {
            this._gainNode = this._audioCtx.createGain();
            this._gainNode.connect(this._audioCtx.destination);
            this._gainNode.gain.value = this.muted ? 0 : this._volume;
        }
    }

    _connectHowlToGain(howl) {
        if (!howl || this._connectedSources.has(howl)) return;
        
        this._ensureAudioContext();
        
        // Get the underlying Howler sound node(s)
        const sounds = howl._sounds;
        if (!sounds || sounds.length === 0) return;
        
        for (const sound of sounds) {
            // For html5 mode, get the audio element and create MediaElementSource
            if (sound._node && sound._node instanceof HTMLAudioElement) {
                try {
                    // Check if already has a source node (createMediaElementSource can only be called once)
                    if (!sound._gainNode && !sound._node._webAudioConnected) {
                        const source = this._audioCtx.createMediaElementSource(sound._node);
                        sound._gainNode = this._audioCtx.createGain();
                        source.connect(sound._gainNode);
                        sound._gainNode.connect(this._gainNode);
                        sound._node._webAudioConnected = true;
                    }
                } catch (e) {
                    // Already connected or other error - fallback to Howler volume
                    console.warn('Could not connect to Web Audio:', e.message);
                    sound._node._webAudioConnected = true; // Mark so we don't try again
                }
            }
        }
        
        this._connectedSources.set(howl, true);
    }

    _applyVolume() {
        const effectiveVol = this.muted ? 0 : this._volume;
        
        // Update GainNode if available (works on mobile)
        if (this._gainNode) {
            this._gainNode.gain.value = effectiveVol;
        }
        
        // Also set Howler volume as fallback
        if (this._currentHowl) {
            this._currentHowl.volume(effectiveVol);
        }
        if (this._crossfadeHowl) {
            this._crossfadeHowl.volume(effectiveVol);
        }
    }

    // ── Queue Management ──

    _buildQueue() {
        this.queue = this.plMgr.getPlaylistTrackIds(this.activePlaylist);
        if (this.shuffleOn) this._reshuffleQueue();
    }

    _reshuffleQueue() {
        this._shuffledQueue = [...this.queue];
        // Fisher-Yates shuffle
        for (let i = this._shuffledQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this._shuffledQueue[i], this._shuffledQueue[j]] = [this._shuffledQueue[j], this._shuffledQueue[i]];
        }
        // Ensure the track we just finished is NOT first (avoid immediate repeat)
        if (this.currentTrackId && this._shuffledQueue.length > 1) {
            const idx = this._shuffledQueue.indexOf(this.currentTrackId);
            if (idx === 0) {
                // Move it to the end instead
                this._shuffledQueue.push(this._shuffledQueue.shift());
            }
        }
        this._shuffledIndex = 0;
    }

    _getEffectiveQueue() {
        return this.shuffleOn ? this._shuffledQueue : this.queue;
    }

    _getEffectiveIndex() {
        return this.shuffleOn ? this._shuffledIndex : this.queueIndex;
    }

    _setEffectiveIndex(idx) {
        if (this.shuffleOn) this._shuffledIndex = idx;
        else this.queueIndex = idx;
    }

    setActivePlaylist(name) {
        this.activePlaylist = name;
        this._buildQueue();
        if (this.currentTrackId) {
            const q = this._getEffectiveQueue();
            const idx = q.indexOf(this.currentTrackId);
            if (idx >= 0) { this._setEffectiveIndex(idx); return; }
        }
        this._setEffectiveIndex(-1);
    }

    refreshQueue() {
        this._buildQueue();
        if (this.currentTrackId) {
            const q = this._getEffectiveQueue();
            const idx = q.indexOf(this.currentTrackId);
            if (idx >= 0) this._setEffectiveIndex(idx);
        }
    }

    _getNextTrackId() {
        const q = this._getEffectiveQueue();
        if (q.length === 0) return null;
        let nextIdx = this._getEffectiveIndex() + 1;
        if (nextIdx >= q.length) {
            if (this.repeatMode === 'off') return null;
            nextIdx = 0;
        }
        return q[nextIdx] || null;
    }

    // ── Shuffle & Repeat ──

    toggleShuffle() {
        this.shuffleOn = !this.shuffleOn;
        localStorage.setItem('wf_music_shuffle', this.shuffleOn ? '1' : '0');
        if (this.shuffleOn) {
            this._reshuffleQueue();
        } else if (this.currentTrackId) {
            this.queueIndex = this.queue.indexOf(this.currentTrackId);
        }
        this._notify();
    }

    cycleRepeat() {
        if (this.repeatMode === 'off') this.repeatMode = 'all';
        else if (this.repeatMode === 'all') this.repeatMode = 'one';
        else this.repeatMode = 'off';
        localStorage.setItem('wf_music_repeat', this.repeatMode);
        this._notify();
    }

    // ── Playback ──

    playTrackById(trackId) {
        const track = this.plMgr.getTrack(trackId);
        if (!track) return;

        this._intentionallyPaused = false;
        const q = this._getEffectiveQueue();
        const idx = q.indexOf(trackId);
        if (idx >= 0) this._setEffectiveIndex(idx);
        else {
            this.setActivePlaylist('__default');
            const q2 = this._getEffectiveQueue();
            this._setEffectiveIndex(q2.indexOf(trackId));
        }
        this.currentTrackId = trackId;
        this._cancelCrossfade();
        // Reset duration tracking for crossfade stability (F2)
        this._lastKnownDuration = 0;
        this._durationStableSince = 0;

        // Stop current track
        if (this._currentHowl) {
            this._currentHowl.unload();
            this._currentHowl = null;
        }

        // Create new Howl for the track
        this._loadRetries = 0;
        this._currentHowl = new Howl({
            src: [track.file],
            html5: true,  // Streaming for music (doesn't load entire file)
            volume: this._volume,
            mute: this.muted,  // Set initial mute state for mobile reliability
            onend: () => this._onTrackEnded(),
            onload: () => {
                this._loadRetries = 0;
                this._consecutiveTrackFailures = 0; // Reset circuit breaker on successful load
                // Connect to Web Audio GainNode for mobile volume control
                this._connectHowlToGain(this._currentHowl);
                this._applyVolume();
            },
            onloaderror: (id, err) => {
                console.warn('♪ Howler load error on track', trackId, err, 'attempt', this._loadRetries + 1);
                this._loadRetries++;
                if (this._loadRetries <= 2) {
                    // Retry after a short delay (iOS sometimes fails first load after background)
                    setTimeout(() => {
                        if (this._currentHowl) {
                            try { this._currentHowl.unload(); } catch {}
                        }
                        this.playTrackById(trackId);
                    }, 500 * this._loadRetries);
                } else {
                    this._loadRetries = 0;
                    this._consecutiveTrackFailures++;
                    // Circuit breaker: stop trying after failing more tracks than the queue has
                    if (this._consecutiveTrackFailures >= this._getEffectiveQueue().length) {
                        console.warn('♪ All tracks failed to load — stopping playback');
                        this._consecutiveTrackFailures = 0;
                        this.playing = false;
                        this._notify();
                    } else if (this.playing) {
                        this.next();
                    }
                }
            },
            onplayerror: (id, err) => {
                console.warn('♪ Howler play error on track', trackId, err);
                // Try unlocking audio context
                Howler.ctx?.resume();
                if (this._currentHowl) this._currentHowl.play();
            },
        });

        this._currentHowl.play();
        this.playing = true;
        localStorage.setItem('wf_music_paused', '0');
        this._startTimeUpdates();
        this._saveMusicState();
        this._notify();
    }

    play() {
        this._intentionallyPaused = false;
        if (this.currentTrackId && this._currentHowl) {
            // Connect to Web Audio and apply volume (mobile support)
            this._connectHowlToGain(this._currentHowl);
            this._applyVolume();
            this._currentHowl.mute(this.muted);
            this._currentHowl.play();
            this.playing = true;
            localStorage.setItem('wf_music_paused', '0');
            this._startTimeUpdates();
            this._notify();
        } else {
            const q = this._getEffectiveQueue();
            if (q.length > 0) {
                this._setEffectiveIndex(0);
                this.playTrackById(q[0]);
            }
        }
    }

    pause() {
        this._intentionallyPaused = true;
        if (this._currentHowl) this._currentHowl.pause();
        this._cancelCrossfade();
        this.playing = false;
        this._stopTimeUpdates();
        this._saveMusicState();
        localStorage.setItem('wf_music_paused', '1');
        this._notify();
    }

    /**
     * Pause audio when app is backgrounded.
     * Uses the real pause() so the UI button updates to "play" state.
     * Suspends Web Audio contexts to prevent OS from killing them.
     */
    pauseForBackground() {
        if (!this.playing) return;
        this._autoPausedByBackground = true;
        // Use the real pause so UI reflects paused state
        this.pause();
        // Also mark as NOT intentionally paused so we know it was backgrounding
        this._intentionallyPaused = false;
        // Suspend Web Audio contexts
        const suspendCtx = (ctx) => {
            if (ctx && ctx.state === 'running') {
                ctx.suspend().catch(e => console.warn('[Music] pauseForBackground: ctx.suspend() failed:', e));
            }
        };
        suspendCtx(Howler.ctx);
        suspendCtx(this._audioCtx);
    }

    /**
     * Resume audio contexts after returning from background.
     * Does NOT auto-play — user taps the play button when ready.
     * Just ensures audio contexts are alive so play() works cleanly.
     */
    resumeFromBackground() {
        if (!this._autoPausedByBackground) return;
        this._autoPausedByBackground = false;
        // Wake up audio contexts so the play button works immediately
        const resumeCtx = (ctx) => {
            if (ctx && ctx.state !== 'running') {
                ctx.resume().catch(() => {});
            }
        };
        resumeCtx(Howler.ctx);
        resumeCtx(this._audioCtx);
    }

    toggle() {
        this.playing ? this.pause() : this.play();
    }

    resumePlayback() {
        // Check if user was playing before backgrounding
        // (playing may have been set to false by onend firing during background)
        if (!this.currentTrackId) return;
        if (!this.playing && !this._intentionallyPaused) {
            // OS killed audio while backgrounded — restore playing state
            this.playing = true;
        }
        if (!this.playing) return;  // User actually paused — don't resume
        this._intentionallyPaused = false;

        // Resume Web Audio contexts (both Howler's and ours)
        // iOS uses 'interrupted' state; other platforms use 'suspended'
        const resumeCtx = (ctx) => {
            if (ctx && ctx.state !== 'running') {
                ctx.resume().catch(() => {});
            }
        };
        resumeCtx(Howler.ctx);
        resumeCtx(this._audioCtx);

        if (this._currentHowl) {
            // Check if the underlying Howl is still functional
            const state = this._currentHowl.state();
            if (state === 'unloaded' || state === 'loading') {
                // Howl was destroyed by OS during background — recreate it
                this._rekindleTrack();
                return;
            }
            // iOS sometimes leaves the HTMLAudioElement in a broken state
            // where state is 'loaded' but .playing() returns false and play() silently fails.
            // Detect by checking the underlying <audio> element's error property.
            try {
                const sounds = this._currentHowl._sounds || [];
                for (const s of sounds) {
                    if (s._node && s._node.error) {
                        console.warn('♪ Underlying audio element has error, rekindling');
                        this._rekindleTrack();
                        return;
                    }
                }
            } catch (_) {}

            if (!this._currentHowl.playing()) {
                try {
                    this._connectHowlToGain(this._currentHowl);
                    this._applyVolume();
                    this._currentHowl.play();
                    // Verify playback actually started after a short delay
                    setTimeout(() => {
                        if (this.playing && this._currentHowl && !this._currentHowl.playing()) {
                            console.warn('♪ Play call succeeded but not playing, rekindling');
                            this._rekindleTrack();
                        }
                    }, 500);
                } catch (e) {
                    // Play failed — recreate the track entirely
                    console.warn('\u266a Resume play failed, rekindling track:', e.message);
                    this._rekindleTrack();
                }
            }
        } else {
            // Howl was garbage collected — recreate
            this._rekindleTrack();
        }
    }

    /**
     * Recreate the current track's Howl from scratch.
     * Called when the OS has killed the underlying audio resource.
     */
    _rekindleTrack() {
        if (!this.currentTrackId) return;
        const track = this.plMgr.getTrack(this.currentTrackId);
        if (!track) return;
        // Save position before we destroy
        let pos = 0;
        try { pos = this._currentHowl ? this._currentHowl.seek() || 0 : 0; } catch {}
        // Clean up the dead Howl
        try { if (this._currentHowl) this._currentHowl.unload(); } catch {}
        this._currentHowl = null;

        this._currentHowl = new Howl({
            src: [track.file],
            html5: true,
            volume: this._volume,
            mute: this.muted,
            onend: () => this._onTrackEnded(),
            onload: () => {
                this._connectHowlToGain(this._currentHowl);
                this._applyVolume();
                // Restore position if we had one
                if (pos > 0 && this._currentHowl.duration() > 0) {
                    this._currentHowl.seek(Math.min(pos, this._currentHowl.duration()));
                }
            },
            onloaderror: (id, err) => {
                console.warn('\u266a Rekindle load error:', err);
                this.playing = false;
                this._notify();
            },
            onplayerror: (id, err) => {
                console.warn('\u266a Rekindle play error:', err);
                if (Howler.ctx) Howler.ctx.resume().catch(() => {});
                try { this._currentHowl.play(); } catch {}
            },
        });

        this._currentHowl.play();
        this.playing = true;
        this._startTimeUpdates();
        this._notify();
    }

    _audioWatchdog() {
        if (!this.playing || !this.currentTrackId) return;
        // Don't restart tracks that ended naturally or were intentionally paused
        if (this._intentionallyPaused) return;
        // Detect AudioContext suspended mid-playback (common on iOS)
        if (Howler.ctx && Howler.ctx.state !== 'running') {
            Howler.ctx.resume().catch(() => {});
        }
        if (this._audioCtx && this._audioCtx.state !== 'running') {
            this._audioCtx.resume().catch(() => {});
        }
        // Detect Howl stopped or destroyed while we think we're playing
        if (!this._currentHowl || this._currentHowl.state() === 'unloaded') {
            console.warn('\u266a Watchdog: Howl dead, rekindling');
            this._rekindleTrack();
            return;
        }
        // Only restart if the track has remaining duration (didn't end naturally)
        if (!this._currentHowl.playing()) {
            const dur = this._currentHowl.duration() || 0;
            const pos = this._currentHowl.seek() || 0;
            if (dur > 0 && pos < dur - 0.5) {
                // Track was interrupted mid-play — restart it
                try {
                    this._currentHowl.play();
                } catch {
                    this._rekindleTrack();
                }
            }
            // If pos >= dur - 0.5, the track ended naturally — let _onTrackEnded handle it
        }
    }

    next() {
        const q = this._getEffectiveQueue();
        if (q.length === 0) return;
        let newIdx = this._getEffectiveIndex() + 1;
        if (newIdx >= q.length) {
            if (this.repeatMode === 'off') { this.pause(); this._intentionallyPaused = true; return; }
            newIdx = 0;
            if (this.shuffleOn) this._reshuffleQueue();
        }
        // Re-read queue after potential reshuffle
        const currentQ = this._getEffectiveQueue();
        const nextTrackId = currentQ[newIdx];
        // Guard against playing the same track we're on (shuffle put it at 0)
        if (nextTrackId === this.currentTrackId && currentQ.length > 1) {
            newIdx = (newIdx + 1) % currentQ.length;
        }
        this._setEffectiveIndex(newIdx);
        this.playTrackById(currentQ[newIdx]);
    }

    prev() {
        const q = this._getEffectiveQueue();
        if (q.length === 0) return;
        if (this._currentHowl && this._currentHowl.seek() > 3) {
            this._currentHowl.seek(0);
            return;
        }
        let newIdx = this._getEffectiveIndex() - 1;
        if (newIdx < 0) newIdx = q.length - 1;
        this._setEffectiveIndex(newIdx);
        this.playTrackById(q[newIdx]);
    }

    seek(fraction) {
        if (this._currentHowl) {
            const dur = this._currentHowl.duration();
            if (dur) this._currentHowl.seek(fraction * dur);
        }
    }

    // ── Volume ──

    setVolume(vol) {
        this._volume = Math.max(0, Math.min(1, vol));
        // Apply volume through Web Audio GainNode (works on mobile) and Howler fallback
        this._applyVolume();
        localStorage.setItem('wf_music_volume', this._volume.toFixed(2));
        this._notify();
    }

    getVolume() {
        return this._volume;
    }

    setMuted(muted) {
        this.muted = muted;
        // Apply mute through GainNode and Howler
        this._applyVolume();
        // Also use Howler's mute for mobile reliability
        if (this._currentHowl) {
            this._currentHowl.mute(muted);
        }
        if (this._crossfadeHowl) {
            this._crossfadeHowl.mute(muted);
        }
        this._notify();
    }

    getCurrentTrack() {
        return this.currentTrackId ? this.plMgr.getTrack(this.currentTrackId) : null;
    }

    // ── Track ended ──

    _onTrackEnded() {
        if (this.repeatMode === 'one') {
            if (this._currentHowl) {
                this._currentHowl.seek(0);
                this._currentHowl.play();
            }
            return;
        }
        // If crossfade already handled the transition, don't double-skip (F1)
        if (this._crossfading) return;
        this.next();
    }

    // ── Crossfade ──

    _startCrossfade(nextTrackId) {
        const track = this.plMgr.getTrack(nextTrackId);
        if (!track || this._crossfading) return;
        this._crossfading = true;

        this._crossfadeHowl = new Howl({
            src: [track.file],
            html5: true,
            volume: 0,
            mute: this.muted,  // Respect mute state for mobile
            onload: () => {
                // Connect to Web Audio GainNode for mobile volume control
                this._connectHowlToGain(this._crossfadeHowl);
            },
        });

        this._crossfadeHowl.play();
        const dur = this._crossfadeDuration * 1000;

        // Fade out current, fade in next (only if not muted)
        if (this._currentHowl) {
            this._currentHowl.fade(this._volume, 0, dur);
        }
        if (!this.muted) {
            this._crossfadeHowl.fade(0, this._volume, dur);
        }

        setTimeout(() => {
            if (this._currentHowl) this._currentHowl.unload();
            this._currentHowl = this._crossfadeHowl;
            // Ensure proper state after crossfade completes
            if (this._currentHowl) {
                this._currentHowl.mute(this.muted);
                this._connectHowlToGain(this._currentHowl);
                this._applyVolume();
            }
            this._crossfadeHowl = null;
            this._crossfading = false;
            this.currentTrackId = nextTrackId;
            this._notify();
        }, dur);
    }

    _cancelCrossfade() {
        if (this._crossfadeHowl) {
            this._crossfadeHowl.unload();
            this._crossfadeHowl = null;
        }
        this._crossfading = false;
    }

    // ── Time Updates ──

    _startTimeUpdates() {
        this._stopTimeUpdates();
        this._timeUpdateInterval = setInterval(() => {
            if (!this._currentHowl || !this.playing) return;
            if (this.onTimeUpdate) {
                this.onTimeUpdate(
                    this._currentHowl.seek() || 0,
                    this._currentHowl.duration() || 0
                );
            }
            // Check for crossfade trigger (with VBR duration stability guard — F2)
            const dur = this._currentHowl.duration();
            const pos = this._currentHowl.seek();
            const now = Date.now();
            // Track duration stability: only crossfade if duration hasn't changed recently
            if (dur > 0) {
                if (!this._lastKnownDuration || Math.abs(dur - this._lastKnownDuration) > 0.5) {
                    this._lastKnownDuration = dur;
                    this._durationStableSince = now;
                }
            }
            const durationStable = this._durationStableSince && (now - this._durationStableSince > 5000);
            const minPlayTime = Math.max(15, this._crossfadeDuration * 5);
            if (dur > 0 && pos > 0
                && durationStable
                && pos >= minPlayTime
                && dur - pos < this._crossfadeDuration + 0.5
                && dur > this._crossfadeDuration * 2
                && this._getEffectiveQueue().length > 1) {
                const nextId = this._getNextTrackId();
                if (nextId && !this._crossfading) {
                    this._startCrossfade(nextId);
                }
            }
        }, 250);
    }

    _stopTimeUpdates() {
        if (this._timeUpdateInterval) {
            clearInterval(this._timeUpdateInterval);
            this._timeUpdateInterval = null;
        }
    }

    // ── Sleep Timer ──

    startSleepTimer(minutes) {
        this.clearSleepTimer();
        if (minutes <= 0) return;
        this.sleepTimerEnd = Date.now() + minutes * 60 * 1000;
        this.sleepTimerInterval = setInterval(() => {
            const remaining = this.sleepTimerEnd - Date.now();
            if (remaining <= 0) {
                this.clearSleepTimer();
                this.pause();
            } else if (this.onSleepTimerTick) {
                this.onSleepTimerTick(remaining);
            }
        }, 1000);
        this._notify();
    }

    setSleepTimer(minutes) {
        // Alias for backwards compatibility
        this.startSleepTimer(minutes);
    }

    clearSleepTimer() {
        if (this.sleepTimerInterval) {
            clearInterval(this.sleepTimerInterval);
            this.sleepTimerInterval = null;
        }
        this.sleepTimerEnd = 0;
        if (this.onSleepTimerTick) this.onSleepTimerTick(0);
        this._notify();
    }

    getSleepTimerRemaining() {
        if (!this.sleepTimerEnd) return 0;
        return Math.max(0, this.sleepTimerEnd - Date.now());
    }

    // ── State Persistence ──

    _saveMusicState() {
        try {
            localStorage.setItem('wf_music_state', JSON.stringify({
                trackId: this.currentTrackId,
                position: this._currentHowl ? this._currentHowl.seek() : 0,
                playlist: this.activePlaylist,
                playing: this.playing,
            }));
        } catch {}
    }

    _restoreMusicState() {
        try {
            const saved = JSON.parse(localStorage.getItem('wf_music_state'));
            if (!saved) return;
            if (saved.playlist) this.setActivePlaylist(saved.playlist);
            if (saved.trackId) {
                this.currentTrackId = saved.trackId;
                const q = this._getEffectiveQueue();
                const idx = q.indexOf(saved.trackId);
                if (idx >= 0) this._setEffectiveIndex(idx);
            }
            // Only clear the paused flag if we know the user was playing.
            // Don't force _intentionallyPaused=true for a missing/false saved.playing —
            // the constructor already reads the canonical value from wf_music_paused.
            if (saved.playing) {
                this._intentionallyPaused = false;
                localStorage.setItem('wf_music_paused', '0');
            }
        } catch {}
    }

    _notify() {
        if (this.onStateChange) {
            try { this.onStateChange(); } catch {}
        }
    }

    // ── Cleanup ──

    destroy() {
        this._stopTimeUpdates();
        this.clearSleepTimer();
        if (this._watchdogTimer) {
            clearInterval(this._watchdogTimer);
            this._watchdogTimer = null;
        }
        if (this._currentHowl) this._currentHowl.unload();
        if (this._crossfadeHowl) this._crossfadeHowl.unload();
    }

    // ── Compatibility: pass-through for old code that accesses .audio ──

    get audio() {
        const self = this;
        // Fake audio element interface for backwards compatibility
        return {
            get currentTime() { return self._currentHowl ? self._currentHowl.seek() : 0; },
            set currentTime(val) { if (self._currentHowl) self._currentHowl.seek(val); },
            get duration() { return self._currentHowl ? self._currentHowl.duration() : 0; },
            get paused() { return !self.playing; },
            get muted() { return self.muted; },
            get volume() { return self._volume; },
        };
    }
}
