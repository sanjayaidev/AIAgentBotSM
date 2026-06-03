// ── STATE ──────────────────────────────────────────────────
let profiles = [];
let currentProfile = null;
let builderSteps = [];
let selectedStepIdx = null;
let isRunning = false;
let liveInterval = null;
let builderMode = false;
let builderWorkflowMode = 'touch'; // 'touch' or 'js'
let builderScriptSource = 'provider'; // 'provider' or 'custom'
let builderDefaultAction = 'click';
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
  setupFloatingLogs();
  setupWorkflowModeSwitch();
  updateUrl();
  // Profile select change handler is now in renderProfileSelect()
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
      if (builderWorkflowMode === 'touch') {
        addBuilderStep(bx, by, px, py);
      }
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

// ── FLOATING LOGS (Ctrl+L) ─────────────────────────────────
function setupFloatingLogs() {
  // Toggle on Ctrl+L
  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      toggleFloatingLogs();
    }
  });
  const closeBtn = document.getElementById('floatingClose');
  if (closeBtn) closeBtn.addEventListener('click', () => toggleFloatingLogs(false));
  const clearBtn = document.getElementById('floatingClear');
  if (clearBtn) clearBtn.addEventListener('click', () => { document.getElementById('floatingLogBox').innerHTML = ''; });
}

function toggleFloatingLogs(forceState) {
  const panel = document.getElementById('floatingLogs');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
  const show = typeof forceState === 'boolean' ? forceState : !isOpen;
  panel.style.display = show ? 'flex' : 'none';
  panel.setAttribute('aria-hidden', show ? 'false' : 'true');
  if (show) {
    // copy latest logs
    const main = document.getElementById('logBox');
    const dest = document.getElementById('floatingLogBox');
    if (main && dest) {
      dest.innerHTML = main.innerHTML;
      dest.scrollTop = dest.scrollHeight;
    }
  }
}

// ── PROFILES ──────────────────────────────────────────────
async function loadProfiles() {
  try {
    const r = await fetch('/profiles');
    profiles = await r.json();
    renderProfileSelect();
    // Don't auto-load first profile - wait for user selection or keep current
    const sel = document.getElementById('profileSelect');
    const selectedName = sel.value;
    if (selectedName) {
      const profile = profiles.find(p => p.name === selectedName);
      if (profile) {
        loadBuilderFromProfile(profile);
        updateProfileEndpoint(profile);
      }
    } else if (profiles.length) {
      // Only load first if nothing selected yet
      loadBuilderFromProfile(profiles[0]);
      updateProfileEndpoint(profiles[0]);
    }
    await loadEndpointDocs();
  } catch (e) {
    addLog('Failed to load profiles: ' + e.message, 'error');
  }
}

// Load profiles into Automation dropdown and select current workflow
function loadAutomationProfiles() {
  const sel = document.getElementById('profileSelect');
  if (!sel) return;
  
  // Select the currently active workflow in builder if it matches a saved profile
  const currentName = document.getElementById('builderName')?.value.trim();
  if (currentName && profiles.find(p => p.name === currentName)) {
    sel.value = currentName;
  } else if (profiles.length > 0) {
    sel.value = profiles[0].name;
  }
  
  // Auto-load the selected workflow
  const selectedProfile = profiles.find(p => p.name === sel.value);
  if (selectedProfile) {
    loadBuilderFromProfile(selectedProfile);
    updateProfileEndpoint(selectedProfile);
  }
}

function updateProfileEndpoint(profile) {
  const endpoint = profile?.slug ? `/run/${profile.slug}` : '/run/<profile-slug>';
  const el = document.getElementById('profileEndpoint');
  if (el) el.textContent = endpoint;
}

async function loadEndpointDocs() {
  const el = document.getElementById('endpointsList');
  if (!el) return;
  try {
    const r = await fetch('/endpoints');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to load docs');
    if (!data.endpoints || !data.endpoints.length) {
      el.textContent = 'No saved endpoints found.';
      return;
    }
    el.textContent = data.endpoints.map(item => `${item.name} → ${item.endpoint}${item.url ? ` (starts ${item.url})` : ''}`).join('\n');
  } catch (e) {
    el.textContent = 'Unable to load endpoint docs.';
    addLog('Failed to load endpoint docs: ' + e.message, 'error');
  }
}

