// ── STATE ──────────────────────────────────────────────────
let profiles = [];
let currentProfile = null;
let builderSteps = [];
let selectedStepIdx = null;
let isRunning = false;
let liveInterval = null;
let builderMode = false;
let sse = null;
let sortable = null;

const BROWSER_W = 1280;
const BROWSER_H = 720;

// ── INIT ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupSSE();
  loadProfiles();
  startLive();
  setupClickOverlay();
  setupManualInput();
  updateUrl();
});

// ── TABS ──────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.toggle('active', el.id === 'tab-' + tab);
      });
      builderMode = (tab === 'builder');
      renderBuilderMarkers();
    });
  });
}

// ── LIVE SCREENSHOT ───────────────────────────────────────
function startLive() {
  refreshScreenshot();
  liveInterval = setInterval(refreshScreenshot, 1500);
}

function refreshScreenshot() {
  const img = document.getElementById('liveFrame');
  const ts = Date.now();
  const newSrc = `/screenshot?t=${ts}`;
  const tmp = new Image();
  tmp.onload = () => { img.src = newSrc; };
  tmp.src = newSrc;
  updateUrl();
}

function toggleLive(on) {
  clearInterval(liveInterval);
  if (on) liveInterval = setInterval(refreshScreenshot, 1500);
}

async function updateUrl() {
  try {
    const r = await fetch('/browser/url');
    const { url } = await r.json();
    const bar = document.getElementById('urlBar');
    if (document.activeElement !== bar) bar.value = url || '';
  } catch (_) {}
}

// ── CLICK OVERLAY ─────────────────────────────────────────
function setupClickOverlay() {
  const overlay = document.getElementById('clickOverlay');
  overlay.addEventListener('click', e => {
    const { bx, by, px, py } = getBrowserCoords(e);
    if (builderMode) {
      addBuilderStep(bx, by, px, py);
    } else {
      sendClick(bx, by, px, py);
    }
  });
}

function getBrowserCoords(e) {
  const img = document.getElementById('liveFrame');
  const rect = img.getBoundingClientRect();
  const relX = e.clientX - rect.left;
  const relY = e.clientY - rect.top;
  const scaleX = BROWSER_W / rect.width;
  const scaleY = BROWSER_H / rect.height;
  return {
    bx: Math.round(relX * scaleX),
    by: Math.round(relY * scaleY),
    px: relX,
    py: relY,
    rect
  };
}

async function sendClick(bx, by, px, py) {
  showRipple(px, py);
  try {
    await fetch('/browser/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: bx, y: by })
    });
    setTimeout(refreshScreenshot, 300);
  } catch (e) {
    addLog('Click failed: ' + e.message, 'error');
  }
}

function showRipple(px, py) {
  const overlay = document.getElementById('clickOverlay');
  const r = document.createElement('div');
  r.className = 'ripple';
  r.style.left = px + 'px';
  r.style.top = py + 'px';
  overlay.appendChild(r);
  setTimeout(() => r.remove(), 550);
}

// ── MANUAL CONTROLS ───────────────────────────────────────
function setupManualInput() {
  const input = document.getElementById('manualInput');
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const text = input.value;
      input.value = '';
      await sendTextWithEnter(text);
    }
  });
}

// ✅ Reusable function: send text + Enter (used by manual input AND builder "send" action)
async function sendTextWithEnter(text) {
  try {
    if (text) {
      await fetch('/browser/type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, delay: 20 })
      });
    }
    await fetch('/browser/keypress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'Enter' })
    });
    if (document.getElementById('liveToggle')?.checked) {
      setTimeout(refreshScreenshot, 400);
    }
  } catch (e) {
    addLog('Send failed: ' + e.message, 'error');
  }
}

async function sendManualKey(key) {
  if (key === 'Backspace') {
    const input = document.getElementById('manualInput');
    if (input.value) {
      input.value = input.value.slice(0, -1);
    }
    await fetch('/browser/keypress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'Backspace' })
    });
  } else if (key === 'Enter') {
    await fetch('/browser/keypress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'Enter' })
    });
    setTimeout(refreshScreenshot, 400);
  }
}

