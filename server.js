const puppeteer = require('puppeteer-core');
const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware for Replit compatibility
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data:;");
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.use(express.json());
// ✅ Serve static files with explicit paths
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use(express.static(__dirname));

// ✅ Explicit root route for Replit
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let browser = null;
let page = null;
let isRunning = false;
let shouldStop = false;
const PROFILES_FILE = path.join(__dirname, 'profiles.json');
const VIEWPORT = { width: 1280, height: 720 };
const logClients = new Set();

function broadcast(type, data) {
  const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const res of logClients) {
    try { res.write(msg); } catch (_) {}
  }
}

function log(message, level = 'info') {
  console.log(`[${level.toUpperCase()}] ${message}`);
  broadcast('log', { message, level, time: new Date().toISOString() });
}

function getDefaultProfiles() {
  return [
    {
      name: 'DeepSeek Send',
      url: 'https://chat.deepseek.com',
      steps: [
        { id: 1, action: 'click', x: 443, y: 558, label: 'Click textarea' },
        { id: 2, action: 'type', text: '{{prompt}}', delay: 30, label: 'Type prompt' },
        { id: 3, action: 'wait', ms: 1000, label: 'Wait' },
        { id: 4, action: 'send', text: '', delay: 30, label: 'Send message (Enter)' }
      ]
    },
    {
      name: 'Qwen Send',
      url: 'https://tongyi.aliyun.com/qianwen/',
      steps: [
        { id: 1, action: 'click', x: 640, y: 650, label: 'Click input' },
        { id: 2, action: 'type', text: '{{prompt}}', delay: 30, label: 'Type prompt' },
        { id: 3, action: 'wait', ms: 400, label: 'Pause' },
        { id: 4, action: 'send', text: '', delay: 30, label: 'Send via Enter' },
        { id: 5, action: 'wait', ms: 5000, label: 'Wait for response' },
        { id: 6, action: 'copy', selector: '[class*="message"]:last-child', label: 'Copy response' }
      ]
    }
  ];
}

function loadProfiles() {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      let raw = fs.readFileSync(PROFILES_FILE, 'utf8');
      raw = raw.replace(/"(\w+)\s*"\s*:/g, '"$1":');
      return JSON.parse(raw);
    }
  } catch (e) {
    log(`Error loading profiles: ${e.message}`, 'error');
  }
  return getDefaultProfiles();
}

function saveProfiles(profiles) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function getChromiumPath() {
  const candidates = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const cmd of candidates) {
    try {
      return execSync(`which ${cmd}`).toString().trim();
    } catch (_) {}
  }
  try {
    const nixPath = execSync('ls -d /nix/store/*chromium-* 2>/dev/null | head -n 1').toString().trim();
    if (nixPath) return `${nixPath}/bin/chromium`;
  } catch (_) {}
  return '/usr/bin/chromium';
}

async function ensureBrowser() {
  if (browser && browser.isConnected()) return;
  const exePath = getChromiumPath();
  log(`Launching Chromium: ${exePath}`);
  browser = await puppeteer.launch({
    executablePath: exePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,720',
      '--disable-blink-features=AutomationControlled',
      `--user-agent=${UA}`
    ],
    defaultViewport: VIEWPORT,
    ignoreDefaultArgs: ['--enable-automation']
  });
  browser.on('disconnected', () => { browser = null; page = null; log('Browser disconnected', 'warn'); });
}

async function ensurePage() {
  await ensureBrowser();
  if (page && !page.isClosed()) return page;
  const pages = await browser.pages();
  page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(UA);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });
  return page;
}

