/* ─────────────────────────────────────────────
   WorkFlow — sounds.js  (v1)
   Reminder sound engine
   • Built-in synthesised tones (no server needed)
   • User-uploaded audio file support
   • Persists selection in IndexedDB via DB.prefs
   • Exposes: SoundEngine.play(), .init(), .getList(), .select(), .uploadFile()
───────────────────────────────────────────── */

'use strict';

const SoundEngine = (() => {

  /* ── Built-in sound definitions ─────────────
     Each has a `generate(ctx)` function that returns
     a function `play(ctx)` using WebAudio synthesis.
  ───────────────────────────────────────────── */
  const BUILTIN_SOUNDS = [
    {
      id: 'chime',
      name: '🔔 Chime',
      description: 'Soft bell chime',
      generate(ctx) {
        return () => {
          const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
          notes.forEach((freq, i) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.18;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.35, t + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
            osc.start(t);
            osc.stop(t + 0.9);
          });
        };
      }
    },
    {
      id: 'bell',
      name: '🛎 Bell',
      description: 'Classic desk bell',
      generate(ctx) {
        return () => {
          [880, 1109.73].forEach((freq, i) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.02;
            gain.gain.setValueAtTime(0.4, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
            osc.start(t);
            osc.stop(t + 1.4);
          });
        };
      }
    },
    {
      id: 'ping',
      name: '📣 Ping',
      description: 'Quick notification ping',
      generate(ctx) {
        return () => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1200, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.3);
          gain.gain.setValueAtTime(0.4, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.4);
        };
      }
    },
    {
      id: 'alert',
      name: '🚨 Alert',
      description: 'Urgent double beep',
      generate(ctx) {
        return () => {
          [0, 0.22].forEach(offset => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.value = 960;
            const t = ctx.currentTime + offset;
            gain.gain.setValueAtTime(0.25, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            osc.start(t);
            osc.stop(t + 0.2);
          });
        };
      }
    },
    {
      id: 'soft',
      name: '🌊 Soft',
      description: 'Gentle ambient tone',
      generate(ctx) {
        return () => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          const filter = ctx.createBiquadFilter();
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          filter.type = 'lowpass';
          filter.frequency.value = 800;
          osc.type = 'sine';
          osc.frequency.value = 440;
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.3);
          gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.9);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.6);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 1.7);
        };
      }
    },
    {
      id: 'xylophone',
      name: '🎵 Xylophone',
      description: 'Playful melody notes',
      generate(ctx) {
        return () => {
          const melody = [523.25, 659.25, 783.99, 659.25, 880];
          melody.forEach((freq, i) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.13;
            gain.gain.setValueAtTime(0.3, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.start(t);
            osc.stop(t + 0.5);
          });
        };
      }
    },
    {
      id: 'digital',
      name: '💾 Digital',
      description: 'Retro digital blip',
      generate(ctx) {
        return () => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'square';
          osc.frequency.setValueAtTime(440, ctx.currentTime);
          osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
          osc.frequency.setValueAtTime(440, ctx.currentTime + 0.2);
          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.setValueAtTime(0.2, ctx.currentTime + 0.29);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.35);
        };
      }
    },
    {
      id: 'none',
      name: '🔇 Silent',
      description: 'No sound',
      generate() { return () => {}; }
    },
  ];

  /* ── State ──────────────────────────────────── */
  let _selectedId   = 'chime';     // active sound id (builtin or 'custom_*')
  let _audioCtx     = null;
  let _customSounds = {};          // id → { name, buffer: AudioBuffer }
  let _volume       = 0.8;

  /* ── AudioContext (lazy) ─────────────────────── */
  function getCtx() {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }

  /* ── Play the currently selected sound ──────── */
  async function play(volumeOverride) {
    try {
      const ctx = getCtx();
      const vol = volumeOverride !== undefined ? volumeOverride : _volume;

      if (_selectedId.startsWith('custom_')) {
        const custom = _customSounds[_selectedId];
        if (!custom) return;
        const src  = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = custom.buffer;
        src.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = vol;
        src.start();
        return;
      }

      const def = BUILTIN_SOUNDS.find(s => s.id === _selectedId);
      if (!def) return;

      // Wrap in a GainNode for volume control
      const masterGain = ctx.createGain();
      masterGain.gain.value = vol;
      masterGain.connect(ctx.destination);

      // Temporarily redirect destination via patcher
      const origDest = ctx.destination;
      // We call generate() which returns a play() fn, but we need to patch gain
      // Simpler: create a wrapper ctx-like that routes through masterGain
      const patchedCtx = new Proxy(ctx, {
        get(target, prop) {
          if (prop === 'destination') return masterGain;
          const val = target[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
      def.generate(patchedCtx)();

    } catch (e) {
      console.warn('[SoundEngine] play error:', e);
    }
  }

  /* ── Preview a specific sound by id ─────────── */
  async function preview(id, vol = 0.5) {
    const prev = _selectedId;
    _selectedId = id;
    await play(vol);
    _selectedId = prev;
  }

  /* ── Select a sound and persist ─────────────── */
  async function select(id) {
    _selectedId = id;
    if (typeof DB !== 'undefined') {
      await DB.prefs.set('reminderSound', id);
    }
  }

  /* ── Upload a user audio file ────────────────── */
  async function uploadFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const ctx    = getCtx();
          const buffer = await ctx.decodeAudioData(e.target.result.slice(0));
          const id     = 'custom_' + Date.now().toString(36);
          _customSounds[id] = { name: file.name.replace(/\.[^.]+$/, ''), buffer };

          // Persist metadata in DB (can't store AudioBuffer, store base64 instead)
          if (typeof DB !== 'undefined') {
            const b64 = arrayBufferToBase64(e.target.result);
            await DB.prefs.set('sound_file_' + id, JSON.stringify({ name: _customSounds[id].name, b64, id }));
            // Save list of custom sound IDs
            const existing = await DB.prefs.get('custom_sound_ids') || [];
            existing.push(id);
            await DB.prefs.set('custom_sound_ids', existing);
          }
          resolve({ id, name: _customSounds[id].name });
        } catch (err) {
          reject(new Error('Could not decode audio file. Supported: MP3, WAV, OGG, M4A'));
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsArrayBuffer(file);
    });
  }

  /* ── Delete a custom sound ───────────────────── */
  async function deleteCustomSound(id) {
    delete _customSounds[id];
    if (typeof DB !== 'undefined') {
      await DB.prefs.set('sound_file_' + id, null);
      const existing = (await DB.prefs.get('custom_sound_ids') || []).filter(x => x !== id);
      await DB.prefs.set('custom_sound_ids', existing);
    }
    if (_selectedId === id) {
      await select('chime');
    }
  }

  /* ── Set volume (0–1) ────────────────────────── */
  async function setVolume(v) {
    _volume = Math.min(1, Math.max(0, v));
    if (typeof DB !== 'undefined') {
      await DB.prefs.set('reminderVolume', _volume);
    }
  }

  /* ── Get full list (builtin + custom) ────────── */
  function getList() {
    const custom = Object.entries(_customSounds).map(([id, c]) => ({
      id,
      name: '📁 ' + c.name,
      description: 'Your file',
      isCustom: true,
    }));
    return [...BUILTIN_SOUNDS.map(s => ({ ...s, isCustom: false })), ...custom];
  }

  function getSelected() { return _selectedId; }
  function getVolume()   { return _volume; }

  /* ── Helpers ────────────────────────────────── */
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ToArrayBuffer(b64) {
    const bin  = atob(b64);
    const buf  = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    return buf;
  }

  /* ── Init: load persisted prefs + custom files ─ */
  async function init() {
    if (typeof DB === 'undefined') return;
    const saved  = await DB.prefs.get('reminderSound');
    const savedV = await DB.prefs.get('reminderVolume');
    if (savedV !== null && savedV !== undefined) _volume = savedV;
    if (saved)  _selectedId = saved;

    // Restore custom uploaded sounds
    const ids = await DB.prefs.get('custom_sound_ids');
    if (Array.isArray(ids)) {
      for (const id of ids) {
        try {
          const raw = await DB.prefs.get('sound_file_' + id);
          if (!raw) continue;
          const { name, b64 } = JSON.parse(raw);
          const ctx    = getCtx();
          const buffer = await ctx.decodeAudioData(base64ToArrayBuffer(b64));
          _customSounds[id] = { name, buffer };
        } catch (e) {
          console.warn('[SoundEngine] Could not restore custom sound', id, e);
        }
      }
    }
  }

  return { init, play, preview, select, uploadFile, deleteCustomSound, setVolume, getList, getSelected, getVolume };
})();