function renderProfileSelect() {
  const sel = document.getElementById('profileSelect');
  if (!sel) return;
  
  const cur = sel.value;
  sel.innerHTML = profiles.map(p =>
    `<option value="${escHtml(p.name)}">${escHtml(p.name)}</option>`
  ).join('');
  
  // Keep current selection or default to first
  if (cur && profiles.find(p => p.name === cur)) {
    sel.value = cur;
  } else if (profiles.length > 0) {
    sel.value = profiles[0].name;
  }
  
  const selected = profiles.find(p => p.name === sel.value) || profiles[0];
  updateProfileEndpoint(selected);
  
  // Remove old listeners and add new one
  const newSel = sel.cloneNode(true);
  sel.parentNode.replaceChild(newSel, sel);
  
  // Auto-load workflow when profile selection changes in Automation tab
  newSel.addEventListener('change', () => {
    const profile = profiles.find(p => p.name === newSel.value);
    if (profile) {
      loadBuilderFromProfile(profile);
      updateProfileEndpoint(profile);
    }
  });
}

// ── AUTOMATION ────────────────────────────────────────────
async function runAutomation() {
  const profileSelect = document.getElementById('profileSelect');
  let profileName = profileSelect?.value || '';
  if (!profileName) {
    profileName = document.getElementById('builderName')?.value.trim() || '';
  }
  const prompt = document.getElementById('promptInput').value.trim();
  
  // Get the selected profile to check its workflow mode
  const profile = profiles.find(p => p.name === profileName);
  if (!profile) { addLog('Profile not found', 'error'); return; }
  
  // Only require prompt if there's a text input element or prompt placeholder in the workflow
  addLog(`▶ Run "${profileName}"`, 'info');
  setRunning(true);
  try {
    const r = await fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profileName, prompt: prompt || '' })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
  } catch (e) {
    addLog('Error: ' + e.message, 'error');
    setRunning(false);
  }
}

// Execute JS Script from UI (JS Mode only)
async function executeJSScript() {
  const profileName = document.getElementById('profileSelect').value;
  const prompt = document.getElementById('promptInput').value.trim();
  
  // Get the selected profile
  const profile = profiles.find(p => p.name === profileName);
  if (!profile) { addLog('Profile not found', 'error'); return; }
  
  if (profile.workflowMode !== 'js') {
    addLog('Switch to JS mode to use Execute JS button', 'warn');
    return;
  }
  
  addLog(`⚡ Execute JS for "${profileName}"`, 'info');
  setRunning(true);
  try {
    const r = await fetch('/execute-js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profileName, prompt: prompt || '' })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    
    addLog('✅ Script executed successfully', 'success');
    if (data.result) {
      document.getElementById('responseBox').textContent = JSON.stringify(data.result, null, 2);
    }
  } catch (e) {
    addLog('Error: ' + e.message, 'error');
  } finally {
    setRunning(false);
  }
}

// Execute JS directly from Builder tab without saving
async function executeJSScriptFromBuilder() {
  const script = document.getElementById('builderScript').value.trim();
  const provider = document.getElementById('builderProvider').value;
  const command = document.getElementById('builderCommand').value;
  const scriptSource = document.getElementById('builderScriptSource')?.value || builderScriptSource;
  const prompt = document.getElementById('builderPromptInput').value.trim();
  const email = document.getElementById('providerEmail').value.trim();
  const password = document.getElementById('providerPassword').value.trim();
  const apiKey = document.getElementById('providerApiKey').value.trim();
  const workflowMode = document.getElementById('builderWorkflowMode').value;
  
  if (workflowMode !== 'js') {
    addLog('Switch to JS mode to execute scripts', 'warn');
    return;
  }
  
  if (scriptSource === 'custom' && !script) {
    addLog('Please enter JavaScript code first', 'error');
    return;
  }
  if (scriptSource === 'provider' && (!provider || !command)) {
    addLog('Please select a provider and command to use existing script', 'error');
    return;
  }
  
  addLog('⚡ Executing JS from Builder...', 'info');
  setRunning(true);
  
  try {
    const r = await fetch('/execute-js-direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runMode: scriptSource,
        script: scriptSource === 'custom' ? script : '',
        context: {
          provider,
          command,
          prompt: prompt || '',
          chatIndex: document.getElementById('builderChatIndex')?.value || '0',
          imageSize: document.getElementById('builderMediaSize')?.value || '',
          videoSize: document.getElementById('builderMediaSize')?.value || '',
          code: document.getElementById('builderGoogle2FACode')?.value || '',
          credentials: { email, password, apiKey }
        }
      })
    });
    
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    
    addLog('✅ Script executed successfully', 'success');
    setBuilderResponse(data.result ? JSON.stringify(data.result, null, 2) : 'No result returned');
  } catch (e) {
    addLog('Error: ' + e.message, 'error');
    setBuilderResponse('Error: ' + e.message);
  } finally {
    setRunning(false);
  }
}

