/* ─────────────────────────────────────────────
   WorkFlow — app.js  (v3)
   All upgrades applied:
   ✔  Task editing (title, priority, category, date, time, recur)
   ✔  All-tasks view grouped by date
   ✔  Search/filter by text (today + all views)
   ✔  sortOrder optimised — only saves moved tasks
   ✔  Reminder repeat reset — daily/weekly re-arm correctly
   ✔  Reminder poll catchup — fires missed reminders
   ✔  db.js in sw precache (sw.js)
   ✔  Schedule view date navigation (prev/next day)
   ✔  Data export (JSON download)
   ✔  Data import (JSON upload)
   ✔  Weekly stats — added vs completed dual bar
   ✔  Notification permission vs pref reconciliation
   ✔  Theme icon syncs with OS prefers-color-scheme
   ✔  Keyboard shortcuts aligned with nav order (1-5)
   ✔  Rollover marks original as done instead of duplicate
   ✔  recurParentId field prevents duplicate recurring tasks
   ✔  Task date picker in add form
───────────────────────────────────────────── */

'use strict';

// ── State ─────────────────────────────────────
const State = {
  tasks:        [],
  reminders:    [],
  filter:       'all',
  filterAll:    'all',
  view:         'today',
  theme:        'auto',
  notifEnabled: false,
  openTaskId:   null,
  searchQuery:  '',
  searchQueryAll: '',
  schedDate:    null,   // currently viewed schedule date
};

// ── Utils ─────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const todayStr = () => new Date().toISOString().slice(0, 10);
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

