/* ─────────────────────────────────────────────
   WorkFlow — reminder-card.js  (v1)
   Floating reminder popup card shown on trigger:
   • Appears in the bottom-right corner
   • Stacks multiple reminders (up to 4)
   • Plays the selected sound
   • Shows dismiss / snooze (5 min) buttons
   • Works both inside the app and as an OS-style
     Notification when the tab is hidden
   Depends on: sounds.js, db.js
───────────────────────────────────────────── */

'use strict';

const ReminderCard = (() => {

  const MAX_CARDS = 4;
  const CARD_CONTAINER_ID = 'reminder-card-container';

  /* ── Inject container once ────────────────────── */
  function ensureContainer() {
    if (document.getElementById(CARD_CONTAINER_ID)) return;
    const wrap = document.createElement('div');
    wrap.id = CARD_CONTAINER_ID;
    wrap.className = 'reminder-card-container';
    document.body.appendChild(wrap);
  }

  /* ── Format time string ──────────────────────── */
  function now() {
    return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  /* ── Create and show a reminder card ────────── */
  function show(reminder) {
    ensureContainer();
    const container = document.getElementById(CARD_CONTAINER_ID);

    // Limit stack
    const existing = container.querySelectorAll('.reminder-card');
    if (existing.length >= MAX_CARDS) {
      existing[0].remove(); // drop oldest
    }

    const card = document.createElement('div');
    card.className = 'reminder-card';
    card.setAttribute('role', 'alert');
    card.setAttribute('aria-live', 'assertive');

    const repeatBadge = reminder.repeat && reminder.repeat !== 'none'
      ? `<span class="rc-badge">↻ ${reminder.repeat}</span>`
      : '';

    card.innerHTML = `
      <div class="rc-header">
        <span class="rc-icon">⏰</span>
        <span class="rc-title">${escHtml(reminder.title)}</span>
        <button class="rc-close" title="Dismiss">✕</button>
      </div>
      <div class="rc-body">
        <span class="rc-time">${now()}</span>
        ${repeatBadge}
      </div>
      <div class="rc-actions">
        <button class="rc-snooze" title="Remind me in 5 minutes">⏱ Snooze 5 min</button>
        <button class="rc-dismiss">Dismiss</button>
      </div>
      <div class="rc-progress-bar"><div class="rc-progress-fill"></div></div>`;

    container.appendChild(card);

    // Animate in
    requestAnimationFrame(() => card.classList.add('rc-visible'));

    // Auto-dismiss after 12 seconds
    const AUTO_MS = 12000;
    const fill = card.querySelector('.rc-progress-fill');
    fill.style.transition = `width ${AUTO_MS}ms linear`;
    requestAnimationFrame(() => { fill.style.width = '0%'; });

    const autoTimer = setTimeout(() => dismiss(card), AUTO_MS);

    // Play sound
    if (typeof SoundEngine !== 'undefined') {
      SoundEngine.play().catch(() => {});
    }

    // OS Notification (when tab is hidden)
    if (document.hidden && Notification.permission === 'granted') {
      const n = new Notification('⏰ WorkFlow Reminder', {
        body: reminder.title,
        icon: 'icon-192.png',
        tag:  'workflow-reminder-' + reminder.id,
        requireInteraction: true,
      });
      n.onclick = () => { window.focus(); n.close(); };
    }

    /* ── Button events ── */
    card.querySelector('.rc-close').addEventListener('click', () => {
      clearTimeout(autoTimer);
      dismiss(card);
    });

    card.querySelector('.rc-dismiss').addEventListener('click', () => {
      clearTimeout(autoTimer);
      dismiss(card);
    });

    card.querySelector('.rc-snooze').addEventListener('click', async () => {
      clearTimeout(autoTimer);
      dismiss(card);
      // Create a one-shot snooze reminder
      const snoozeMinutes = 5;
      const snoozeAt = new Date(Date.now() + snoozeMinutes * 60 * 1000);
      const snoozeDate = snoozeAt.toISOString().slice(0, 10);
      const snoozeTime = snoozeAt.toTimeString().slice(0, 5);

      const snoozeReminder = {
        id:        'snz_' + Date.now().toString(36),
        title:     `⏱ ${reminder.title}`,
        date:      snoozeDate,
        time:      snoozeTime,
        repeat:    'none',
        fired:     false,
        createdAt: Date.now(),
        _snoozed:  true,
      };

      if (typeof DB !== 'undefined') {
        await DB.reminders.save(snoozeReminder);
        if (typeof State !== 'undefined') {
          State.reminders.unshift(snoozeReminder);
          if (typeof renderReminders === 'function') renderReminders();
        }
      }

      if (typeof showToast === 'function') showToast(`⏱ Snoozed for 5 minutes`);
    });
  }

  /* ── Dismiss animation ───────────────────────── */
  function dismiss(card) {
    card.classList.add('rc-dismissing');
    card.addEventListener('transitionend', () => card.remove(), { once: true });
    setTimeout(() => card.remove(), 500); // fallback
  }

  /* ── Dismiss all cards ───────────────────────── */
  function dismissAll() {
    const container = document.getElementById(CARD_CONTAINER_ID);
    if (!container) return;
    container.querySelectorAll('.reminder-card').forEach(dismiss);
  }

  /* ── HTML escape ──────────────────────────────── */
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── Init ────────────────────────────────────── */
  function init() {
    ensureContainer();
  }

  return { init, show, dismissAll };
})();