// Check if the workflow requires a prompt based on mode and steps
function shouldRequirePrompt(profile) {
  if (!profile) return true;
  
  // JS mode with script - check if script uses context.message
  if (profile.workflowMode === 'js' && profile.script) {
    return profile.script.includes('context.message') || profile.script.includes('message');
  }
  
  // Touch mode - check if any step has text input
  if (profile.steps && Array.isArray(profile.steps)) {
    return profile.steps.some(step => 
      step.action === 'type' || step.action === 'send' || 
      (step.label && step.label.toLowerCase().includes('prompt'))
    );
  }
  
  // Default: don't require prompt if no text elements found
  return false;
}

// Run touch workflow directly from Builder tab without saving
async function runBuilderTouchWorkflow() {
  const workflowMode = document.getElementById('builderWorkflowMode').value;
  const url = document.getElementById('builderUrl').value.trim();
  const steps = builderSteps;
  
  if (workflowMode !== 'touch') {
    addLog('Switch to Touch mode to run touch workflows', 'warn');
    return;
  }
  
  if (!steps || steps.length === 0) {
    addLog('Please add at least one step to the workflow', 'error');
    return;
  }
  
  if (!url) {
    addLog('Please enter a URL to navigate to', 'error');
    return;
  }
  
  addLog('▶ Running touch workflow from Builder...', 'info');
  setRunning(true);
  
  try {
    // Navigate to URL first
    await fetch('/browser/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    
    addLog(`✅ Navigated to ${url}`, 'success');
    
    // Execute all steps
    for (let i = 0; i < steps.length; i++) {
      if (isRunning === false) {
        addLog('⏹ Stopped by user', 'warn');
        break;
      }
      
      const step = steps[i];
      updateProgress(i + 1, steps.length, step.label || step.action);
      addLog(`⚙ Step ${i + 1}: ${step.label || step.action}`, 'info');
      
      try {
        // Execute individual step actions
        switch (step.action) {
          case 'click':
            await fetch('/browser/click', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ x: step.x, y: step.y })
            });
            break;
          case 'type':
            await fetch('/browser/type', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: step.text, delay: step.delay || 30 })
            });
            break;
          case 'keypress':
            await fetch('/browser/keypress', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: step.key })
            });
            break;
          case 'scroll':
            await fetch('/browser/scroll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deltaY: step.deltaY || 300 })
            });
            break;
          case 'wait':
            await fetch('/browser/wait', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ms: step.ms || 1000 })
            });
            break;
          case 'copy':
            await fetch('/browser/copy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ selector: step.selector })
            });
            break;
          case 'read':
            await fetch('/browser/read', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ x: step.x, y: step.y })
            });
            break;
        }
        addLog(`  ✓ ${step.label || step.action}`, 'success');
      } catch (stepErr) {
        addLog(`  ✗ Error: ${stepErr.message}`, 'error');
      }
      
      await new Promise(r => setTimeout(r, 80));
    }
    
    addLog('✅ Touch workflow completed successfully', 'success');
  } catch (e) {
    addLog('Error: ' + e.message, 'error');
  } finally {
    setRunning(false);
    hideProgress();
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

async function copyResponse() {
  const text = document.getElementById('responseBox')?.textContent || '';
  // Try modern clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      addLog('Response copied', 'info');
      return;
    } catch (e) {
      addLog('Clipboard API failed: ' + (e && e.message ? e.message : e), 'warn');
    }
  }

  // Fallback: use a temporary textarea and execCommand
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) addLog('Response copied (fallback)', 'info');
    else addLog('Copy failed', 'error');
  } catch (e) {
    addLog('Copy failed: ' + (e && e.message ? e.message : e), 'error');
  }
}

