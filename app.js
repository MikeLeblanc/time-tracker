'use strict';

const STORAGE_KEY = 'timetracker.v1';
const $ = (id) => document.getElementById(id);

// --- Data ---------------------------------------------------------------
// projects: [{id, name, removed}]  entries: [{id, projectId, start, end}]  running: {projectId, start} | null
// Times are epoch milliseconds.
let data = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.projects) && Array.isArray(saved.entries)) return saved;
  } catch { /* fall through to empty data */ }
  return { projects: [], entries: [], running: null };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const newId = () => crypto.randomUUID();
const activeProjects = () => data.projects.filter((p) => !p.removed).sort((a, b) => a.name.localeCompare(b.name));
const projectName = (id) => data.projects.find((p) => p.id === id)?.name ?? '(deleted project)';

// --- Formatting ---------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

const hours = (ms) => (ms / 3600000).toFixed(2);
const fmtDateTime = (t) => new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const toLocalInput = (t) => { const d = new Date(t); return `${fmtDate(t)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// --- Timer --------------------------------------------------------------
function start(projectId) {
  data.running = { projectId, start: Date.now() };
  save();
}

function stop() {
  if (!data.running) return;
  const end = Date.now();
  if (end - data.running.start >= 1000) {
    data.entries.push({ id: newId(), projectId: data.running.projectId, start: data.running.start, end });
  }
  data.running = null;
  save();
}

$('goStop').addEventListener('click', () => {
  if (data.running) stop();
  else if ($('project').value) start($('project').value);
  render();
});

// Changing the project while the clock runs closes the current entry and starts a new one.
$('project').addEventListener('change', () => {
  if (data.running && data.running.projectId !== $('project').value) {
    stop();
    start($('project').value);
    render();
  }
});

function tick() {
  $('elapsed').textContent = formatDuration(data.running ? Date.now() - data.running.start : 0);
}
setInterval(tick, 1000);

// --- Projects -----------------------------------------------------------
$('manageBtn').addEventListener('click', () => { renderProjectList(); $('projectsDialog').showModal(); });
$('closeProjects').addEventListener('click', () => $('projectsDialog').close());

$('addProjectForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('newProject').value.trim();
  if (!name) return;
  const existing = data.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) existing.removed = false;
  else data.projects.push({ id: newId(), name, removed: false });
  save();
  $('newProject').value = '';
  renderProjectList();
  render();
  if (!data.running) $('project').value = (existing ?? data.projects.at(-1)).id;
});

function removeProject(id) {
  const p = data.projects.find((x) => x.id === id);
  if (!confirm(`Remove "${p.name}" from the list? Time already recorded for it is kept.`)) return;
  // Keep the project record when it has entries so history still shows its name.
  if (data.entries.some((e) => e.projectId === id)) p.removed = true;
  else data.projects = data.projects.filter((x) => x.id !== id);
  save();
  renderProjectList();
  render();
}

function renderProjectList() {
  const list = $('projectList');
  list.replaceChildren();
  for (const p of activeProjects()) {
    const li = document.createElement('li');
    li.append(p.name);
    const btn = document.createElement('button');
    btn.className = 'icon';
    btn.textContent = 'Remove';
    btn.disabled = data.running?.projectId === p.id;
    btn.title = btn.disabled ? 'Stop the timer first' : '';
    btn.addEventListener('click', () => removeProject(p.id));
    li.append(btn);
    list.append(li);
  }
  if (!list.children.length) list.innerHTML = '<li class="muted">No projects yet.</li>';
}

function fillProjectSelect(select, selectedId) {
  select.replaceChildren();
  const options = activeProjects();
  // An entry may belong to a removed project; keep it selectable while editing that entry.
  const selected = data.projects.find((p) => p.id === selectedId);
  if (selected?.removed) options.push(selected);
  for (const p of options) select.add(new Option(p.name, p.id, false, p.id === selectedId));
}

// --- Entries ------------------------------------------------------------
function inRange() {
  const from = $('from').value ? new Date($('from').value + 'T00:00').getTime() : -Infinity;
  const to = $('to').value ? new Date($('to').value + 'T00:00').getTime() + 86400000 : Infinity;
  return data.entries.filter((e) => e.start >= from && e.start < to).sort((a, b) => b.start - a.start);
}

let editingId = null;

function openEntryDialog(entry) {
  editingId = entry?.id ?? null;
  $('entryTitle').textContent = entry ? 'Edit entry' : 'Add entry';
  fillProjectSelect($('entryProject'), entry?.projectId ?? $('project').value);
  const now = Date.now();
  $('entryStart').value = toLocalInput(entry?.start ?? now - 3600000);
  $('entryEnd').value = toLocalInput(entry?.end ?? now);
  $('entryError').hidden = true;
  $('entryDialog').showModal();
}

$('addEntry').addEventListener('click', () => {
  if (!activeProjects().length) return alert('Add a project first.');
  openEntryDialog(null);
});
$('cancelEntry').addEventListener('click', () => $('entryDialog').close());

$('entryForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const start = new Date($('entryStart').value).getTime();
  const end = new Date($('entryEnd').value).getTime();
  if (!(end > start)) {
    $('entryError').textContent = 'End must be after start.';
    $('entryError').hidden = false;
    return;
  }
  const fields = { projectId: $('entryProject').value, start, end };
  const existing = data.entries.find((x) => x.id === editingId);
  if (existing) Object.assign(existing, fields);
  else data.entries.push({ id: newId(), ...fields });
  save();
  $('entryDialog').close();
  render();
});

function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  data.entries = data.entries.filter((e) => e.id !== id);
  save();
  render();
}

function renderEntries() {
  const entries = inRange();
  const body = $('entries');
  body.replaceChildren();
  const totals = new Map();
  for (const e of entries) {
    totals.set(e.projectId, (totals.get(e.projectId) ?? 0) + (e.end - e.start));
    const tr = document.createElement('tr');
    const sameDay = fmtDate(e.start) === fmtDate(e.end);
    for (const [text, cls] of [[projectName(e.projectId)], [fmtDateTime(e.start)], [sameDay ? fmtTime(e.end) : fmtDateTime(e.end)], [hours(e.end - e.start), 'num']]) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }
    const actions = document.createElement('td');
    actions.className = 'num';
    for (const [label, fn] of [['Edit', () => openEntryDialog(e)], ['Delete', () => deleteEntry(e.id)]]) {
      const b = document.createElement('button');
      b.className = 'icon';
      b.textContent = label;
      b.addEventListener('click', fn);
      actions.append(b);
    }
    tr.append(actions);
    body.append(tr);
  }
  $('noEntries').hidden = entries.length > 0;

  const t = $('totals');
  t.replaceChildren();
  let all = 0;
  for (const [pid, ms] of [...totals].sort((a, b) => projectName(a[0]).localeCompare(projectName(b[0])))) {
    all += ms;
    const span = document.createElement('span');
    span.className = 'pill';
    span.textContent = `${projectName(pid)}: ${hours(ms)} h`;
    t.append(span);
  }
  if (totals.size > 1) {
    const span = document.createElement('span');
    span.className = 'pill';
    span.innerHTML = `<strong>Total: ${hours(all)} h</strong>`;
    t.append(span);
  }
}

$('from').addEventListener('change', renderEntries);
$('to').addEventListener('change', renderEntries);

// --- Export / backup ----------------------------------------------------
function download(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;

$('exportCsv').addEventListener('click', () => {
  const rows = [['Project', 'Date', 'Start', 'End', 'Hours']];
  for (const e of inRange().reverse()) {
    rows.push([projectName(e.projectId), fmtDate(e.start), toLocalInput(e.start).slice(11), toLocalInput(e.end).slice(11), hours(e.end - e.start)]);
  }
  // The BOM makes Excel read accented characters correctly.
  download(`time-${$('from').value || 'all'}-to-${$('to').value || 'all'}.csv`, '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
});

$('backup').addEventListener('click', () => {
  download(`time-tracker-backup-${fmtDate(Date.now())}.json`, JSON.stringify(data, null, 2), 'application/json');
});

$('restoreBtn').addEventListener('click', () => $('restore').click());
$('restore').addEventListener('change', async () => {
  const file = $('restore').files[0];
  $('restore').value = '';
  if (!file) return;
  try {
    const restored = JSON.parse(await file.text());
    if (!Array.isArray(restored.projects) || !Array.isArray(restored.entries)) throw new Error();
    if (!confirm(`Replace all current data with this backup (${restored.entries.length} entries)?`)) return;
    data = { projects: restored.projects, entries: restored.entries, running: restored.running ?? null };
    save();
    render();
  } catch {
    alert('That file is not a Time Tracker backup.');
  }
});

// --- Render -------------------------------------------------------------
function render() {
  const select = $('project');
  const keep = data.running?.projectId ?? select.value;
  fillProjectSelect(select, keep);
  if (!select.value && select.options.length) select.selectedIndex = 0;

  const btn = $('goStop');
  btn.textContent = data.running ? 'STOP' : 'GO';
  btn.className = data.running ? 'stop' : 'go';
  btn.disabled = !data.running && !select.options.length;
  $('status').textContent = data.running
    ? `Started at ${fmtTime(data.running.start)}`
    : select.options.length ? '' : 'Click "Projects…" to add your first project.';
  document.title = data.running ? `● ${projectName(data.running.projectId)} – Time Tracker` : 'Time Tracker';
  tick();
  renderEntries();
}

// Default range: the current month.
{
  const now = new Date();
  $('from').value = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  $('to').value = fmtDate(now);
}
render();

// Another open window changed the data.
window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { data = load(); render(); } });

// --- Install & offline --------------------------------------------------
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('installBtn').hidden = false;
});
$('installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('installBtn').hidden = true;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
// Ask the browser not to clear this site's data when disk space runs low.
navigator.storage?.persist?.();