async function sendScroll(deltaY) {
  await fetch('/browser/scroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: BROWSER_W / 2, y: BROWSER_H / 2, deltaY })
  });
  setTimeout(refreshScreenshot, 300);
}

async function navigate() {
  const url = document.getElementById('urlBar').value.trim();
  if (!url) return;
  addLog(`Navigating to ${url}`, 'info');
  await fetch('/browser/navigate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  setTimeout(refreshScreenshot, 1500);
}

// ── SSE ───────────────────────────────────────────────────
function setupSSE() {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');

  function connect() {
    sse = new EventSource('/logs/stream');
    sse.onopen = () => {
      dot.className = 'status-dot connected';
      txt.textContent = 'Connected';
    };
    sse.onmessage = e => {
      const data = JSON.parse(e.data);
      switch (data.type) {
        case 'log': addLog(data.message, data.level); break;
        case 'status': setRunning(data.running); break;
        case 'response': setResponse(data.text); break;
        case 'step': updateProgress(data.index + 1, data.total, data.label); break;
        case 'done': if (data.result) setResponse(data.result); hideProgress(); break;
        case 'error': addLog('Error: ' + data.message, 'error'); hideProgress(); break;
      }
    };
    sse.onerror = () => {
      dot.className = 'status-dot error';
      txt.textContent = 'Disconnected';
      setTimeout(connect, 3000);
    };
  }
  connect();
}

// ── PROFILES ──────────────────────────────────────────────
async function loadProfiles() {
  try {
    const r = await fetch('/profiles');
    profiles = await r.json();
    renderProfileSelect();
    if (profiles.length) loadBuilderFromProfile(profiles[0]);
  } catch (e) {
    addLog('Failed to load profiles: ' + e.message, 'error');
  }
}

function renderProfileSelect() {
  const sel = document.getElementById('profileSelect');
  const cur = sel.value;
  sel.innerHTML = profiles.map(p =>
    `<option value="${escHtml(p.name)}">${escHtml(p.name)}</option>`
  ).join('');
  if (cur && profiles.find(p => p.name === cur)) sel.value = cur;
}

// ── AUTOMATION ────────────────────────────────────────────
async function runAutomation() {
  const profile = document.getElementById('profileSelect').value;
  const prompt = document.getElementById('promptInput').value.trim();
  if (!prompt) { addLog('Enter a prompt first', 'warn'); return; }
  addLog(`▶ Run "${profile}" — "${prompt.substring(0, 40)}..."`, 'info');
  setRunning(true);
  try {
    const r = await fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, prompt })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
  } catch (e) {
    addLog('Error: ' + e.message, 'error');
    setRunning(false);
  }
}

async function stopAutomation() {
  await fetch('/stop', { method: 'POST' });
  addLog('Stop requested', 'warn');
}

function setRunning(running) {
  isRunning = running;
  document.getElementById('runBtn').disabled = running;
  document.getElementById('stopBtn').disabled = !running;
  const badge = document.getElementById('runningBadge');
  badge.style.display = running ? 'inline-block' : 'none';
  if (!running) hideProgress();
}

function updateProgress(current, total, label) {
  const wrap = document.getElementById('progressWrap');
  wrap.style.display = 'block';
  const pct = Math.round((current / total) * 100);
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressLabel').textContent = `${current}/${total}: ${label}`;
}

function hideProgress() {
  document.getElementById('progressWrap').style.display = 'none';
}

function setResponse(text) {
  const box = document.getElementById('responseBox');
  box.textContent = text;
  box.scrollTop = box.scrollHeight;
}

function copyResponse() {
  const text = document.getElementById('responseBox').textContent;
  navigator.clipboard.writeText(text).then(() => addLog('Response copied', 'info'));
}

// ── BUILDER ───────────────────────────────────────────────
function loadBuilderFromProfile(profile) {
  document.getElementById('builderName').value = profile.name || '';
  document.getElementById('builderUrl').value = profile.url || '';
  builderSteps = JSON.parse(JSON.stringify(profile.steps || []));
  renderStepsList();
  renderBuilderMarkers();
}