async function copyBuilderResponse() {
  const text = document.getElementById('builderResponseBox')?.textContent || '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      addLog('Builder output copied', 'info');
      return;
    } catch (e) {
      addLog('Clipboard API failed: ' + (e && e.message ? e.message : e), 'warn');
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) addLog('Builder output copied (fallback)', 'info');
    else addLog('Copy failed', 'error');
  } catch (e) {
    addLog('Copy failed: ' + (e && e.message ? e.message : e), 'error');
  }
}

function setBuilderResponse(text) {
  const box = document.getElementById('builderResponseBox');
  if (!box) return;
  box.textContent = text;
  box.scrollTop = box.scrollHeight;
}

// ── BUILDER ───────────────────────────────────────────────
function loadBuilderFromProfile(profile) {
  document.getElementById('builderName').value = profile.name || '';
  document.getElementById('builderUrl').value = profile.url || '';
  const workflowMode = profile.workflowMode || 'touch';
  document.getElementById('builderWorkflowMode').value = workflowMode;
  builderWorkflowMode = workflowMode;
  
  if (workflowMode === 'js') {
    // JS mode: load provider, command, script source and code
    if (profile.provider) document.getElementById('builderProvider').value = profile.provider;
    if (profile.scriptSource) {
      builderScriptSource = profile.scriptSource;
      document.getElementById('builderScriptSource').value = profile.scriptSource;
    } else {
      builderScriptSource = profile.script ? 'custom' : 'provider';
      document.getElementById('builderScriptSource').value = builderScriptSource;
    }
    if (profile.script) document.getElementById('builderScript').value = profile.script;
    updateCommandOptions(profile.provider);
    if (profile.command) document.getElementById('builderCommand').value = profile.command;
    if (profile.chatIndex !== undefined && document.getElementById('builderChatIndex')) {
      document.getElementById('builderChatIndex').value = profile.chatIndex;
    }
    if (profile.imageSize && document.getElementById('builderMediaSize')) {
      document.getElementById('builderMediaSize').value = profile.imageSize;
    }
    if (profile.videoSize && document.getElementById('builderMediaSize')) {
      document.getElementById('builderMediaSize').value = profile.videoSize;
    }
    updateWorkflowModeUI();
  } else {
    // Touch mode: load steps
    builderSteps = JSON.parse(JSON.stringify(profile.steps || []));
    renderStepsList();
    renderBuilderMarkers();
    updateWorkflowModeUI();
  }
  // Keep automation profile selector in sync with the builder
  const profileSelect = document.getElementById('profileSelect');
  if (profileSelect) {
    profileSelect.value = profile.name;
    updateProfileEndpoint(profile);
  }
}

function loadBuilderProfile() {
  const name = document.getElementById('builderName').value.trim();
  if (name) {
    const p = profiles.find(p => p.name === name);
    if (p) loadBuilderFromProfile(p);
    else addLog(`Profile "${name}" not found`, 'warn');
  } else {
    // Show list of all profiles to choose from
    if (profiles.length === 0) {
      addLog('No saved profiles found', 'warn');
      return;
    }
    const profileNames = profiles.map(p => p.name).join('\n');
    const selected = prompt(`Enter profile name to load:\n\n${profileNames}`);
    if (selected) {
      const p = profiles.find(profile => profile.name === selected);
      if (p) {
        loadBuilderFromProfile(p);
        addLog(`Loaded profile "${selected}"`, 'success');
      } else {
        addLog(`Profile "${selected}" not found`, 'error');
      }
    }
  }
}