async function executeStep(step, context) {
  const p = page;
  const label = step.label ? `[${step.label}]` : '';
  try {
    switch (step.action) {
      case 'navigate':
        log(`Navigate → ${step.url}${label}`);
        await p.goto(step.url, { waitUntil: 'networkidle2', timeout: 30000 });
        break;

      case 'click':
        if (step.selector) {
          await p.click(step.selector);
          log(`Click selector: ${step.selector}${label}`);
        } else {
          await p.mouse.click(Number(step.x), Number(step.y));
          log(`Click at (${step.x}, ${step.y})${label}`);
        }
        break;

      case 'type': {
        const text = (step.text || '').replace(/\{\{prompt\}\}/g, context.prompt || '');
        log(`Type: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"${label}`);
        await p.keyboard.type(text, { delay: step.delay || 30 });
        break;
      }

      case 'keypress':
        await p.keyboard.press((step.key || 'Enter').trim());
        log(`Key: ${step.key || 'Enter'}${label}`);
        break;

      // ✅ FIXED: Send action - types optional text THEN presses Enter (matches manual UI)
      case 'send': {
        const text = (step.text || '').replace(/\{\{prompt\}\}/g, context.prompt || '');
        const delay = step.delay || 30;
        if (text) {
          log(`Send: typing "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"${label}`);
          await p.keyboard.type(text, { delay });
        } else {
          log(`Send: pressing Enter only${label}`);
        }
        await p.keyboard.press('Enter');
        log(`Send complete${label}`);
        break;
      }

      case 'scroll':
        log(`Scroll Δ(${step.deltaX || 0}, ${step.deltaY || 300})${label}`);
        await p.mouse.move(Number(step.x || 640), Number(step.y || 360));
        await p.mouse.wheel({ deltaX: Number(step.deltaX || 0), deltaY: Number(step.deltaY || 300) });
        break;

      case 'wait':
        log(`Wait ${step.ms || 1000}ms ${label}`);
        await new Promise(r => setTimeout(r, Number(step.ms || 1000)));
        break;

      case 'waitSelector':
        log(`Wait for selector: ${step.selector}${label}`);
        try { await p.waitForSelector(step.selector, { timeout: step.timeout || 30000 }); }
        catch (e) { if (!step.optional) throw e; log(`Optional selector missing`, 'warn'); }
        break;

      case 'waitSelectorGone':
        log(`Wait gone: ${step.selector}${label}`);
        await p.waitForFunction(sel => !document.querySelector(sel), { timeout: step.timeout || 120000, polling: 1000 }, step.selector);
        break;

      case 'copy': {
        log(`Copy: ${step.selector}${label}`);
        const selectors = (step.selector || '').split(',').map(s => s.trim());
        let text = '';
        for (const sel of selectors) {
          try {
            text = await p.evaluate(s => {
              const els = document.querySelectorAll(s);
              return els.length ? (els[els.length - 1].innerText || els[els.length - 1].textContent || '') : '';
            }, sel);
            if (text.trim()) break;
          } catch (_) {}
        }
        context.result = text;
        log(`Copied ${text.length} chars`);
        broadcast('response', { text });
        break;
      }

      case 'read': {
        log(`Read${step.selector ? ' selector: ' + step.selector : ' at (' + step.x + ',' + step.y + ')'}${label}`);
        let text = '';
        if (step.selector) {
          text = await p.evaluate(sel => {
            const el = document.querySelector(sel);
            return el ? (el.innerText || el.textContent || '') : '';
          }, step.selector);
        } else {
          text = await p.evaluate((x, y) => {
            const el = document.elementFromPoint(x, y);
            return el ? (el.innerText || el.textContent || '') : '';
          }, Number(step.x || 640), Number(step.y || 360));
        }
        context.result = text;
        log(`Read ${text.length} chars`);
        broadcast('response', { text });
        break;
      }

      case 'evaluate': {
        log(`Evaluate${label}`);
        const result = await p.evaluate(new Function(`return (${step.script})()`));
        if (result !== undefined) {
          context.result = String(result);
          broadcast('response', { text: context.result });
        }
        break;
      }

      default:
        log(`Unknown action: ${step.action}`, 'warn');
    }
  } catch (err) {
    log(`Step failed: ${err.message}`, 'error');
    throw err;
  }
}