function loadBuilderProfile() {
  const name = document.getElementById('builderName').value.trim();
  const p = profiles.find(p => p.name === name);
  if (p) loadBuilderFromProfile(p);
  else addLog(`Profile "${name}" not found`, 'warn');
}

async function saveBuilderProfile() {
  const name = document.getElementById('builderName').value.trim();
  const url = document.getElementById('builderUrl').value.trim();
  if (!name) { addLog('Enter a profile name', 'warn'); return; }
  const payload = { name, url, steps: builderSteps };
  const r = await fetch('/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (r.ok) {
    addLog(`Profile "${name}" saved`, 'info');
    await loadProfiles();
  }
}

async function deleteBuilderProfile() {
  const name = document.getElementById('builderName').value.trim();
  if (!name || !confirm(`Delete profile "${name}"?`)) return;
  await fetch('/profiles/' + encodeURIComponent(name), { method: 'DELETE' });
  addLog(`Profile "${name}" deleted`, 'warn');
  await loadProfiles();
  builderSteps = [];
  renderStepsList();
}

function addBuilderStep(bx, by, px, py) {
  const step = {
    id: Date.now(),
    action: 'click',
    x: bx,
    y: by,
    label: `Click (${bx}, ${by})`
  };
  builderSteps.push(step);
  renderStepsList();
  renderBuilderMarkers();
  openStepEditor(builderSteps.length - 1);
  showRipple(px, py);
}

function addManualStep() {
  const step = { id: Date.now(), action: 'wait', ms: 1000, label: 'Wait' };
  builderSteps.push(step);
  renderStepsList();
  openStepEditor(builderSteps.length - 1);
}

function renderStepsList() {
  const list = document.getElementById('stepsList');
  list.innerHTML = '';
  builderSteps.forEach((step, i) => {
    const el = document.createElement('div');
    el.className = 'step-item' + (selectedStepIdx === i ? ' selected' : '');
    el.dataset.idx = i;
    el.innerHTML = `
      <span class="step-drag">⠿</span>
      <span class="step-num">${i + 1}</span>
      <span class="step-action">${escHtml(step.action)}</span>
      <span class="step-lbl">${escHtml(step.label || getStepSummary(step))}</span>
      <button class="step-del" onclick="deleteStep(${i}, event)" title="Delete">✕</button>
    `;
    el.addEventListener('click', () => openStepEditor(i));
    list.appendChild(el);
  });
  if (sortable) sortable.destroy();
  sortable = Sortable.create(list, {
    handle: '.step-drag',
    animation: 150,
    onEnd: e => {
      const moved = builderSteps.splice(e.oldIndex, 1)[0];
      builderSteps.splice(e.newIndex, 0, moved);
      selectedStepIdx = e.newIndex;
      renderStepsList();
      renderBuilderMarkers();
    }
  });
}

function deleteStep(i, e) {
  e.stopPropagation();
  builderSteps.splice(i, 1);
  if (selectedStepIdx === i) { selectedStepIdx = null; closeStepEditor(); }
  else if (selectedStepIdx > i) selectedStepIdx--;
  renderStepsList();
  renderBuilderMarkers();
}

function getStepSummary(step) {
  switch (step.action) {
    case 'click': return `(${step.x}, ${step.y})`;
    case 'type': return step.text ? step.text.substring(0, 30) : '';
    case 'send': return step.text ? `Send: "${step.text.substring(0,20)}..."` : 'Send (Enter)';
    case 'keypress': return step.key;
    case 'wait': return step.ms + 'ms';
    case 'scroll': return `ΔY ${step.deltaY}`;
    case 'waitSelector':
    case 'waitSelectorGone':
    case 'copy':
    case 'read': return step.selector || '';
    case 'navigate': return step.url || '';
    case 'evaluate': return 'JS';
    default: return '';
  }
}