async function saveBuilderProfile() {
  const nameInput = prompt('Enter profile name:');
  if (!nameInput) return;
  const name = nameInput.trim();
  
  const url = document.getElementById('builderUrl').value.trim();
  
  const workflowMode = document.getElementById('builderWorkflowMode').value;
  const payload = { 
    name, 
    url, 
    workflowMode,
    steps: builderSteps 
  };
  
  // JS mode: include provider, command, script
  if (workflowMode === 'js') {
    payload.provider = document.getElementById('builderProvider').value;
    payload.command = document.getElementById('builderCommand').value;
    payload.scriptSource = document.getElementById('builderScriptSource')?.value || 'provider';
    payload.script = payload.scriptSource === 'custom' ? document.getElementById('builderScript').value : '';
    payload.chatIndex = document.getElementById('builderChatIndex')?.value || '0';
    payload.imageSize = document.getElementById('builderMediaSize')?.value || '';
    payload.videoSize = document.getElementById('builderMediaSize')?.value || '';
    payload.steps = []; // No steps in JS mode
  }
  
  const r = await fetch('/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (r.ok) {
    addLog(`Profile "${name}" saved`, 'success');
    const result = await r.json();
    await loadProfiles();
    const profile = profiles.find(p => p.slug === result.slug || p.name === name);
    if (profile) {
      const profileSelect = document.getElementById('profileSelect');
      if (profileSelect) profileSelect.value = profile.name;
      updateProfileEndpoint(profile);
      loadBuilderFromProfile(profile);
    }
    // Keep current workflow visible - don't reset
    document.getElementById('builderName').value = name;
  } else {
    const err = await r.json().catch(() => ({ error: 'Save failed' }));
    addLog(`Save failed: ${err.error}`, 'error');
  }
}

async function deleteBuilderProfile() {
  const name = document.getElementById('builderName').value.trim();
  if (!name || !confirm(`Delete profile "${name}"?`)) return;
  await fetch('/profiles/' + encodeURIComponent(name), { method: 'DELETE' });
  addLog(`Profile "${name}" deleted`, 'warn');
  await loadProfiles();
  // Clear current workflow after delete
  builderSteps = [];
  renderStepsList();
  document.getElementById('builderName').value = '';
  document.getElementById('builderUrl').value = '';
  document.getElementById('builderScript').value = '';
}

function addBuilderStep(bx, by, px, py) {
  const action = document.getElementById('builderDefaultAction')?.value || 'click';
  const step = {
    id: Date.now(),
    action,
    x: bx,
    y: by,
    label: `${action === 'copy' ? 'Copy output' : action === 'goto' ? 'Goto' : 'Click'} (${bx}, ${by})`
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
    case 'read': return step.selector || step.targetSelector || '';
    case 'goto':
    case 'navigate': return step.url || '';
    case 'evaluate': return 'JS';
    default: return '';
  }
}

// ── BUILDER MARKERS ──────────────────────────────────────
function renderBuilderMarkers() {
  const container = document.getElementById('builderMarkers');
  container.innerHTML = '';
  if (!builderMode || builderWorkflowMode === 'js') return;
  const img = document.getElementById('liveFrame');
  const rect = img.getBoundingClientRect();
  const parentRect = img.parentElement.getBoundingClientRect();
  if (!rect.width) return;
  const scaleX = rect.width / BROWSER_W;
  const scaleY = rect.height / BROWSER_H;
  const clickSteps = builderSteps.filter(s => ['click', 'scroll', 'read', 'copy'].includes(s.action) && s.x !== undefined);
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
      html = `
        <div><label>Click selector (optional)</label><input id="edit-selector" type="text" value="${escAttr(step.selector || '')}" /></div>
        <div><label>Result selector</label><input id="edit-targetSelector" type="text" value="${escAttr(step.targetSelector || '')}" /></div>
        <div class="edit-row">
          <div><label>X</label><input id="edit-x" type="number" value="${step.x || 0}" /></div>
          <div><label>Y</label><input id="edit-y" type="number" value="${step.y || 0}" /></div>
        </div>
        <div class="edit-row">
          <div><label>Wait after click (ms)</label><input id="edit-waitMs" type="number" value="${step.waitMs || 600}" /></div>
          <div><label>Polling</label><input id="edit-polling" type="checkbox" ${step.polling ? 'checked' : ''} /></div>
        </div>
      `;
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
      step.selector = g('edit-selector');
      step.targetSelector = g('edit-targetSelector');
      step.x = gn('edit-x');
      step.y = gn('edit-y');
      step.waitMs = gn('edit-waitMs');
      step.polling = gb('edit-polling');
      break;
    case 'read':
      step.selector = g('edit-selector');
      step.x = gn('edit-x'); step.y = gn('edit-y');
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
  if (box) {
    box.appendChild(entry);
    if (document.getElementById('autoScrollLog')?.checked) box.scrollTop = box.scrollHeight;
    while (box.children.length > 500) box.removeChild(box.firstChild);
  }
  const fbox = document.getElementById('floatingLogBox');
  if (fbox) {
    const fentry = entry.cloneNode(true);
    fbox.appendChild(fentry);
    fbox.scrollTop = fbox.scrollHeight;
    while (fbox.children.length > 500) fbox.removeChild(fbox.firstChild);
  }
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
// ── WORKFLOW MODE SWITCH ───────────────────────────────────
function setupWorkflowModeSwitch() {
  const modeSelect = document.getElementById('builderWorkflowMode');
  if (!modeSelect) return;
  
  modeSelect.addEventListener('change', () => {
    builderWorkflowMode = modeSelect.value;
    updateWorkflowModeUI();
  });
  
  // Provider selector change
  const providerSelect = document.getElementById('builderProvider');
  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      updateCommandOptions(providerSelect.value);
    });
  }

  const commandSelect = document.getElementById('builderCommand');
  if (commandSelect) {
    commandSelect.addEventListener('change', () => {
      updateCommandExtraFields();
    });
  }

  const scriptSourceSelect = document.getElementById('builderScriptSource');
  if (scriptSourceSelect) {
    scriptSourceSelect.addEventListener('change', () => {
      builderScriptSource = scriptSourceSelect.value;
      updateScriptSourceUI();
    });
  }
}

