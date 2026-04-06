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
        this.muted = false;
        this._volume = parseFloat(localStorage.getItem('wf_music_volume') || '0.7');
        this.playing = false;
        this.currentTrackId = null;
        this.activePlaylist = '__default';
        this.queue = [];
        this.queueIndex = -1;

        // Current Howl instance
        this._currentHowl = null;

        // Shuffle & repeat
        this.shuffleOn = localStorage.getItem('wf_music_shuffle') === '1';
        this._shuffledQueue = [];
        this._shuffledIndex = -1;
        this.repeatMode = localStorage.getItem('wf_music_repeat') || 'all';

        // Crossfade
        this._crossfadeDuration = 1.5;
        this._crossfadeHowl = null;
        this._crossfading = false;

        // Sleep timer
        this.sleepTimerEnd = 0;
        this.sleepTimerInterval = null;
        this.onSleepTimerTick = null;

        // Callbacks
        this.onStateChange = null;
        this.onTimeUpdate = null;

        // Time update interval
        this._timeUpdateInterval = null;

        this._buildQueue();
        this._restoreMusicState();
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
        if (this.currentTrackId) {
            const idx = this._shuffledQueue.indexOf(this.currentTrackId);
            if (idx > 0) {
                [this._shuffledQueue[0], this._shuffledQueue[idx]] = [this._shuffledQueue[idx], this._shuffledQueue[0]];
            }
            this._shuffledIndex = 0;
        }
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

        // Stop current track
        if (this._currentHowl) {
            this._currentHowl.unload();
            this._currentHowl = null;
        }

        // Create new Howl for the track
        this._currentHowl = new Howl({
            src: [track.file],
            html5: true,  // Streaming for music (doesn't load entire file)
            volume: this.muted ? 0 : this._volume,
            onend: () => this._onTrackEnded(),
            onloaderror: (id, err) => {
                console.warn('♪ Howler load error on track', trackId, err);
                if (this.playing) this.next();
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
        this._startTimeUpdates();
        this._saveMusicState();
        this._notify();
    }

    play() {
        if (this.currentTrackId && this._currentHowl) {
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
        if (this._currentHowl) this._currentHowl.pause();
        this._cancelCrossfade();
        this.playing = false;
        this._stopTimeUpdates();
        this._saveMusicState();
        localStorage.setItem('wf_music_paused', '1');
        this._notify();
    }

    toggle() {
        this.playing ? this.pause() : this.play();
    }

    resumePlayback() {
        if (!this.playing || !this.currentTrackId) return;
        if (Howler.ctx?.state === 'suspended') Howler.ctx.resume();
        if (this._currentHowl && !this._currentHowl.playing()) {
            this._currentHowl.play();
        }
    }

    next() {
        const q = this._getEffectiveQueue();
        if (q.length === 0) return;
        let newIdx = this._getEffectiveIndex() + 1;
        if (newIdx >= q.length) {
            if (this.repeatMode === 'off') { this.pause(); return; }
            newIdx = 0;
            if (this.shuffleOn) this._reshuffleQueue();
        }
        this._setEffectiveIndex(newIdx);
        this.playTrackById(q[newIdx]);
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
        if (this._currentHowl) {
            this._currentHowl.volume(this.muted ? 0 : this._volume);
        }
        if (this._crossfadeHowl) {
            this._crossfadeHowl.volume(this.muted ? 0 : this._volume);
        }
        localStorage.setItem('wf_music_volume', this._volume.toFixed(2));
        this._notify();
    }

    getVolume() {
        return this._volume;
    }

    setMuted(muted) {
        this.muted = muted;
        if (this._currentHowl) this._currentHowl.volume(muted ? 0 : this._volume);
        if (this._crossfadeHowl) this._crossfadeHowl.volume(muted ? 0 : this._volume);
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
        });

        this._crossfadeHowl.play();
        const dur = this._crossfadeDuration * 1000;

        // Fade out current, fade in next
        if (this._currentHowl) {
            this._currentHowl.fade(this._volume, 0, dur);
        }
        this._crossfadeHowl.fade(0, this._volume, dur);

        setTimeout(() => {
            if (this._currentHowl) this._currentHowl.unload();
            this._currentHowl = this._crossfadeHowl;
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
            // Check for crossfade trigger
            const dur = this._currentHowl.duration();
            const pos = this._currentHowl.seek();
            if (dur > 0 && pos > 0 && dur - pos < this._crossfadeDuration + 0.5) {
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

    setSleepTimer(minutes) {
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
    }

    clearSleepTimer() {
        if (this.sleepTimerInterval) {
            clearInterval(this.sleepTimerInterval);
            this.sleepTimerInterval = null;
        }
        this.sleepTimerEnd = 0;
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
        if (this._currentHowl) this._currentHowl.unload();
        if (this._crossfadeHowl) this._crossfadeHowl.unload();
    }

    // ── Compatibility: pass-through for old code that accesses .audio ──

    get audio() {
        // Fake audio element interface for backwards compatibility
        return {
            currentTime: this._currentHowl ? this._currentHowl.seek() : 0,
            duration: this._currentHowl ? this._currentHowl.duration() : 0,
            paused: !this.playing,
            muted: this.muted,
            volume: this._volume,
        };
    }
}