async function runProfile(profileName, prompt) {
  const profiles = loadProfiles();
  const profile = profiles.find(p => p.name === profileName);
  if (!profile) throw new Error(`Profile not found: ${profileName}`);

  isRunning = true;
  shouldStop = false;
  const context = { prompt, result: '' };
  try {
    log(`▶ Starting: ${profileName}`);
    broadcast('status', { running: true });
    await ensurePage();

    if (profile.url) {
      let currentUrl = '';
      try { currentUrl = page.url(); } catch (_) {}
      const targetHost = new URL(profile.url).hostname;
      if (!currentUrl.includes(targetHost)) {
        log(`Navigating to ${profile.url}`);
        await page.goto(profile.url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    for (let i = 0; i < profile.steps.length; i++) {
      if (shouldStop) { log('⏹ Stopped by user', 'warn'); break; }
      const step = profile.steps[i];
      broadcast('step', { index: i, total: profile.steps.length, label: step.label || step.action });
      await executeStep(step, context);
      await new Promise(r => setTimeout(r, 80));
    }
    log(`✓ Automation complete`);
    return context.result;
  } finally {
    isRunning = false;
    broadcast('status', { running: false });
  }
}

// ── ROUTES ────────────────────────────────────────────────
app.get('/screenshot', async (req, res) => {
  try {
    await ensurePage();
    const buf = await page.screenshot({ type: 'jpeg', quality: 75, fullPage: false });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/browser/url', async (req, res) => {
  try { res.json({ url: page ? page.url() : 'about:blank' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/navigate', async (req, res) => {
  try {
    const { url } = req.body;
    await ensurePage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    res.json({ ok: true, url: page.url() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/click', async (req, res) => {
  try {
    const { x, y, button = 'left' } = req.body;
    await ensurePage();
    await page.mouse.click(Number(x), Number(y), { button });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/type', async (req, res) => {
  try {
    const { text, delay = 30 } = req.body;
    await ensurePage();
    await page.keyboard.type(text, { delay });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/keypress', async (req, res) => {
  try {
    const { key } = req.body;
    await ensurePage();
    await page.keyboard.press(key);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/scroll', async (req, res) => {
  try {
    const { x = 640, y = 360, deltaX = 0, deltaY = 300 } = req.body;
    await ensurePage();
    await page.mouse.move(Number(x), Number(y));
    await page.mouse.wheel({ deltaX: Number(deltaX), deltaY: Number(deltaY) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/copy', async (req, res) => {
  try {
    const { selector } = req.body;
    await ensurePage();
    const text = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      return el ? (el.innerText || el.textContent || '') : '';
    }, selector);
    res.json({ ok: true, text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/read', async (req, res) => {
  try {
    const { selector, x, y } = req.body;
    await ensurePage();
    let text = '';
    if (selector) {
      text = await page.evaluate(sel => {
        const el = document.querySelector(sel);
        return el ? (el.innerText || el.textContent || '') : '';
      }, selector);
    } else {
      text = await page.evaluate((px, py) => {
        const el = document.elementFromPoint(px, py);
        return el ? (el.innerText || el.textContent || '') : '';
      }, Number(x || 640), Number(y || 360));
    }
    res.json({ ok: true, text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/wait', async (req, res) => {
  try {
    const { ms, selector, timeout } = req.body;
    await ensurePage();
    if (selector) await page.waitForSelector(selector, { timeout: timeout || 30000 });
    else await new Promise(r => setTimeout(r, Number(ms || 1000)));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/send', async (req, res) => {
  try {
    const { text, selector, pressEnter = true } = req.body;
    await ensurePage();
    if (selector) {
      await page.click(selector);
      if (text) await page.type(selector, text, { delay: 30 });
    } else if (text) {
      await page.keyboard.type(text, { delay: 30 });
    }
    if (pressEnter) await page.keyboard.press('Enter');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/browser/evaluate', async (req, res) => {
  try {
    const { script } = req.body;
    await ensurePage();
    const result = await page.evaluate(script);
    res.json({ ok: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Profiles
app.get('/profiles', (req, res) => res.json(loadProfiles()));
app.post('/profiles', (req, res) => {
  const profiles = loadProfiles();
  const { name, url, steps } = req.body;
  const idx = profiles.findIndex(p => p.name === name);
  if (idx >= 0) profiles[idx] = { name, url, steps };
  else profiles.push({ name, url, steps });
  saveProfiles(profiles);
  res.json({ ok: true });
});
app.delete('/profiles/:name', (req, res) => {
  let profiles = loadProfiles();
  profiles = profiles.filter(p => p.name !== decodeURIComponent(req.params.name));
  saveProfiles(profiles);
  res.json({ ok: true });
});

// Automation
app.post('/run', async (req, res) => {
  if (isRunning) return res.status(409).json({ error: 'Already running' });
  const { profile, prompt } = req.body;
  runProfile(profile, prompt)
    .then(result => broadcast('done', { result }))
    .catch(e => { log(`Error: ${e.message}`, 'error'); broadcast('error', { message: e.message }); });
  res.json({ ok: true });
});

app.post('/stop', (req, res) => {
  shouldStop = true;
  log('Stop requested', 'warn');
  res.json({ ok: true });
});

app.post('/ask', async (req, res) => {
  const { message, profile = 'DeepSeek Send' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  if (isRunning) return res.status(409).json({ error: 'Bot is busy' });
  try {
    const reply = await runProfile(profile, message);
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/status', (req, res) => {
  res.json({
    running: isRunning,
    url: page ? page.url() : null,
    browserConnected: !!(browser && browser.isConnected())
  });
});

// SSE Logs
app.get('/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('data: {"type":"connected"}\n\n');
  logClients.add(res);
  req.on('close', () => logClients.delete(res));
});

// Start Server
(async () => {
  if (!fs.existsSync(PROFILES_FILE)) saveProfiles(getDefaultProfiles());
  await ensurePage();
  log('Browser ready');
  app.listen(PORT, '0.0.0.0', () => log(`Server running on port ${PORT}`));
})().catch(err => {
  log(`Fatal startup error: ${err.message}`, 'error');
  process.exit(1);
});