function updateScriptSourceUI() {
  const source = document.getElementById('builderScriptSource')?.value || builderScriptSource;
  builderScriptSource = source;

  const commandRow = document.getElementById('commandRow');
  const scriptRow = document.getElementById('scriptRow');

  if (source === 'provider') {
    if (commandRow) commandRow.style.display = 'flex';
    if (scriptRow) scriptRow.style.display = 'none';
  } else {
    if (commandRow) commandRow.style.display = 'none';
    if (scriptRow) scriptRow.style.display = 'flex';
  }
}

function updateCommandExtraFields() {
  const command = document.getElementById('builderCommand')?.value;
  const chatIndexRow = document.getElementById('chatIndexRow');
  const qwenMediaSizeRow = document.getElementById('qwenMediaSizeRow');
  const google2faRow = document.getElementById('google2faRow');

  if (chatIndexRow) {
    chatIndexRow.style.display = command === 'gotochat' ? 'flex' : 'none';
  }
  if (qwenMediaSizeRow) {
    qwenMediaSizeRow.style.display = ['qwenimage', 'qwenvideo'].includes(command) ? 'flex' : 'none';
  }
  if (google2faRow) {
    google2faRow.style.display = command === '2fa' ? 'flex' : 'none';
  }
}

function updateWorkflowModeUI() {
  const providerRow = document.getElementById('providerRow');
  const commandRow = document.getElementById('commandRow');
  const chatIndexRow = document.getElementById('chatIndexRow');
  const qwenMediaSizeRow = document.getElementById('qwenMediaSizeRow');
  const scriptSourceRow = document.getElementById('scriptSourceRow');
  const scriptRow = document.getElementById('scriptRow');
  const credentialsRow = document.getElementById('credentialsRow');
  const stepsHeader = document.getElementById('stepsHeader');
  const stepsList = document.getElementById('stepsList');
  const touchModeBtns = document.getElementById('touchModeBtns');
  const jsModeBtns = document.getElementById('jsModeBtns');
  const builderExecuteJsBtn = document.getElementById('builderExecuteJsBtn');
    const builderRunTouchBtn = document.getElementById('builderRunTouchBtn');
  
  if (builderWorkflowMode === 'js') {
    // JS Mode: show provider + source selector, hide steps
    if (providerRow) providerRow.style.display = 'flex';
    if (commandRow) commandRow.style.display = 'flex';
    if (chatIndexRow) chatIndexRow.style.display = 'none';
    if (qwenMediaSizeRow) qwenMediaSizeRow.style.display = 'none';
    if (scriptSourceRow) scriptSourceRow.style.display = 'flex';
    if (stepsHeader) stepsHeader.style.display = 'none';
    if (stepsList) stepsList.style.display = 'none';
    if (touchModeBtns) touchModeBtns.style.display = 'none';
    if (jsModeBtns) jsModeBtns.style.display = 'flex';
    if (builderExecuteJsBtn) builderExecuteJsBtn.style.display = 'inline-block';
      if (builderRunTouchBtn) builderRunTouchBtn.style.display = 'none';
    if (document.getElementById('builderPromptGroup')) document.getElementById('builderPromptGroup').style.display = 'block';
    if (document.getElementById('builderResponseGroup')) document.getElementById('builderResponseGroup').style.display = 'block';

    updateScriptSourceUI();
    updateCommandExtraFields();
    const selectedProvider = document.getElementById('builderProvider')?.value;
    if (credentialsRow) credentialsRow.style.display = selectedProvider ? 'flex' : 'none';
  } else {
    // Touch Mode: show steps, hide script/provider
    if (providerRow) providerRow.style.display = 'none';
    if (commandRow) commandRow.style.display = 'none';
    if (scriptSourceRow) scriptSourceRow.style.display = 'none';
    if (scriptRow) scriptRow.style.display = 'none';
    if (credentialsRow) credentialsRow.style.display = 'none';
    if (document.getElementById('builderPromptGroup')) document.getElementById('builderPromptGroup').style.display = 'none';
    if (document.getElementById('builderResponseGroup')) document.getElementById('builderResponseGroup').style.display = 'none';
    if (stepsHeader) stepsHeader.style.display = 'flex';
    if (stepsList) stepsList.style.display = 'block';
    // Show Touch buttons, hide JS button
    if (touchModeBtns) touchModeBtns.style.display = 'flex';
    if (jsModeBtns) jsModeBtns.style.display = 'none';
    if (builderExecuteJsBtn) builderExecuteJsBtn.style.display = 'none';
    if (builderRunTouchBtn) builderRunTouchBtn.style.display = 'inline-block';
  }
}