// ── BUILDER MARKERS ──────────────────────────────────────
function renderBuilderMarkers() {
  const container = document.getElementById('builderMarkers');
  container.innerHTML = '';
  if (!builderMode) return;
  const img = document.getElementById('liveFrame');
  const rect = img.getBoundingClientRect();
  const parentRect = img.parentElement.getBoundingClientRect();
  if (!rect.width) return;
  const scaleX = rect.width / BROWSER_W;
  const scaleY = rect.height / BROWSER_H;
  const clickSteps = builderSteps.filter(s => ['click', 'scroll', 'read'].includes(s.action) && s.x !== undefined);
  clickSteps.forEach((step, seq) => {
    const globalIdx = builderSteps.indexOf(step);
    const px = (rect.left - parentRect.left) + step.x * scaleX;
    const py = (rect.top - parentRect.top) + step.y * scaleY;
    const m = document.createElement('div');
    m.className = 'marker' + (selectedStepIdx === globalIdx ? ' selected' : '');
    m.style.left = px + 'px';
    m.style.top = py + 'px';
    m.textContent = globalIdx + 1;
    m.title = step.label || step.action;
    let dragging = false;
    m.addEventListener('mousedown', e => {
      e.stopPropagation();
      dragging = true;
      openStepEditor(globalIdx);
      const onMove = ev => {
        if (!dragging) return;
        const imgRect = img.getBoundingClientRect();
        const relX = ev.clientX - imgRect.left;
        const relY = ev.clientY - imgRect.top;
        const bx = Math.round(Math.max(0, Math.min(BROWSER_W, relX / scaleX)));
        const by = Math.round(Math.max(0, Math.min(BROWSER_H, relY / scaleY)));
        builderSteps[globalIdx].x = bx;
        builderSteps[globalIdx].y = by;
        m.style.left = (imgRect.left - parentRect.left + relX) + 'px';
        m.style.top = (imgRect.top - parentRect.top + relY) + 'px';
        const ex = document.getElementById('edit-x');
        const ey = document.getElementById('edit-y');
        if (ex) ex.value = bx;
        if (ey) ey.value = by;
      };
      const onUp = () => {
        dragging = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        renderStepsList();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    container.appendChild(m);
  });
}

// ── STEP EDITOR ───────────────────────────────────────────
function openStepEditor(idx) {
  selectedStepIdx = idx;
  const step = builderSteps[idx];
  const editor = document.getElementById('stepEditor');
  editor.style.display = 'flex';
  document.getElementById('editStepNum').textContent = '#' + (idx + 1);
  document.getElementById('editAction').value = step.action;
  document.getElementById('editLabel').value = step.label || '';
  renderStepEditorFields();
  renderStepsList();
}

function closeStepEditor() {
  selectedStepIdx = null;
  document.getElementById('stepEditor').style.display = 'none';
  renderStepsList();
}

function renderStepEditorFields() {
  const action = document.getElementById('editAction').value;
  const step = selectedStepIdx !== null ? builderSteps[selectedStepIdx] : {};
  const fields = document.getElementById('editActionFields');
  let html = '';
  switch (action) {
    case 'click':
    case 'read':
      html = `
        <div class="edit-row">
          <div><label>X</label><input id="edit-x" type="number" value="${step.x || 0}" /></div>
          <div><label>Y</label><input id="edit-y" type="number" value="${step.y || 0}" /></div>
        </div>
        ${action === 'read' ? `<div><label>Selector (optional)</label><input id="edit-selector" type="text" value="${escAttr(step.selector || '')}" /></div>` : ''}
      `;
      break;
    case 'scroll':
      html = `
        <div class="edit-row">
          <div><label>X</label><input id="edit-x" type="number" value="${step.x || 640}" /></div>
          <div><label>Y</label><input id="edit-y" type="number" value="${step.y || 360}" /></div>
        </div>
        <div class="edit-row">
          <div><label>Delta X</label><input id="edit-deltaX" type="number" value="${step.deltaX || 0}" /></div>
          <div><label>Delta Y</label><input id="edit-deltaY" type="number" value="${step.deltaY || 300}" /></div>
        </div>
      `;
      break;
    case 'type':
    case 'send': // ✅ Send action now has same fields as type
      html = `
        <div><label>Text (use {{prompt}} for dynamic prompt)</label>
          <textarea id="edit-text" rows="3">${escHtml(step.text || '')}</textarea>
        </div>
        <div><label>Delay (ms per char)</label><input id="edit-delay" type="number" value="${step.delay || 30}" /></div>
        ${action === 'send' ? '<div style="font-size:11px;color:#888;margin-top:4px">💡 This will type the text (if any) then press Enter</div>' : ''}
      `;
      break;
    case 'keypress':
      html = `<div><label>Key</label><input id="edit-key" type="text" value="${escAttr(step.key || 'Enter')}" /></div>`;
      break;
    case 'wait':
      html = `<div><label>Milliseconds</label><input id="edit-ms" type="number" value="${step.ms || 1000}" /></div>`;
      break;
    case 'waitSelector':
    case 'waitSelectorGone':
      html = `
        <div><label>CSS Selector</label><input id="edit-selector" type="text" value="${escAttr(step.selector || '')}" /></div>
        <div><label>Timeout (ms)</label><input id="edit-timeout" type="number" value="${step.timeout || 30000}" /></div>
        ${action === 'waitSelector' ? `<div><label><input id="edit-optional" type="checkbox" ${step.optional ? 'checked' : ''} /> Optional</label></div>` : ''}
      `;
      break;
    case 'copy':
      html = `<div><label>CSS Selector</label><input id="edit-selector" type="text" value="${escAttr(step.selector || '')}" /></div>`;
      break;
    case 'navigate':
      html = `<div><label>URL</label><input id="edit-url" type="text" value="${escAttr(step.url || '')}" /></div>`;
      break;
    case 'evaluate':
      html = `<div><label>JavaScript</label><textarea id="edit-script" rows="4" style="font-family:monospace">${escHtml(step.script || '')}</textarea></div>`;
      break;
  }
  fields.innerHTML = html;
}

function saveStepEdit() {
  if (selectedStepIdx === null) return;
  const action = document.getElementById('editAction').value;
  const label = document.getElementById('editLabel').value;
  const step = { ...builderSteps[selectedStepIdx], action, label };
  const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  const gn = id => { const v = g(id); return v !== undefined ? Number(v) : undefined; };
  const gb = id => { const el = document.getElementById(id); return el ? el.checked : false; };
  switch (action) {
    case 'click':
      step.x = gn('edit-x'); step.y = gn('edit-y'); break;
    case 'scroll':
      step.x = gn('edit-x'); step.y = gn('edit-y');
      step.deltaX = gn('edit-deltaX'); step.deltaY = gn('edit-deltaY'); break;
    case 'type':
    case 'send': // ✅ Save text and delay for send action
      step.text = g('edit-text'); step.delay = gn('edit-delay'); break;
    case 'keypress':
      step.key = g('edit-key'); break;
    case 'wait':
      step.ms = gn('edit-ms'); break;
    case 'waitSelector':
      step.selector = g('edit-selector'); step.timeout = gn('edit-timeout'); step.optional = gb('edit-optional'); break;
    case 'waitSelectorGone':
      step.selector = g('edit-selector'); step.timeout = gn('edit-timeout'); break;
    case 'copy':
    case 'read':
      step.selector = g('edit-selector');
      if (action === 'read') { step.x = gn('edit-x'); step.y = gn('edit-y'); }
      break;
    case 'navigate':
      step.url = g('edit-url'); break;
    case 'evaluate':
      step.script = g('edit-script'); break;
  }
  builderSteps[selectedStepIdx] = step;
  renderStepsList();
  renderBuilderMarkers();
  addLog(`Step ${selectedStepIdx + 1} updated`, 'info');
}

// ── LOGS ──────────────────────────────────────────────────
function addLog(message, level = 'info') {
  const box = document.getElementById('logBox');
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  const time = new Date().toLocaleTimeString('en', { hour12: false });
  entry.innerHTML = `<span class="log-time">${time}</span>${escHtml(message)}`;
  box.appendChild(entry);
  if (document.getElementById('autoScrollLog').checked) {
    box.scrollTop = box.scrollHeight;
  }
  while (box.children.length > 500) box.removeChild(box.firstChild);
}

function clearLogs() {
  document.getElementById('logBox').innerHTML = '';
}

// ── UTILS ─────────────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}