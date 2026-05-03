/* ─────────────────────────────────────────────
   WorkFlow — sound-settings.js  (v1)
   Manages the Sound Settings modal UI:
   • Lists all built-in + custom sounds
   • Preview on hover/click
   • Upload user audio files
   • Volume slider
   • Injects modal HTML into the page
   Depends on: sounds.js, db.js
───────────────────────────────────────────── */

'use strict';

const SoundSettings = (() => {

  /* ── Inject modal HTML once ──────────────────── */
  function injectModal() {
    if (document.getElementById('sound-modal')) return;
    const html = `
    <!-- ── SOUND SETTINGS MODAL ── -->
    <div class="modal-backdrop hidden" id="sound-modal">
      <div class="modal modal-wide sound-modal-inner">
        <div class="modal-header">
          <span class="modal-title">🔔 Reminder Sound Settings</span>
          <button class="modal-close" id="sound-modal-close">✕</button>
        </div>

        <!-- Volume -->
        <div class="sound-volume-row">
          <label class="notes-label" for="sound-volume-slider">
            <span id="sound-vol-icon">🔊</span> Volume
          </label>
          <div class="volume-slider-wrap">
            <input type="range" id="sound-volume-slider" min="0" max="100" value="80" step="1" class="volume-slider" />
            <span class="volume-value" id="sound-vol-label">80%</span>
          </div>
        </div>

        <!-- Built-in sounds list -->
        <div class="sound-section-title">Built-in Sounds</div>
        <ul class="sound-list" id="builtin-sound-list"></ul>

        <!-- Custom sounds -->
        <div class="sound-section-title" style="margin-top:18px">
          Your Sounds
          <button class="sound-upload-btn" id="sound-upload-trigger" title="Upload MP3/WAV/OGG/M4A">
            ＋ Upload file
          </button>
          <input type="file" id="sound-file-input" accept="audio/*" style="display:none" />
        </div>
        <div class="sound-upload-hint">Supports MP3, WAV, OGG, M4A · Max ~10 MB</div>
        <ul class="sound-list" id="custom-sound-list">
          <li class="sound-empty-hint" id="custom-sound-empty">No custom sounds yet — upload one above.</li>
        </ul>

        <div class="modal-actions" style="margin-top:20px">
          <button class="add-btn" id="sound-modal-done">Done</button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  /* ── Inject trigger button into header ───────── */
  function injectTriggerButton() {
    if (document.getElementById('sound-settings-btn')) return;
    const headerActions = document.querySelector('.header-actions');
    if (!headerActions) return;
    const btn = document.createElement('button');
    btn.className   = 'icon-btn';
    btn.id          = 'sound-settings-btn';
    btn.title       = 'Reminder sounds';
    btn.textContent = '🎵';
    // Insert before notify-toggle
    const notif = document.getElementById('notify-toggle');
    if (notif) headerActions.insertBefore(btn, notif);
    else headerActions.prepend(btn);
  }

  /* ── Render sound list ───────────────────────── */
  function renderSoundList() {
    const sounds   = SoundEngine.getList();
    const selected = SoundEngine.getSelected();

    const builtin  = sounds.filter(s => !s.isCustom);
    const custom   = sounds.filter(s =>  s.isCustom);

    // Built-in
    document.getElementById('builtin-sound-list').innerHTML = builtin.map(s => `
      <li class="sound-item ${s.id === selected ? 'selected' : ''}" data-id="${s.id}">
        <div class="sound-radio">${s.id === selected ? '◉' : '○'}</div>
        <div class="sound-info">
          <div class="sound-name">${s.name}</div>
          <div class="sound-desc">${s.description}</div>
        </div>
        ${s.id !== 'none' ? `<button class="sound-preview-btn" data-id="${s.id}" title="Preview">▶</button>` : ''}
      </li>`).join('');

    // Custom
    const emptyEl = document.getElementById('custom-sound-empty');
    const customList = document.getElementById('custom-sound-list');

    if (!custom.length) {
      emptyEl.style.display = '';
      // Remove all li except empty hint
      customList.querySelectorAll('.sound-item').forEach(el => el.remove());
    } else {
      emptyEl.style.display = 'none';
      customList.querySelectorAll('.sound-item').forEach(el => el.remove());
      custom.forEach(s => {
        const li = document.createElement('li');
        li.className = `sound-item ${s.id === selected ? 'selected' : ''}`;
        li.dataset.id = s.id;
        li.innerHTML = `
          <div class="sound-radio">${s.id === selected ? '◉' : '○'}</div>
          <div class="sound-info">
            <div class="sound-name">${s.name}</div>
            <div class="sound-desc">Your uploaded file</div>
          </div>
          <button class="sound-preview-btn" data-id="${s.id}" title="Preview">▶</button>
          <button class="sound-delete-btn" data-id="${s.id}" title="Delete">✕</button>`;
        customList.insertBefore(li, emptyEl);
      });
    }

    // Update volume
    const vol = Math.round(SoundEngine.getVolume() * 100);
    document.getElementById('sound-volume-slider').value = vol;
    document.getElementById('sound-vol-label').textContent = vol + '%';
    updateVolIcon(vol);
  }

  function updateVolIcon(vol) {
    const icon = vol === 0 ? '🔇' : vol < 40 ? '🔉' : '🔊';
    const el = document.getElementById('sound-vol-icon');
    if (el) el.textContent = icon;
  }

  /* ── Bind all modal events ───────────────────── */
  function bindModalEvents() {
    // Select sound (click on row)
    document.getElementById('builtin-sound-list').addEventListener('click', async e => {
      const item = e.target.closest('.sound-item');
      if (!item) return;
      if (e.target.closest('.sound-preview-btn')) return; // handled below
      await SoundEngine.select(item.dataset.id);
      renderSoundList();
      if (item.dataset.id !== 'none') SoundEngine.play();
    });

    document.getElementById('custom-sound-list').addEventListener('click', async e => {
      const item = e.target.closest('.sound-item');
      if (!item) return;
      if (e.target.closest('.sound-preview-btn')) return;
      if (e.target.closest('.sound-delete-btn')) {
        await SoundEngine.deleteCustomSound(item.dataset.id);
        renderSoundList();
        if (typeof showToast === 'function') showToast('🗑 Custom sound deleted');
        return;
      }
      await SoundEngine.select(item.dataset.id);
      renderSoundList();
      SoundEngine.play();
    });

    // Preview buttons
    document.addEventListener('click', e => {
      const btn = e.target.closest('.sound-preview-btn');
      if (btn) SoundEngine.preview(btn.dataset.id);
    });

    // Volume slider
    document.getElementById('sound-volume-slider').addEventListener('input', e => {
      const v = parseInt(e.target.value) / 100;
      SoundEngine.setVolume(v);
      document.getElementById('sound-vol-label').textContent = Math.round(v * 100) + '%';
      updateVolIcon(Math.round(v * 100));
    });

    // Upload trigger
    document.getElementById('sound-upload-trigger').addEventListener('click', () => {
      document.getElementById('sound-file-input').click();
    });

    document.getElementById('sound-file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        if (typeof showToast === 'function') showToast('⏳ Loading audio file…');
        const result = await SoundEngine.uploadFile(file);
        await SoundEngine.select(result.id);
        renderSoundList();
        SoundEngine.play();
        if (typeof showToast === 'function') showToast(`✅ "${result.name}" added`);
      } catch (err) {
        if (typeof showToast === 'function') showToast('❌ ' + err.message);
        else alert(err.message);
      }
      e.target.value = '';
    });

    // Close
    document.getElementById('sound-modal-close').addEventListener('click', closeModal);
    document.getElementById('sound-modal-done').addEventListener('click', closeModal);
    document.getElementById('sound-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('sound-modal')) closeModal();
    });

    // Trigger button
    document.getElementById('sound-settings-btn').addEventListener('click', openModal);
  }

  function openModal() {
    renderSoundList();
    document.getElementById('sound-modal').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('sound-modal').classList.add('hidden');
  }

  /* ── Init ────────────────────────────────────── */
  async function init() {
    injectModal();
    injectTriggerButton();
    await SoundEngine.init();
    bindModalEvents();
  }

  return { init, openModal, closeModal };
})();