function updateCommandOptions(provider) {
  const commandSelect = document.getElementById('builderCommand');
  const credentialsRow = document.getElementById('credentialsRow');
  if (!commandSelect || !provider) {
    if (commandSelect) commandSelect.innerHTML = '<option value="">-- Select Command --</option>';
    if (credentialsRow) credentialsRow.style.display = 'none';
    return;
  }
  
  // Load available commands for this provider
  const commands = {
    deepseek: ['newchat', 'gotochat', 'getchats', 'prompt', 'login'],
    qwen: ['newchat', 'gotochat', 'getchats', 'prompt', 'qwenimage', 'qwenvideo'],
    chatgpt: ['newchat', 'gotochat', 'getchats', 'prompt'],
    claude: ['newchat', 'gotochat', 'getchats', 'promptui'],
    gemini: ['newchat', 'gotochat', 'getchats'],
    google: ['login', '2fa']
  };
  
  const cmds = commands[provider] || [];
  commandSelect.innerHTML = '<option value="">-- Select Command --</option>' + 
    cmds.map(c => `<option value="${c}">${c}</option>`).join('');
  
  // Show credentials row for providers that support login
  const providersWithLogin = ['deepseek', 'google'];
  if (credentialsRow) {
    credentialsRow.style.display = providersWithLogin.includes(provider) ? 'flex' : 'none';
  }
  
  // Update any command-specific helper controls
  updateCommandExtraFields();
  
  // Load saved credentials for this provider
  loadProviderCredentials(provider);
}

// Provider Credentials Functions
async function saveProviderCredentials() {
  const provider = document.getElementById('builderProvider').value;
  if (!provider) {
    alert('Please select a provider first');
    return;
  }
  
  const email = document.getElementById('providerEmail').value;
  const password = document.getElementById('providerPassword').value;
  const apiKey = document.getElementById('providerApiKey').value;
  
  try {
    const response = await fetch('/provider-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, email, password, apiKey })
    });
    
    const result = await response.json();
    if (result.ok) {
      alert(`✅ Credentials saved for ${provider}`);
      document.getElementById('providerPassword').value = '';
    } else {
      alert(`❌ Error: ${result.error}`);
    }
  } catch (e) {
    alert(`❌ Failed to save credentials: ${e.message}`);
  }
}

async function loadProviderCredentials(provider) {
  if (!provider) return;
  
  try {
    const response = await fetch(`/provider-credentials/${provider}`);
    if (response.ok) {
      const data = await response.json();
      if (data.email) document.getElementById('providerEmail').value = data.email;
      if (data.api_key) document.getElementById('providerApiKey').value = data.api_key;
      // Never populate password field for security
    }
  } catch (e) {
    console.log('Could not load provider credentials:', e.message);
  }
}