function offsetDate(base, days) {
  const d = new Date(base + 'T00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const d = new Date(); d.setHours(+h, +m);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(dateStr) {
  const today = todayStr();
  const tmrw  = tomorrowStr();
  const yest  = offsetDate(today, -1);
  if (dateStr === today) return 'Today';
  if (dateStr === tmrw)  return 'Tomorrow';
  if (dateStr === yest)  return 'Yesterday';
  return new Date(dateStr + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

function formatDateTime(dateStr, timeStr) {
  const parts = [];
  if (dateStr) parts.push(new Date(dateStr + 'T00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }));
  if (timeStr) parts.push(formatTime(timeStr));
  return parts.join(' · ');
}

function weekRangeStr() {
  const d   = new Date();
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(mon); x.setDate(mon.getDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

// ── Toast ─────────────────────────────────────
let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Theme ─────────────────────────────────────
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const effective = State.theme === 'auto' ? getSystemTheme() : State.theme;
  document.documentElement.setAttribute('data-theme', effective === 'light' ? 'light' : '');
}

function syncThemeIcon() {
  const icons = { auto: '◐', light: '☀', dark: '☾' };
  document.getElementById('theme-toggle').textContent = icons[State.theme] || '◐';
}

function toggleTheme() {
  const cycle = { auto: 'light', light: 'dark', dark: 'auto' };
  State.theme = cycle[State.theme] || 'auto';
  DB.prefs.set('theme', State.theme);
  applyTheme();
  syncThemeIcon();
  showToast(`Theme: ${State.theme}`);
}

// ── Notifications ─────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

function fireNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'icon-192.png' });
  }
}

// FIX: reconcile stored pref with actual browser permission on load
function reconcileNotifState() {
  if (State.notifEnabled && Notification.permission !== 'granted') {
    State.notifEnabled = false;
    DB.prefs.set('notifEnabled', false);
  }
  document.getElementById('notify-toggle').textContent = State.notifEnabled ? '🔔' : '🔕';
}

// ── Task CRUD ─────────────────────────────────
async function addTask({ title, priority, category, time, recur, date }) {
  const task = {
    id:           uid(),
    title,
    priority,
    category,
    time,
    recur:        recur || 'none',
    done:         false,
    date:         date || todayStr(),
    notes:        '',
    subtasks:     [],
    sortOrder:    0,
    createdAt:    Date.now(),
    recurParentId: null,
  };
  await DB.tasks.save(task);
  State.tasks.unshift(task);
  renderCurrentView();
  updateStats();
  showToast('✓ Task added');
  if (time && State.notifEnabled) scheduleTaskNotif(task);
}

async function toggleTask(id) {
  const t = State.tasks.find(t => t.id === id);
  if (!t) return;
  t.done = !t.done;
  await DB.tasks.save(t);
  renderCurrentView();
  updateStats();
  if (t.done) showToast('✅ Marked complete');
}

async function deleteTask(id) {
  State.tasks = State.tasks.filter(t => t.id !== id);
  await DB.tasks.delete(id);
  renderCurrentView();
  updateStats();
  showToast('🗑 Task deleted');
}

function scheduleTaskNotif(task) {
  if (!task.time || task.date !== todayStr()) return;
  const [h, m] = task.time.split(':').map(Number);
  const target  = new Date(); target.setHours(h, m, 0, 0);
  const diff    = target - Date.now();
  if (diff > 0) {
    setTimeout(() => {
      fireNotification('📋 Task Due', task.title);
      showToast(`📋 Due now: ${task.title}`);
    }, diff);
  }
}

// ── Recurring task generator ──────────────────
async function generateRecurringTasks() {
  const today    = todayStr();
  const allTasks = await DB.tasks.getAll();
  State.tasks    = allTasks;

  // Find templates: recurring tasks that aren't children of another
  const templates = allTasks.filter(t => t.recur && t.recur !== 'none' && !t.recurParentId);

  for (const tmpl of templates) {
    // FIX: use recurParentId to detect duplicates, not title matching
    const alreadyToday = allTasks.some(
      t => t.recurParentId === tmpl.id && t.date === today
    );
    if (!alreadyToday && tmpl.date !== today) {
      const newTask = {
        ...tmpl,
        id:            uid(),
        done:          false,
        date:          today,
        createdAt:     Date.now(),
        subtasks:      [],
        recurParentId: tmpl.id,   // link back to template
      };
      await DB.tasks.save(newTask);
      State.tasks.unshift(newTask);
    }
  }
}

// ── Reminder CRUD ─────────────────────────────
async function addReminder({ title, date, time, repeat }) {
  const r = { id: uid(), title, date, time, repeat, fired: false, createdAt: Date.now() };
  await DB.reminders.save(r);
  State.reminders.unshift(r);
  renderReminders();
  showToast('🔔 Reminder set');
}

async function deleteReminder(id) {
  State.reminders = State.reminders.filter(r => r.id !== id);
  await DB.reminders.delete(id);
  renderReminders();
  showToast('🗑 Reminder deleted');
}

// Reminder poll loop
let _reminderLoop;
let _lastPollAt = Date.now();

function startReminderLoop() {
  clearInterval(_reminderLoop);
  _reminderLoop = setInterval(checkReminders, 30_000);
  checkReminders();
}

async function checkReminders() {
  const now     = Date.now();
  const since   = _lastPollAt;
  _lastPollAt   = now;

  for (const r of State.reminders) {
    if (r.fired && r.repeat === 'none') continue;
    const dt   = new Date((r.date || todayStr()) + 'T' + (r.time || '00:00'));
    const dueAt = dt.getTime();

    // FIX: catch reminders that fired between polls (handles tab sleep/background)
    const wasMissed = dueAt >= since && dueAt <= now;

    if (wasMissed && !r.fired) {
      r.fired = true;
      await DB.reminders.save(r);

      // ── NEW: Show floating reminder card with sound ──
      if (typeof ReminderCard !== 'undefined') {
        ReminderCard.show(r);   // card handles sound + OS notification internally
      } else {
        // Fallback to original behaviour
        fireNotification('⏰ Reminder', r.title);
        showToast(`⏰ ${r.title}`);
        if (typeof SoundEngine !== 'undefined') SoundEngine.play();
      }

      // FIX: advance repeating reminders instead of leaving them fired forever
      if (r.repeat === 'daily') {
        r.date  = offsetDate(r.date || todayStr(), 1);
        r.fired = false;
        await DB.reminders.save(r);
      } else if (r.repeat === 'weekly') {
        r.date  = offsetDate(r.date || todayStr(), 7);
        r.fired = false;
        await DB.reminders.save(r);
      }

      renderReminders();
    }
  }
}

// ── Export / Import ───────────────────────────
async function exportData() {
  const tasks     = await DB.tasks.getAll();
  const reminders = await DB.reminders.getAll();
  const prefs     = await DB.prefs.getAll();
  const payload   = JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), tasks, reminders, prefs }, null, 2);
  const blob      = new Blob([payload], { type: 'application/json' });
  const url       = URL.createObjectURL(blob);
  const a         = document.createElement('a');
  a.href          = url;
  a.download      = `workflow-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📥 Data exported');
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.tasks || !Array.isArray(data.tasks)) throw new Error('Invalid file');

    for (const t of data.tasks)     await DB.tasks.save(t);
    for (const r of (data.reminders || [])) await DB.reminders.save(r);

    // Reload everything
    State.tasks     = await DB.tasks.getAll();
    State.reminders = await DB.reminders.getAll();
    State.tasks.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || b.createdAt - a.createdAt);

    renderCurrentView();
    renderReminders();
    updateStats();
    showToast(`✅ Imported ${data.tasks.length} tasks`);
  } catch (e) {
    showToast('❌ Import failed — invalid file');
    console.error('[Import]', e);
  }
}

// ── Render helpers ────────────────────────────
const escHtml   = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const capitalize = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const priorityLabel = p => ({ high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' }[p] || p);
const catIcon = c => ({ work: '💼', personal: '🏠', meeting: '🤝', learning: '📚' }[c] || '📌');

// ── Filtered task getters ─────────────────────
function applyFilter(list, filter) {
  switch (filter) {
    case 'high':   return list.filter(t => t.priority === 'high');
    case 'medium': return list.filter(t => t.priority === 'medium');
    case 'low':    return list.filter(t => t.priority === 'low');
    case 'done':   return list.filter(t => t.done);
    default:       return list;
  }
}

function applySearch(list, query) {
  if (!query) return list;
  const q = query.toLowerCase();
  return list.filter(t => t.title.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q));
}

function getFilteredTasks() {
  let list = State.view === 'today'
    ? State.tasks.filter(t => t.date === todayStr())
    : State.tasks;
  list = applyFilter(list, State.filter);
  list = applySearch(list, State.searchQuery);
  return list;
}

function getFilteredAllTasks() {
  let list = applyFilter(State.tasks, State.filterAll);
  list = applySearch(list, State.searchQueryAll);
  return list;
}

// ── Task item HTML builder ────────────────────
function taskItemHTML(t) {
  const subDone  = (t.subtasks || []).filter(s => s.done).length;
  const subTotal = (t.subtasks || []).length;
  const subBar   = subTotal > 0
    ? `<div class="sub-progress-bar"><div class="sub-progress-fill" style="width:${Math.round(subDone / subTotal * 100)}%"></div></div>`
    : '';
  const dateLabel = t.date !== todayStr() ? `<span class="badge badge-date">📅 ${formatDateLabel(t.date)}</span>` : '';
  return `
  <li class="task-item ${t.done ? 'done' : ''}" data-id="${t.id}" data-priority="${t.priority}" draggable="true">
    <div class="drag-handle" title="Drag to reorder">⠿</div>
    <div class="task-check" data-action="toggle">${t.done ? '✓' : ''}</div>
    <div class="task-body" data-action="open-detail">
      <div class="task-title">${escHtml(t.title)}</div>
      <div class="task-badges">
        <span class="badge badge-${t.priority}">${priorityLabel(t.priority)}</span>
        <span class="badge badge-cat">${catIcon(t.category)} ${capitalize(t.category)}</span>
        ${t.time ? `<span class="badge badge-time">⏰ ${formatTime(t.time)}</span>` : ''}
        ${t.recur && t.recur !== 'none' ? `<span class="badge badge-recur">↻ ${capitalize(t.recur)}</span>` : ''}
        ${subTotal > 0 ? `<span class="badge badge-sub">${subDone}/${subTotal} steps</span>` : ''}
        ${dateLabel}
      </div>
      ${subBar}
    </div>
    <div class="task-actions">
      <button class="task-action-btn" data-action="open-detail" title="Edit / subtasks">✎</button>
      <button class="task-action-btn del" data-action="delete" title="Delete">✕</button>
    </div>
  </li>`;
}

// ── Render Today / All Tasks (shared list area) ─
function renderTasks() {
  const list  = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');
  const tasks = getFilteredTasks();

  if (!tasks.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = tasks.map(taskItemHTML).join('');
  initDragDrop();
}

// ── Render All-Tasks view (grouped by date) ───
function renderAllTasks() {
  const container = document.getElementById('all-tasks-container');
  const emptyEl   = document.getElementById('all-empty-state');
  const tasks     = getFilteredAllTasks();

  if (!tasks.length) { container.innerHTML = ''; emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  // Group by date, sorted most-recent first
  const groups = {};
  for (const t of tasks) {
    if (!groups[t.date]) groups[t.date] = [];
    groups[t.date].push(t);
  }
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  const today = todayStr();

  container.innerHTML = sortedDates.map(date => {
    const label    = formatDateLabel(date);
    const isToday  = date === today;
    const count    = groups[date].length;
    const doneCount = groups[date].filter(t => t.done).length;
    return `
      <div class="date-group">
        <div class="date-group-header ${isToday ? 'today-group' : ''}">
          ${label}
          <span class="group-count">${doneCount}/${count} done</span>
        </div>
        <ul class="task-list">${groups[date].map(taskItemHTML).join('')}</ul>
      </div>`;
  }).join('');

  // Bind events for all task items in all-tasks view
  container.querySelectorAll('.task-list').forEach(list => {
    list.addEventListener('click', e => {
      const item   = e.target.closest('.task-item');
      if (!item) return;
      const id     = item.dataset.id;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'toggle')      toggleTask(id);
      if (action === 'delete')      deleteTask(id);
      if (action === 'open-detail') openSubtaskModal(id);
    });
  });
}

// ── Render Reminders ──────────────────────────
function renderReminders() {
  const list  = document.getElementById('reminder-list');
  const empty = document.getElementById('reminder-empty');
  if (!State.reminders.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = State.reminders.map(r => `
    <li class="reminder-item ${r.fired && r.repeat === 'none' ? 'fired' : ''}" data-id="${r.id}">
      <span class="reminder-bell">🔔</span>
      <div class="reminder-body">
        <div class="reminder-title">${escHtml(r.title)}</div>
        <div class="reminder-meta">${formatDateTime(r.date, r.time)}${r.repeat !== 'none' ? ` · ↻ ${capitalize(r.repeat)}` : ''}${r.fired && r.repeat === 'none' ? ' · ✅' : ''}</div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn del" data-action="del-reminder">✕</button>
      </div>
    </li>`).join('');
}

// ── Stats & sidebar counts ─────────────────────
function updateStats() {
  const today = State.tasks.filter(t => t.date === todayStr());
  document.getElementById('stat-done').textContent    = today.filter(t => t.done).length;
  document.getElementById('stat-pending').textContent = today.filter(t => !t.done).length;
}

// ── Weekly Stats View ─────────────────────────
function renderWeeklyStats() {
  const days  = weekRangeStr();
  const tasks = State.tasks;

  const allDone   = tasks.filter(t => t.done).length;
  const thisWeek  = tasks.filter(t => days.includes(t.date));
  const weekDone  = thisWeek.filter(t => t.done).length;
  const weekTotal = thisWeek.length;
  const rate      = weekTotal ? Math.round(weekDone / weekTotal * 100) : 0;

  document.getElementById('stats-grid').innerHTML = `
    <div class="metric-card"><span class="metric-num">${weekDone}</span><span class="metric-label">Done this week</span></div>
    <div class="metric-card"><span class="metric-num">${weekTotal}</span><span class="metric-label">Added this week</span></div>
    <div class="metric-card"><span class="metric-num">${rate}%</span><span class="metric-label">Completion rate</span></div>
    <div class="metric-card"><span class="metric-num">${allDone}</span><span class="metric-label">All-time done</span></div>
  `;

  // Dual bar chart: completed (accent) + added (border color)
  const maxTotal = Math.max(1, ...days.map(d => tasks.filter(t => t.date === d).length));
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  document.getElementById('bar-chart').innerHTML = days.map((d, i) => {
    const done    = tasks.filter(t => t.date === d && t.done).length;
    const total   = tasks.filter(t => t.date === d).length;
    const pctDone = Math.round(done  / maxTotal * 100);
    const pctAdd  = Math.round(total / maxTotal * 100);
    const isToday = d === todayStr();
    return `<div class="bar-col">
      <div class="bar-stack">
        <div class="bar-track" style="height:${pctAdd}%;min-height:${total?'4px':'0'}">
          <div class="bar-fill added" style="height:100%"></div>
        </div>
        <div class="bar-track" style="height:${pctDone}%;min-height:${done?'4px':'0'}">
          <div class="bar-fill ${isToday ? 'today' : ''}" style="height:100%"></div>
        </div>
      </div>
      <div class="bar-count">${done}/${total}</div>
      <div class="bar-label ${isToday ? 'today' : ''}">${dayNames[i]}</div>
    </div>`;
  }).join('');

  // Category breakdown
  const cats     = ['work', 'personal', 'meeting', 'learning'];
  const catCounts = cats.map(c => ({ c, n: tasks.filter(t => t.category === c && t.done).length }));
  const maxCat    = Math.max(1, ...catCounts.map(x => x.n));
  document.getElementById('cat-chart').innerHTML = catCounts.map(({ c, n }) => `
    <div class="cat-row">
      <span class="cat-name">${catIcon(c)} ${capitalize(c)}</span>
      <div class="cat-track"><div class="cat-fill cat-${c}" style="width:${Math.round(n / maxCat * 100)}%"></div></div>
      <span class="cat-count">${n}</span>
    </div>`).join('');
}

// ── Schedule View (Time Blocking) ─────────────
function renderSchedule() {
  const date = State.schedDate || todayStr();
  document.getElementById('sched-date-label').textContent = formatDateLabel(date);

  const tl = document.getElementById('timeline-wrap');
  const ul = document.getElementById('unscheduled-list');
  const dayTasks    = State.tasks.filter(t => t.date === date && !t.done);
  const scheduled   = dayTasks.filter(t => t.time);
  const unscheduled = dayTasks.filter(t => !t.time);

  ul.innerHTML = unscheduled.length
    ? unscheduled.map(t => `<li class="unsched-item" data-id="${t.id}" draggable="true">
        <span class="badge badge-${t.priority}">${priorityLabel(t.priority)}</span>
        <span class="unsched-title">${escHtml(t.title)}</span>
      </li>`).join('')
    : '<li class="unsched-empty">All tasks scheduled!</li>';

  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  tl.innerHTML = hours.map(h => {
    const hStr       = `${String(h).padStart(2, '0')}:00`;
    const tasksAtHour = scheduled.filter(t => parseInt(t.time.split(':')[0]) === h);
    return `<div class="timeline-row" data-hour="${h}">
      <div class="tl-time">${formatTime(hStr)}</div>
      <div class="tl-slot" data-hour="${h}">
        ${tasksAtHour.map(t => `
          <div class="tl-task-block" data-priority="${t.priority}" data-id="${t.id}">
            <span class="tl-task-title">${escHtml(t.title)}</span>
            <span class="tl-task-meta">${catIcon(t.category)}</span>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');

  // Unscheduled → timeline drop
  ul.querySelectorAll('.unsched-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', item.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  tl.querySelectorAll('.tl-slot').forEach(slot => {
    slot.addEventListener('dragover',  e => { e.preventDefault(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', async e => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const id   = e.dataTransfer.getData('text/plain');
      const hour = slot.dataset.hour;
      const task = State.tasks.find(t => t.id === id);
      if (task) {
        task.time = `${String(hour).padStart(2, '0')}:00`;
        await DB.tasks.save(task);
        renderSchedule();
        showToast(`⏰ Scheduled at ${formatTime(task.time)}`);
      }
    });
  });

  // Click task block to edit
  tl.querySelectorAll('.tl-task-block').forEach(block => {
    block.addEventListener('click', () => openSubtaskModal(block.dataset.id));
  });
}

// ── Drag-and-drop task reordering ─────────────
let _dragSrc = null;

function initDragDrop() {
  const list = document.getElementById('task-list');
  if (!list) return;

  list.querySelectorAll('.task-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      _dragSrc = item;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.id);
      setTimeout(() => item.classList.add('dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.task-item').forEach(i => i.classList.remove('drag-over-item'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (item !== _dragSrc) {
        list.querySelectorAll('.task-item').forEach(i => i.classList.remove('drag-over-item'));
        item.classList.add('drag-over-item');
      }
    });
    item.addEventListener('drop', async e => {
      e.preventDefault();
      if (!_dragSrc || _dragSrc === item) return;
      const srcId  = _dragSrc.dataset.id;
      const tgtId  = item.dataset.id;
      const srcIdx = State.tasks.findIndex(t => t.id === srcId);
      const tgtIdx = State.tasks.findIndex(t => t.id === tgtId);
      if (srcIdx < 0 || tgtIdx < 0) return;
      const [moved] = State.tasks.splice(srcIdx, 1);
      State.tasks.splice(tgtIdx, 0, moved);

      // FIX: only save the two affected tasks, not all tasks
      const newSrcOrder = tgtIdx;
      const newTgtOrder = srcIdx;
      moved.sortOrder = newSrcOrder;
      const displaced = State.tasks[srcIdx];
      if (displaced) displaced.sortOrder = newTgtOrder;

      await DB.tasks.save(moved);
      if (displaced && displaced.id !== moved.id) await DB.tasks.save(displaced);

      renderTasks();
    });
  });
}

// ── Subtask / Edit modal ──────────────────────
let _editingTaskId = null;

function openSubtaskModal(id) {
  const task = State.tasks.find(t => t.id === id);
  if (!task) return;
  _editingTaskId = id;

  document.getElementById('subtask-modal-title').textContent = task.title;

  // Populate edit fields
  document.getElementById('edit-task-title').value    = task.title;
  document.getElementById('edit-task-priority').value = task.priority || 'medium';
  document.getElementById('edit-task-category').value = task.category || 'work';
  document.getElementById('edit-task-recur').value    = task.recur    || 'none';
  document.getElementById('edit-task-date').value     = task.date     || todayStr();
  document.getElementById('edit-task-time').value     = task.time     || '';

  document.getElementById('subtask-notes').value = task.notes || '';
  renderSubtaskList(task);
  updateSubtaskProgress(task);
  document.getElementById('subtask-modal').classList.remove('hidden');
}

function renderSubtaskList(task) {
  const ul   = document.getElementById('subtask-list');
  const subs = task.subtasks || [];
  ul.innerHTML = subs.map((s, i) => `
    <li class="subtask-item ${s.done ? 'done' : ''}">
      <div class="task-check small" data-sub-idx="${i}">${s.done ? '✓' : ''}</div>
      <span class="subtask-title">${escHtml(s.title)}</span>
      <button class="task-action-btn del" data-sub-del="${i}">✕</button>
    </li>`).join('');

  ul.querySelectorAll('[data-sub-idx]').forEach(el => {
    el.addEventListener('click', () => toggleSubtask(task, +el.dataset.subIdx));
  });
  ul.querySelectorAll('[data-sub-del]').forEach(el => {
    el.addEventListener('click', () => deleteSubtask(task, +el.dataset.subDel));
  });
}

function updateSubtaskProgress(task) {
  const done  = (task.subtasks || []).filter(s => s.done).length;
  const total = (task.subtasks || []).length;
  document.getElementById('subtask-progress').textContent = total ? `${done} / ${total}` : '';
}

function toggleSubtask(task, idx) {
  task.subtasks[idx].done = !task.subtasks[idx].done;
  renderSubtaskList(task);
  updateSubtaskProgress(task);
}

function deleteSubtask(task, idx) {
  task.subtasks.splice(idx, 1);
  renderSubtaskList(task);
  updateSubtaskProgress(task);
}

async function saveSubtaskModal() {
  const task = State.tasks.find(t => t.id === _editingTaskId);
  if (!task) return;

  // Apply all edited fields
  const newTitle = document.getElementById('edit-task-title').value.trim();
  if (newTitle) task.title = newTitle;
  task.priority = document.getElementById('edit-task-priority').value;
  task.category = document.getElementById('edit-task-category').value;
  task.recur    = document.getElementById('edit-task-recur').value;
  task.date     = document.getElementById('edit-task-date').value || todayStr();
  task.time     = document.getElementById('edit-task-time').value;
  task.notes    = document.getElementById('subtask-notes').value;

  // Auto-complete if all subtasks done
  if ((task.subtasks || []).length && task.subtasks.every(s => s.done)) {
    task.done = true;
    showToast('✅ All subtasks done — task complete!');
  }

  await DB.tasks.save(task);
  renderCurrentView();
  updateStats();
  document.getElementById('subtask-modal').classList.add('hidden');
  _editingTaskId = null;
  showToast('✏️ Task updated');
}

// ── End-of-day rollover ───────────────────────
async function checkRollover() {
  const h = new Date().getHours();
  if (h < 18) return;

  const lastCheck = await DB.prefs.get('rollover_checked');
  if (lastCheck === todayStr()) return;

  const overdue = State.tasks.filter(t => t.date === todayStr() && !t.done);
  if (!overdue.length) return;

  await DB.prefs.set('rollover_checked', todayStr());

  const ul = document.getElementById('rollover-list');
  ul.innerHTML = overdue.map(t => `
    <li class="rollover-item">
      <label>
        <input type="checkbox" class="rollover-check" data-id="${t.id}" checked />
        ${escHtml(t.title)}
      </label>
    </li>`).join('');

  document.getElementById('rollover-modal').classList.remove('hidden');
}

async function rolloverSelected() {
  const checks = document.querySelectorAll('.rollover-check:checked');
  const tmrw   = tomorrowStr();
  for (const cb of checks) {
    const task = State.tasks.find(t => t.id === cb.dataset.id);
    if (task) {
      // FIX: create new task for tomorrow
      const newTask = { ...task, id: uid(), date: tmrw, done: false, _rolled: (task._rolled || 0) + 1 };
      await DB.tasks.save(newTask);
      State.tasks.push(newTask);
      // FIX: mark original as done instead of leaving a duplicate for today
      task.done = true;
      await DB.tasks.save(task);
    }
  }
  document.getElementById('rollover-modal').classList.add('hidden');
  renderCurrentView();
  updateStats();
  showToast(`↩ ${checks.length} task(s) rolled to tomorrow`);
}

// ── Install Prompt ─────────────────────────────
let _installEvent = null;
let _installCount = 0;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installEvent = e;
  tryShowInstallBanner();
});

function tryShowInstallBanner() {
  _installCount++;
  if (_installCount >= 2 && _installEvent) {
    document.getElementById('install-banner').classList.remove('hidden');
  }
}

// ── View switching ────────────────────────────
function renderCurrentView() {
  if (State.view === 'today' || State.view === 'all-today') renderTasks();
  else if (State.view === 'all') renderAllTasks();
  else if (State.view === 'schedule') renderSchedule();
  else if (State.view === 'stats') renderWeeklyStats();
}

function switchView(view) {
  State.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // Map view names to section IDs
  const viewMap = { today: 'today', all: 'all', schedule: 'schedule', reminders: 'reminders', stats: 'stats' };
  const sectionId = viewMap[view] || view;
  const viewEl = document.getElementById(`view-${sectionId}`);
  if (viewEl) viewEl.classList.remove('hidden');
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

  const titles = { today: "Today's Tasks", all: 'All Tasks', schedule: 'Schedule', reminders: 'Reminders', stats: 'Weekly Stats' };
  document.getElementById('page-title').textContent = titles[view] || 'WorkFlow';

  if (view === 'stats')    renderWeeklyStats();
  if (view === 'schedule') renderSchedule();
  if (view === 'all')      renderAllTasks();
  if (view === 'today')    renderTasks();
}

// ── Keyboard Shortcuts ────────────────────────
function bindKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
      document.activeElement.blur();
      return;
    }

    if (inInput) return;

    // FIX: shortcuts aligned with nav order 1=Today 2=All 3=Schedule 4=Reminders 5=Stats
    const map = {
      'n': () => { switchView('today'); setTimeout(() => document.getElementById('task-input').focus(), 50); },
      'r': () => { switchView('reminders'); setTimeout(() => document.getElementById('reminder-input').focus(), 50); },
      '/': () => {
        const si = State.view === 'all'
          ? document.getElementById('search-input-all')
          : document.getElementById('search-input');
        si?.focus();
      },
      '?': () => document.getElementById('shortcuts-modal').classList.remove('hidden'),
      '1': () => switchView('today'),
      '2': () => switchView('all'),
      '3': () => switchView('schedule'),
      '4': () => switchView('reminders'),
      '5': () => switchView('stats'),
    };
    const fn = map[e.key.toLowerCase()];
    if (fn) { e.preventDefault(); fn(); }
  });
}

// ── Pomodoro Timer ────────────────────────────
const Pomo = (() => {
  const WORK = 25 * 60, SHORT = 5 * 60, LONG = 15 * 60;
  let remaining = WORK;
  let running   = false;
  let sessions  = 0;
  let _interval = null;
  let mode      = 'work';

  const circle  = () => document.getElementById('pomo-circle');
  const timeEl  = () => document.getElementById('pomo-time');
  const sessEl  = () => document.getElementById('pomo-sessions');
  const labelEl = () => document.getElementById('pomo-label');
  const CIRC    = 2 * Math.PI * 27;

  function render() {
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    timeEl().textContent = `${mm}:${ss}`;
    const pct = remaining / totalFor(mode);
    circle().style.strokeDashoffset = CIRC * (1 - pct);
    sessEl().textContent = ['●', '●', '●', '●'].map((_, i) => i < sessions ? '●' : '○').join(' ');
  }

  function totalFor(m) { return m === 'work' ? WORK : m === 'short' ? SHORT : LONG; }

  function beep() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) { /* ignore if AudioContext not available */ }
  }

  function tick() {
    if (!running) return;
    remaining--;
    if (remaining <= 0) {
      running = false;
      clearInterval(_interval);
      beep();
      if (mode === 'work') {
        sessions = (sessions + 1) % 4;
        mode      = sessions === 0 ? 'long' : 'short';
        remaining = totalFor(mode);
        fireNotification('🍅 Pomodoro done!', sessions === 0 ? 'Take a long break (15 min)' : 'Take a short break (5 min)');
        showToast(sessions === 0 ? '🍅 Long break time!' : '🍅 Short break — 5 min');
        labelEl().textContent = sessions === 0 ? 'Long Break' : 'Short Break';
      } else {
        mode      = 'work';
        remaining = WORK;
        fireNotification('⏱ Break over', 'Time to focus!');
        showToast('⏱ Back to work!');
        labelEl().textContent = 'Focus Timer';
      }
      document.getElementById('pomo-start').textContent = '▶';
    }
    render();
  }

  function start() {
    if (running) {
      running = false; clearInterval(_interval);
      document.getElementById('pomo-start').textContent = '▶';
    } else {
      running = true; _interval = setInterval(tick, 1000);
      document.getElementById('pomo-start').textContent = '⏸';
    }
  }

  function reset() {
    running = false; clearInterval(_interval);
    mode = 'work'; remaining = WORK; sessions = 0;
    labelEl().textContent = 'Focus Timer';
    document.getElementById('pomo-start').textContent = '▶';
    render();
  }

  function init() {
    circle().style.strokeDasharray  = CIRC;
    circle().style.strokeDashoffset = 0;
    render();
    document.getElementById('pomo-start').addEventListener('click', start);
    document.getElementById('pomo-reset').addEventListener('click', reset);
  }

  return { init };
})();

// ── Sidebar mobile ─────────────────────────────
function openSidebar()  { document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebar-overlay').classList.add('show'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-overlay').classList.remove('show'); }

// ── Offline banner ─────────────────────────────
function setupOfflineBanner() {
  const b      = document.getElementById('offline-banner');
  const update = () => navigator.onLine ? b.classList.remove('show') : b.classList.add('show');
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// ── Service Worker ─────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('[WorkFlow] SW registered'))
      .catch(err => console.warn('[WorkFlow] SW error:', err));
  }
}

// ── Date display ───────────────────────────────
function updateDateDisplay() {
  document.getElementById('sidebar-date').textContent =
    new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── Bind all events ────────────────────────────
function bindEvents() {
  // Nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      if (window.innerWidth < 769) closeSidebar();
    });
  });

  // Add task
  document.getElementById('add-task-btn').addEventListener('click', async () => {
    const title = document.getElementById('task-input').value.trim();
    if (!title) { showToast('⚠️ Enter a task title'); return; }
    await addTask({
      title,
      priority: document.getElementById('task-priority').value,
      category: document.getElementById('task-category').value,
      time:     document.getElementById('task-time').value,
      recur:    document.getElementById('task-recur').value,
      date:     document.getElementById('task-date').value || todayStr(),
    });
    document.getElementById('task-input').value = '';
    document.getElementById('task-time').value  = '';
    tryShowInstallBanner();
  });

  document.getElementById('task-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-task-btn').click();
  });

  // Task list delegation (Today view)
  document.getElementById('task-list').addEventListener('click', e => {
    const item   = e.target.closest('.task-item');
    if (!item) return;
    const id     = item.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle')      toggleTask(id);
    if (action === 'delete')      deleteTask(id);
    if (action === 'open-detail') openSubtaskModal(id);
  });

  // Search — Today view
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  searchInput.addEventListener('input', () => {
    State.searchQuery = searchInput.value.trim();
    searchClear.classList.toggle('hidden', !State.searchQuery);
    renderTasks();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = ''; State.searchQuery = '';
    searchClear.classList.add('hidden');
    renderTasks();
  });

  // Search — All Tasks view
  const searchInputAll = document.getElementById('search-input-all');
  const searchClearAll = document.getElementById('search-clear-all');
  searchInputAll.addEventListener('input', () => {
    State.searchQueryAll = searchInputAll.value.trim();
    searchClearAll.classList.toggle('hidden', !State.searchQueryAll);
    renderAllTasks();
  });
  searchClearAll.addEventListener('click', () => {
    searchInputAll.value = ''; State.searchQueryAll = '';
    searchClearAll.classList.add('hidden');
    renderAllTasks();
  });

  // Filter chips — Today view
  document.querySelectorAll('[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      State.filter = chip.dataset.filter;
      renderTasks();
    });
  });

  // Filter chips — All Tasks view
  document.querySelectorAll('[data-filter-all]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-all]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      State.filterAll = chip.dataset.filterAll;
      renderAllTasks();
    });
  });

  // Subtask modal
  document.getElementById('subtask-add-btn').addEventListener('click', () => {
    const inp   = document.getElementById('subtask-input');
    const title = inp.value.trim();
    if (!title) return;
    const task  = State.tasks.find(t => t.id === _editingTaskId);
    if (!task) return;
    if (!task.subtasks) task.subtasks = [];
    task.subtasks.push({ title, done: false });
    inp.value = '';
    renderSubtaskList(task);
    updateSubtaskProgress(task);
  });
  document.getElementById('subtask-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('subtask-add-btn').click();
  });
  document.getElementById('subtask-save').addEventListener('click', saveSubtaskModal);
  document.getElementById('subtask-cancel').addEventListener('click', () => {
    document.getElementById('subtask-modal').classList.add('hidden');
    _editingTaskId = null;
  });
  document.getElementById('subtask-close').addEventListener('click', () => {
    document.getElementById('subtask-modal').classList.add('hidden');
    _editingTaskId = null;
  });

  // Add reminder
  document.getElementById('add-reminder-btn').addEventListener('click', async () => {
    const title = document.getElementById('reminder-input').value.trim();
    if (!title) { showToast('⚠️ Enter reminder text'); return; }
    await addReminder({
      title,
      date:   document.getElementById('reminder-date').value,
      time:   document.getElementById('reminder-time-input').value,
      repeat: document.getElementById('reminder-repeat').value,
    });
    document.getElementById('reminder-input').value = '';
  });

  document.getElementById('reminder-list').addEventListener('click', e => {
    const item = e.target.closest('.reminder-item');
    if (item && e.target.closest('[data-action="del-reminder"]')) deleteReminder(item.dataset.id);
  });

  // Schedule nav
  document.getElementById('sched-prev').addEventListener('click', () => {
    State.schedDate = offsetDate(State.schedDate || todayStr(), -1);
    renderSchedule();
  });
  document.getElementById('sched-next').addEventListener('click', () => {
    State.schedDate = offsetDate(State.schedDate || todayStr(), 1);
    renderSchedule();
  });

  // Theme
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // FIX: sync icon when OS changes colour scheme
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (State.theme === 'auto') { applyTheme(); syncThemeIcon(); }
  });

  // Notifications
  document.getElementById('notify-toggle').addEventListener('click', async () => {
    if (!State.notifEnabled) {
      const ok = await requestNotifPermission();
      if (ok) { State.notifEnabled = true; await DB.prefs.set('notifEnabled', true); showToast('🔔 Notifications enabled'); }
      else showToast('❌ Enable notifications in browser settings');
    } else {
      State.notifEnabled = false; await DB.prefs.set('notifEnabled', false); showToast('🔕 Notifications off');
    }
    document.getElementById('notify-toggle').textContent = State.notifEnabled ? '🔔' : '🔕';
  });

  // Export
  document.getElementById('export-btn').addEventListener('click', exportData);

  // Import
  document.getElementById('import-btn-trigger').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = ''; // reset so same file can be re-imported
  });

  // Hamburger
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
  });
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // Shortcuts modal
  document.getElementById('shortcut-btn').addEventListener('click', () =>
    document.getElementById('shortcuts-modal').classList.remove('hidden'));
  document.getElementById('shortcuts-close').addEventListener('click', () =>
    document.getElementById('shortcuts-modal').classList.add('hidden'));

  // Rollover modal
  document.getElementById('rollover-all').addEventListener('click', rolloverSelected);
  document.getElementById('rollover-close').addEventListener('click', () =>
    document.getElementById('rollover-modal').classList.add('hidden'));
  document.getElementById('rollover-dismiss').addEventListener('click', () =>
    document.getElementById('rollover-modal').classList.add('hidden'));

  // Install banner
  document.getElementById('install-yes').addEventListener('click', () => {
    if (_installEvent) { _installEvent.prompt(); _installEvent = null; }
    document.getElementById('install-banner').classList.add('hidden');
  });
  document.getElementById('install-no').addEventListener('click', () => {
    document.getElementById('install-banner').classList.add('hidden');
    DB.prefs.set('install_dismissed', true);
  });

  // Modal backdrop click to close (all modals)
  document.querySelectorAll('.modal-backdrop').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m) {
        // Subtask modal: auto-save on backdrop click to avoid data loss
        if (m.id === 'subtask-modal' && _editingTaskId) {
          saveSubtaskModal();
        } else {
          m.classList.add('hidden');
        }
      }
    });
  });
}

// ── Init ───────────────────────────────────────
async function init() {
  await DB.init();

  const prefs = await DB.prefs.getAll();
  State.theme        = prefs.theme        || 'auto';
  State.notifEnabled = prefs.notifEnabled || false;
  State.schedDate    = todayStr();

  applyTheme();
  syncThemeIcon();

  // ── NEW: Init sound engine + UI + reminder cards ──
  if (typeof SoundSettings !== 'undefined') await SoundSettings.init();
  else if (typeof SoundEngine !== 'undefined') await SoundEngine.init();
  if (typeof ReminderCard !== 'undefined') ReminderCard.init();

  State.tasks     = await DB.tasks.getAll();
  State.reminders = await DB.reminders.getAll();

  State.tasks.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || b.createdAt - a.createdAt);

  await generateRecurringTasks();

  // Set default date for add-task form
  document.getElementById('task-date').value     = todayStr();
  document.getElementById('reminder-date').value = todayStr();

  updateDateDisplay();
  renderTasks();
  renderReminders();
  updateStats();
  setupOfflineBanner();
  startReminderLoop();
  bindEvents();
  bindKeyboardShortcuts();
  Pomo.init();
  registerSW();

  // FIX: reconcile notification perm with stored pref
  reconcileNotifState();

  await checkRollover();

  setInterval(() => { updateDateDisplay(); updateStats(); checkReminders(); }, 60_000);
}

document.addEventListener('DOMContentLoaded', init);