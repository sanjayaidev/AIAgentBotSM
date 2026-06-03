const puppeteer = require('puppeteer');
const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client, Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.PG_CONNECTION_STRING;
const USE_POSTGRES = Boolean(DATABASE_URL);
const API_KEY = process.env.API_KEY || process.env.BOT_API_KEY || '';
const EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || process.env.CHROME_PATH;
const HEADLESS = process.env.PUPPETEER_HEADLESS
  ? process.env.PUPPETEER_HEADLESS.toLowerCase() === 'true'
  : !process.env.DISPLAY;
const SELF_PING_URL = process.env.SELF_PING_URL || process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || `http://localhost:${PORT}`;
const SELF_PING_PATH = process.env.SELF_PING_PATH || '/status';
const puppeteerExtra = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(stealth());

// Database clients
let dbClient = null;

async function initDatabase() {
  if (!USE_POSTGRES) return;
  
  try {
    // Faster connection with lazy initialization
    dbClient = new Pool({ 
      connectionString: DATABASE_URL, 
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,  // Faster timeout
      allowExitOnIdle: true
    });
    
    // Test connection first
    await dbClient.query('SELECT 1');
    
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        slug text PRIMARY KEY,
        name text NOT NULL,
        url text,
        workflow_mode text DEFAULT 'touch',
        steps jsonb DEFAULT '[]'::jsonb,
        provider text,
        command text,
        script text,
        script_source text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        profile_name text PRIMARY KEY,
        cookies jsonb NOT NULL,
        storage jsonb NOT NULL,
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS runs (
        id serial PRIMARY KEY,
        profile_slug text,
        profile_name text,
        prompt text,
        result text,
        status text,
        error text,
        duration_ms int,
        workflow_mode text,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS data_store (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS provider_credentials (
        id serial PRIMARY KEY,
        provider text NOT NULL UNIQUE,
        email text,
        password text,
        api_key text,
        metadata jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
    `);
    await dbClient.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS script_source text;`);
    await dbClient.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS workflow_mode text;`);
    log('✅ Connected to PostgreSQL database');
  } catch (error) {
    log('❌ Database connection failed:', error.message);
    throw error;
  }
}

async function ensureProfileStore() {
  if (USE_POSTGRES) {
    const { rows } = await dbClient.query('SELECT count(*)::int AS count FROM profiles');
    if (rows[0].count === 0) {
      await saveProfiles(getDefaultProfiles());
    }
  } else if (!fs.existsSync(PROFILES_FILE)) {
    await saveProfiles(getDefaultProfiles());
  }
}

async function loadProfilesFromDb() {
  const result = await dbClient.query('SELECT slug, name, url, workflow_mode, steps, provider, command, script, script_source FROM profiles ORDER BY name');
  return assignProfileSlugs(result.rows.map(row => ({
    slug: row.slug,
    name: row.name,
    url: row.url,
    workflowMode: row.workflow_mode || 'touch', provider: row.provider || null, command: row.command || null,
    script: row.script || null, scriptSource: row.script_source || 'provider',
    steps: row.steps || []
  })));
}

async function saveProfilesToDb(profiles) {
  const sanitized = profiles.map(profile => ({ 
    ...profile, 
    slug: slugify(profile.name),
    workflowMode: profile.workflowMode || 'touch',
    steps: (() => {
      try {
        if (Array.isArray(profile.steps)) return profile.steps;
        if (typeof profile.steps === 'string') return JSON.parse(profile.steps);
      } catch (_) {
        // fall through
      }
      return [];
    })()
  }));
  await dbClient.query('BEGIN');
  try {
    for (const profile of sanitized) {
      await dbClient.query(
        `INSERT INTO profiles (slug, name, url, workflow_mode, steps, provider, command, script, script_source, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name, url = EXCLUDED.url, workflow_mode = EXCLUDED.workflow_mode, 
             steps = EXCLUDED.steps, provider = EXCLUDED.provider, command = EXCLUDED.command, 
             script = EXCLUDED.script, script_source = EXCLUDED.script_source, updated_at = now()`,
        [profile.slug, profile.name, profile.url, profile.workflowMode, JSON.stringify(profile.steps), profile.provider, profile.command, profile.script, profile.scriptSource || 'provider']
      );
    }
    const slugs = sanitized.map(p => p.slug);
    if (slugs.length) {
      const placeholders = slugs.map((_, i) => `$${i + 1}`).join(',');
      await dbClient.query(`DELETE FROM profiles WHERE slug NOT IN (${placeholders})`, slugs);
    } else {
      await dbClient.query('DELETE FROM profiles');
    }
    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  }
}

async function loadSessionFromDb(profileName) {
  const result = await dbClient.query('SELECT cookies, storage FROM sessions WHERE profile_name = $1', [profileName]);
  return result.rows[0] || null;
}

async function saveSessionToDb(profileName, cookies, storage) {
  await dbClient.query(
    `INSERT INTO sessions (profile_name, cookies, storage, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (profile_name) DO UPDATE SET cookies = EXCLUDED.cookies, storage = EXCLUDED.storage, updated_at = now()`,
    [profileName, cookies, storage]
  );
}

async function recordRunHistory({ profileSlug, profileName, prompt, result, status, error, durationMs, workflowMode }) {
  if (!USE_POSTGRES || !dbClient) return;
  try {
    await dbClient.query(
      `INSERT INTO runs (profile_slug, profile_name, prompt, result, status, error, duration_ms, workflow_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [profileSlug, profileName, prompt, result, status, error, durationMs, workflowMode || 'js']
    );
  } catch (e) {
    log(`Run history save failed: ${e.message}`, 'warn');
  }
}

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function assignProfileSlugs(profiles) {
  const seen = new Map();
  return profiles.map(profile => {
    const base = slugify(profile.name || 'profile');
    let slug = base || 'profile';
    let suffix = 1;
    while (seen.has(slug)) {
      slug = `${base}-${suffix++}`;
    }
    seen.set(slug, true);
    return { ...profile, slug };
  });
}

async function getProfileBySlug(slug) {
  const profiles = await loadProfiles();
  return profiles.find(p => p.slug === slug || p.name === slug);
}

function getDefaultProfiles() {
  return assignProfileSlugs([
    {
      name: 'Generic JS Workflow',
      url: '',
      workflowMode: 'js',
      steps: [
        { id: 1, action: 'navigate', url: 'https://example.com', label: 'Navigate to URL' },
        { id: 2, action: 'waitSelector', selector: 'body', timeout: 5000, label: 'Wait for page load' },
        { id: 3, action: 'type', selector: 'textarea, input[type="text"]', text: '{{prompt}}', delay: 30, label: 'Type prompt' },
        { id: 4, action: 'keypress', key: 'Enter', label: 'Send message' },
        { id: 5, action: 'wait', ms: 3000, label: 'Wait for response' },
        { id: 6, action: 'copy', selector: '[class*="message"], [class*="response"], article', polling: true, label: 'Copy response' }
      ]
    },
    {
      name: 'Generic Touch Workflow',
      url: '',
      workflowMode: 'touch',
      steps: [
        { id: 1, action: 'navigate', url: 'https://example.com', label: 'Navigate to URL' },
        { id: 2, action: 'wait', ms: 2000, label: 'Wait for page load' },
        { id: 3, action: 'click', x: 640, y: 400, label: 'Click input area' },
        { id: 4, action: 'type', text: '{{prompt}}', delay: 30, label: 'Type prompt' },
        { id: 5, action: 'click', x: 900, y: 650, label: 'Click send button' },
        { id: 6, action: 'wait', ms: 3000, label: 'Wait for response' },
        { id: 7, action: 'read', x: 640, y: 300, label: 'Read response' }
      ]
    }
  ]);
}

// Session storage path
const SESSION_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

async function saveSession(profileName) {
  const cookies = await page.cookies();
  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage))
  }));

  if (USE_POSTGRES) {
    try {
      await saveSessionToDb(profileName, cookies, storage);
      log(`💾 Session saved to DB for ${profileName}`);
      return;
    } catch (e) {
      log(`DB session save failed: ${e.message}`, 'warn');
    }
  }

  fs.writeFileSync(
    path.join(SESSION_DIR, `${profileName.replace(/\s+/g, '_')}.json`),
    JSON.stringify({ cookies, storage }, null, 2)
  );
  log(`💾 Session saved for ${profileName}`);
}

async function loadSession(profileName) {
  let data = null;

  if (USE_POSTGRES) {
    try {
      data = await loadSessionFromDb(profileName);
    } catch (e) {
      log(`DB session load failed: ${e.message}`, 'warn');
    }
  }

  if (!data) {
    const sessionFile = path.join(SESSION_DIR, `${profileName.replace(/\s+/g, '_')}.json`);
    if (!fs.existsSync(sessionFile)) return false;
    data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  }

  if (!data || !Array.isArray(data.cookies) || !data.storage) return false;
  await page.setCookie(...data.cookies);
  await page.evaluateOnNewDocument(storage => {
    Object.entries(storage.local || {}).forEach(([key, value]) => localStorage.setItem(key, value));
    Object.entries(storage.session || {}).forEach(([key, value]) => sessionStorage.setItem(key, value));
  }, data.storage);
  log(`🔓 Session loaded for ${profileName}`);
  return true;
}
// ✅ Middleware for Replit compatibility
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data:;");
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const host = req.headers.host;
    return originUrl.host === host;
  } catch (_) {
    return false;
  }
}

function getApiKeyFromRequest(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.headers['x-api-key'] || req.query.api_key || '';
}

function requireApiKey(req, res, next) {
  if (!API_KEY || sameOrigin(req)) return next();
  const key = getApiKeyFromRequest(req);
  if (key === API_KEY) return next();
  return res.status(401).json({ error: 'API key required' });
}

app.use(express.json());
const STATIC_ROOT = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(__dirname);
app.use(express.static(STATIC_ROOT));
app.get('/', (req, res) => {
  res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});

let browser = null;
let page = null;
let isRunning = false;
let shouldStop = false;
let pingInterval = null;
let lastResponse = { text: '', timestamp: null, profileName: '', prompt: '' };
let lastCopyBotResponseEvent = null;
const PROFILES_FILE = path.join(__dirname, 'profiles.json');
const VIEWPORT = { width: 1280, height: 720 };
const logClients = new Set();
const PING_INTERVAL = process.env.PING_INTERVAL || 5 * 60 * 1000; // 5 minutes default

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

function startSelfPinger() {
  if (pingInterval) clearInterval(pingInterval);
  let baseUrl = SELF_PING_URL.replace(/\/$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;
  const urlObj = new URL(baseUrl);
  const pingUrl = urlObj.pathname === '/' ? `${baseUrl}${SELF_PING_PATH}` : baseUrl;
  const getClient = urlObj.protocol === 'https:' ? require('https') : require('http');

  pingInterval = setInterval(async () => {
    try {
      getClient.get(pingUrl, (res) => {
        if (res.statusCode === 200) {
          log(`🔄 Self-ping successful (${new Date().toLocaleTimeString()})`);
        } else {
          log(`⚠️  Self-ping returned ${res.statusCode}`, 'warn');
        }
      }).on('error', (err) => {
        log(`⚠️  Self-ping failed: ${err.message}`, 'warn');
      });
    } catch (err) {
      log(`Self-ping error: ${err.message}`, 'error');
    }
  }, PING_INTERVAL);
  log(`✅ Self-pinger started (interval: ${PING_INTERVAL / 1000}s, url: ${pingUrl})`);
}

function saveLastResponse(text, profileName, prompt) {
  lastResponse = {
    text,
    timestamp: new Date().toISOString(),
    profileName,
    prompt
  };
  log(`💾 Response saved: ${profileName}`);
}

function normalizeExtractedText(text, context) {
  if (!text) return '';
  let cleaned = String(text).trim();
  if (!context || !context.prompt) return cleaned;
  const prompt = String(context.prompt).trim();
  if (!prompt) return cleaned;

  const promptIndex = cleaned.indexOf(prompt);
  if (promptIndex === 0) {
    cleaned = cleaned.slice(prompt.length).trim();
  } else if (promptIndex > 0) {
    const prefix = cleaned.slice(0, promptIndex).trim();
    if (!prefix || prefix.length < 80) {
      cleaned = cleaned.slice(promptIndex + prompt.length).trim();
    }
  }
  return cleaned;
}

async function loadProfiles() {
  if (USE_POSTGRES) {
    try {
      const profiles = await loadProfilesFromDb();
      if (profiles.length) return profiles;
    } catch (e) {
      log(`DB profile load failed: ${e.message}`, 'error');
    }
  }

  try {
    if (fs.existsSync(PROFILES_FILE)) {
      let raw = fs.readFileSync(PROFILES_FILE, 'utf8');
      raw = raw.replace(/"(\w+)\s*"\s*:/g, '"$1":');
      const profiles = JSON.parse(raw);
      return assignProfileSlugs(Array.isArray(profiles) ? profiles : []);
    }
  } catch (e) {
    log(`Error loading profiles: ${e.message}`, 'error');
  }
  return getDefaultProfiles();
}

async function saveProfiles(profiles) {
  const sanitized = profiles.map(profile => ({ ...profile, slug: slugify(profile.name) }));
  if (USE_POSTGRES) {
    try {
      await saveProfilesToDb(sanitized);
      return;
    } catch (e) {
      log(`DB profile save failed: ${e.message}`, 'error');
    }
  }
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(sanitized, null, 2));
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function getChromiumPath() {
  if (EXECUTABLE_PATH) {
    return EXECUTABLE_PATH;
  }
  if (process.env.RENDER) {
    return '/usr/bin/chromium';
  }
  try {
    const nixPath = execSync('ls -d /nix/store/*chromium-* 2>/dev/null | head -n 1').toString().trim();
    if (nixPath) return `${nixPath}/bin/chromium`;
  } catch (_) {}
  const candidates = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const cmd of candidates) {
    try {
      return execSync(`which ${cmd}`).toString().trim();
    } catch (_) {}
  }
  return '/usr/bin/chromium';
}

async function ensureBrowser() {
  if (browser && browser.isConnected()) return;
  const exePath = getChromiumPath();
  log(`Launching Chromium: ${exePath}`);

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-background-networking',
      '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-features=site-per-process,TranslateUI',
      '--disable-software-rasterizer'
    ],
    defaultViewport: VIEWPORT,
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
    pipe: true,
    timeout: 60000
  };

  if (exePath) {
    launchOptions.executablePath = exePath;
  }

  try {
    browser = await puppeteerExtra.launch(launchOptions);
  } catch (err) {
    if (exePath) {
      log(`Failed to launch browser at ${exePath}: ${err.message}`, 'warn');
      log('Retrying launch without explicit executablePath');
      delete launchOptions.executablePath;
      browser = await puppeteerExtra.launch(launchOptions);
    } else {
      throw err;
    }
  }

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
  // Ensure the page is focused so input events from Puppeteer are delivered
  try { await page.bringToFront(); } catch (e) { /* noop */ }
  installAnalyticsInterceptor(page);
  return page;
}

function installAnalyticsInterceptor(page) {
  if (!page || page.__analyticsInterceptorInstalled) return;
  page.__analyticsInterceptorInstalled = true;
  page.on('request', async request => {
    if (request.method() !== 'POST') return;
    const url = request.url();
    if (!url.includes('gator.volces.com/list')) return;
    const postData = request.postData();
    if (!postData) return;
    try {
      const payload = JSON.parse(postData);
      const event = Array.isArray(payload) && payload[0]?.events?.[0];
      if (event?.event === 'copyBotResponse') {
        const outputText = await captureLastChatText(page);
        lastCopyBotResponseEvent = {
          event,
          payload,
          url,
          outputText,
          timestamp: new Date().toISOString()
        };
        if (outputText) {
          saveLastResponse(outputText, 'AutoCopyListener', 'copyBotResponse');
          broadcast('response', { text: outputText });
        }
        log('Detected copyBotResponse event');
      }
    } catch (err) {
      log(`Analytics interceptor parse failed: ${err.message}`, 'warn');
    }
  });
}

async function openAppUiPage() {
  await ensurePage();
  const uiUrl = `http://127.0.0.1:${PORT}/`;
  log(`▶ Opening UI page at ${uiUrl}`);
  await page.goto(uiUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.tab[data-tab="builder"]', { timeout: 10000 });
  await page.click('.tab[data-tab="builder"]');
  await page.waitForSelector('#builderWorkflowMode', { visible: true, timeout: 10000 });
  return page;
}

async function setAppUiElement(page, selector, value, isSelect = false) {
  if (!selector) return;
  if (isSelect) {
    await page.evaluate((sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.value = val;
      const event = new Event('change', { bubbles: true });
      el.dispatchEvent(event);
    }, selector, value);
  } else {
    await page.evaluate((sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.value = val;
      ['input', 'change'].forEach(evt => el.dispatchEvent(new Event(evt, { bubbles: true })));
    }, selector, value);
  }
  await page.waitForTimeout(100);
}

const PROVIDER_BASE_URLS = {
  deepseek: 'https://chat.deepseek.com',
  qwen: 'https://chat.qwen.ai',
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
  gemini: 'https://gemini.google.com',
  google: 'https://accounts.google.com'
};

async function navigateToProviderBaseUrl(provider) {
  const baseUrl = PROVIDER_BASE_URLS[provider];
  if (!baseUrl) return;
  const targetHost = new URL(baseUrl).hostname;
  let currentUrl = '';
  try { currentUrl = await page.url(); } catch (_) {}
  if (!currentUrl.includes(targetHost)) {
    log(`Navigating to provider base URL for ${provider}: ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }
}

async function evaluateScriptContent(scriptContent, context) {
  const script = scriptContent.trim();
  let wrappedScript = script;

  if (/^\(?\s*(async\s+function|async\s*\(|function\s*)/.test(script)) {
    if (script.endsWith('})();')) {
      wrappedScript = script.replace(/\)\(\);\s*$/, '})(context);');
    } else if (script.endsWith('}());')) {
      wrappedScript = script.replace(/\}\(\);\s*$/, '})(context);');
    } else {
      wrappedScript = `return (${script})(context);`;
    }
  } else {
    wrappedScript = `return (${script})(context);`;
  }

  return await page.evaluate(new Function('context', wrappedScript), context);
}

async function executeProviderScript(provider, command, context) {
  const commandPath = path.join(__dirname, 'providers', provider, `${command}.js`);
  if (!fs.existsSync(commandPath)) {
    throw new Error(`Command script not found: ${commandPath}`);
  }

  const scriptContent = fs.readFileSync(commandPath, 'utf8');
  await ensurePage();
  await navigateToProviderBaseUrl(provider);

  try {
    return await evaluateScriptContent(scriptContent, context);
  } catch (err) {
    const message = String(err.message || '').toLowerCase();
    if (message.includes('execution context was destroyed') || message.includes('cannot find context with specified id')) {
      log(`⚠️ Provider script ${provider}/${command} triggered navigation and lost execution context; retrying`);
      await ensurePage();
      await navigateToProviderBaseUrl(provider);
      return await evaluateScriptContent(scriptContent, context);
    }
    throw err;
  }
}

async function runJsThroughAppUI({ runMode, script, provider, command, prompt, credentials = {}, chatIndex, imageSize, videoSize, code }) {
  await ensurePage();

  const context = {
    prompt,
    message: prompt || '',
    provider,
    command,
    chatIndex,
    imageSize,
    videoSize,
    code,
    email: credentials.email || '',
    password: credentials.password || '',
    apiKey: credentials.apiKey || '',
    credentials
  };

  if (runMode === 'custom') {
    if (!script) throw new Error('No custom script provided');
    return await evaluateScriptContent(script, context);
  }

  if (runMode === 'provider') {
    if (!provider || !command) {
      throw new Error('Provider and command are required for provider runMode');
    }
    return await executeProviderScript(provider, command, context);
  }

  throw new Error(`Unknown runMode: ${runMode}`);
}

async function captureLastChatText(page) {
  try {
    return await page.evaluate(() => {
      const selectors = [
        '[class*="bot"]',
        '[class*="assistant"]',
        '[class*="message"]',
        '[class*="bubble"]',
        '[class*="chat"]',
        '[data-testid*="message"]',
        '[role="log"]'
      ];
      const elements = selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)));
      const unique = Array.from(new Set(elements));
      const candidates = unique
        .map(el => ({ text: (el.innerText || el.textContent || '').trim() }))
        .filter(item => item.text && item.text.length > 10)
        .filter(item => !/copy|clipboard|button|click|复制/i.test(item.text));
      if (!candidates.length) return '';
      return candidates[candidates.length - 1].text;
    });
  } catch (err) {
    log(`captureLastChatText failed: ${err.message}`, 'warn');
    return '';
  }
}

async function executeStep(step, context) {
  const p = page;
  const label = step.label ? `[${step.label}]` : '';
  try {
    switch (step.action) {
      case 'click':
          try { await p.bringToFront(); } catch (_) {}
          if (step.selector) {
            try { await p.waitForSelector(step.selector, { visible: true, timeout: 5000 }); } catch (_) {}
            await p.click(step.selector, { delay: 50 });
            log(`Click selector: ${step.selector}${label}`);
          } else {
            await p.mouse.move(Number(step.x || 0), Number(step.y || 0));
            await p.mouse.click(Number(step.x || 0), Number(step.y || 0));
            log(`Click at (${step.x}, ${step.y})${label}`);
          }
        break;

      case 'type': {
        const text = (step.text || '').replace(/\{\{prompt\}\}/g, context.prompt || '');
        log(`Type: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"${label}`);
          try { await p.bringToFront(); } catch (_) {}
          if (step.selector) {
            try { await p.waitForSelector(step.selector, { visible: true, timeout: 5000 }); } catch (_) {}
            await p.click(step.selector, { delay: 50 });
            await p.keyboard.type(text, { delay: step.delay || 30 });
          } else {
            await p.keyboard.type(text, { delay: step.delay || 30 });
          }
        break;
      }

      case 'keypress':
        await p.keyboard.press((step.key || 'Enter').trim());
        log(`Key: ${step.key || 'Enter'}${label}`);
        break;

      case 'send': {
        const text = (step.text || '').replace(/\{\{prompt\}\}/g, context.prompt || '');
        const delay = step.delay || 30;
        if (text) {
            log(`Send: typing "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"${label}`);
            try { await p.bringToFront(); } catch (_) {}
            if (step.selector) {
              try { await p.waitForSelector(step.selector, { visible: true, timeout: 5000 }); } catch (_) {}
              await p.click(step.selector, { delay: 50 });
              await p.keyboard.type(text, { delay });
            } else {
              await p.keyboard.type(text, { delay });
            }
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

      case 'goto':
        step.action = 'navigate';
        /* falls through */

      case 'navigate':
        if (!step.url) throw new Error('Missing URL for navigate/goto step');
        log(`Navigate → ${step.url}${label}`);
        await p.goto(step.url, { waitUntil: 'networkidle2', timeout: 30000 });
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
        log(`Copy action${label}`);
        if (step.selector || step.x !== undefined || step.y !== undefined) {
          if (step.selector) {
            log(`Clicking copy selector: ${step.selector}${label}`);
            await p.click(step.selector);
          } else {
            log(`Clicking copy position: (${step.x}, ${step.y})${label}`);
            await p.mouse.click(Number(step.x || 0), Number(step.y || 0));
          }
          await new Promise(r => setTimeout(r, Number(step.waitMs || 600)));
        }

        const rawSelectors = (step.targetSelector || step.extractSelector || step.selector || '').split(',').map(s => s.trim()).filter(Boolean);
        let text = '';
        let attempts = 0;
        const maxAttempts = step.polling ? 10 : 1;

        while (attempts < maxAttempts) {
          if (rawSelectors.length) {
            for (const sel of rawSelectors) {
              try {
                text = await p.evaluate(s => {
                  const els = document.querySelectorAll(s);
                  if (!els.length) return '';
                  const el = els[els.length - 1];
                  return el.innerText || el.textContent || el.getAttribute('data-response') || '';
                }, sel);
                if (text.trim().length > 10) break;
              } catch (_) {}
            }
          } else {
            text = await p.evaluate(() => document.body.innerText || '');
          }
          if (text.trim() && !step.polling) break;
          attempts++;
          await new Promise(r => setTimeout(r, 1500));
        }

        text = text
          .replace(/【.*?】/g, '')
          .replace(/\[citation:\d+\]/g, '')
          .replace(/^(Waiting for|Generating|Typing...).*$/gm, '')
          .trim();

        text = normalizeExtractedText(text, context);
        context.result = text;
        log(`✅ Copied ${text.length} chars`);
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
        text = normalizeExtractedText(text, context);
        context.result = text;
        log(`Read ${text.length} chars`);
        broadcast('response', { text });
        break;
      }

      case 'evaluate': {
        log(`Evaluate${label}`);
        const result = await p.evaluate(new Function('context', `return (${step.script})(context);`), context);
        if (result !== undefined) {
          if (typeof result === 'object' && result !== null) {
            if (result.result !== undefined) context.result = String(result.result);
            Object.assign(context, result);
          } else {
            context.result = String(result);
          }
          broadcast('response', { text: context.result });
        }
        break;
      }

      case 'js': {
        log(`Execute JS${label}`);
        const script = step.code || step.script || '';
        if (!script) throw new Error('No JavaScript code provided');
        const result = await p.evaluate(new Function('context', `return (${script})(context);`), context);
        if (result !== undefined) {
          if (typeof result === 'object' && result !== null) {
            if (result.result !== undefined) context.result = String(result.result);
            Object.assign(context, result);
          } else {
            context.result = String(result);
          }
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
  const profiles = await loadProfiles();
  const profile = profiles.find(p => p.name === profileName);
  if (!profile) throw new Error(`Profile not found: ${profileName}`);

  const runStart = Date.now();
  let runStatus = 'success';
  let runError = null;
  const context = {
    prompt,
    message: prompt || '',
    result: '',
    workflowMode: profile.workflowMode || 'js',
    provider: profile.provider || null,
    command: profile.command || null,
    chatIndex: profile.chatIndex || '0',
    imageSize: profile.imageSize || null,
    videoSize: profile.videoSize || null
  };
  try {
    log(`▶ Starting: ${profileName} [${profile.workflowMode || 'js'} mode]`);
    broadcast('status', { running: true });
    await ensurePage();
    
    // Load provider credentials if provider is specified
    if (profile.provider) {
      const credentials = await getProviderCredentials(profile.provider);
      if (credentials) {
        context.email = credentials.email;
        context.password = credentials.password;
        context.apiKey = credentials.api_key;
        context.credentials = credentials;
        log(`🔑 Loaded credentials for ${profile.provider}`);
      }
    }
    
    // Execute provider command if specified (e.g., login, newchat, gotochat)
    if (profile.command && profile.provider) {
      log(`⚡ Executing command: ${profile.command} for ${profile.provider}`);
      await executeProviderCommand(profile.provider, profile.command, context);
    }
    
    const sessionLoaded = await loadSession(profileName);
if (profile.url) {
  let currentUrl = '';
  try { currentUrl = page.url(); } catch (_) {}
  const targetHost = new URL(profile.url).hostname;
  if (!currentUrl.includes(targetHost)) {
    log(`Navigating to ${profile.url}`);
    await page.goto(profile.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!sessionLoaded) await new Promise(r => setTimeout(r, 3000)); // Wait for auth check
    await saveSession(profileName);
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
  } catch (err) {
    runStatus = 'failed';
    runError = err.message;
    throw err;
  } finally {
    isRunning = false;
    broadcast('status', { running: false });
    await recordRunHistory({
      profileSlug: profile.slug,
      profileName: profile.name,
      prompt,
      result: context.result,
      status: runStatus,
      error: runError,
      durationMs: Date.now() - runStart,
      workflowMode: profile.workflowMode || 'js'
    });
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
app.get('/profiles', async (req, res) => {
  try {
    const profiles = await loadProfiles();
    res.json(profiles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/profiles', requireApiKey, async (req, res) => {
  try {
    const profiles = await loadProfiles();
    const { name, url, steps, workflowMode, provider, command, script, scriptSource } = req.body;
    if (!name) return res.status(400).json({ error: 'Profile name is required' });
    const sanitized = { 
      name, 
      url, 
      steps, 
      slug: slugify(name),
      workflowMode: workflowMode || 'touch', provider: provider || null, command: command || null,
      script: script || null, scriptSource: scriptSource || 'provider'
    };
    const idx = profiles.findIndex(p => p.name === name || p.slug === sanitized.slug);
    if (idx >= 0) profiles[idx] = sanitized;
    else profiles.push(sanitized);
    await saveProfiles(profiles);
    res.json({ ok: true, slug: sanitized.slug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/profiles/:name', requireApiKey, async (req, res) => {
  try {
    let profiles = await loadProfiles();
    const target = decodeURIComponent(req.params.name);
    profiles = profiles.filter(p => p.name !== target && p.slug !== target);
    await saveProfiles(profiles);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function runProfileBySlug(slug, prompt) {
  const profile = await getProfileBySlug(slug);
  if (!profile) throw new Error(`Profile not found: ${slug}`);
  return runProfile(profile.name, prompt);
}

// Automation
app.post('/run', requireApiKey, async (req, res) => {
  if (isRunning) return res.status(409).json({ error: 'Already running' });
  const { profile, prompt } = req.body;
  if (!profile) return res.status(400).json({ error: 'profile required' });
  // Don't require prompt - let backend decide based on workflow
  runProfile(profile, prompt || '')
    .then(result => broadcast('done', { result }))
    .catch(e => { log(`Error: ${e.message}`, 'error'); broadcast('error', { message: e.message }); });
  res.json({ ok: true });
});

app.post('/run/:slug', requireApiKey, async (req, res) => {
  if (isRunning) return res.status(409).json({ error: 'Already running' });
  const slug = decodeURIComponent(req.params.slug);
  const { prompt } = req.body;
  // Don't require prompt - let backend decide based on workflow
  try {
    const reply = await runProfileBySlug(slug, prompt || '');
    const profiles = await loadProfiles();
    const profile = profiles.find(p => p.slug === slug);
    saveLastResponse(reply, profile?.name || slug, prompt || '');
    res.json({ ok: true, reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/run/:slug', requireApiKey, async (req, res) => {
  if (isRunning) return res.status(409).json({ error: 'Already running' });
  const slug = decodeURIComponent(req.params.slug);
  const prompt = req.query.prompt || '';
  // Don't require prompt query - allow empty for workflows without text input
  try {
    const reply = await runProfileBySlug(slug, prompt);
    const profiles = await loadProfiles();
    const profile = profiles.find(p => p.slug === slug);
    saveLastResponse(reply, profile?.name || slug, prompt);
    res.json({ ok: true, reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/stop', requireApiKey, (req, res) => {
  shouldStop = true;
  log('Stop requested', 'warn');
  res.json({ ok: true });
});

app.post('/ask', requireApiKey, async (req, res) => {
  const { message, profile = 'DeepSeek Send' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  if (isRunning) return res.status(409).json({ error: 'Bot is busy' });
  try {
    const reply = await runProfile(profile, message);
    saveLastResponse(reply, profile, message);
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

// Get Last Response
app.get('/last-response', (req, res) => {
  res.json(lastResponse);
});

app.get('/copy-event', (req, res) => {
  res.json({ lastCopyBotResponseEvent });
});

app.get('/copy-output', (req, res) => {
  res.json({
    outputText: lastCopyBotResponseEvent?.outputText || lastResponse.text || '',
    source: lastCopyBotResponseEvent ? 'copy-event' : 'last-response',
    event: lastCopyBotResponseEvent || null,
    lastResponse
  });
});

// Download Last Response as File
app.get('/download-response', (req, res) => {
  const { format = 'txt' } = req.query;
  const timestamp = lastResponse.timestamp ? new Date(lastResponse.timestamp).toLocaleString() : 'N/A';
  let content, mimeType, filename;

  if (format === 'json') {
    content = JSON.stringify(lastResponse, null, 2);
    mimeType = 'application/json';
    filename = `response_${Date.now()}.json`;
  } else if (format === 'csv') {
    content = `Profile,Prompt,Response,Timestamp\n"${lastResponse.profileName}","${lastResponse.prompt}","${lastResponse.text}","${timestamp}"`;
    mimeType = 'text/csv';
    filename = `response_${Date.now()}.csv`;
  } else {
    content = `Profile: ${lastResponse.profileName}\nPrompt: ${lastResponse.prompt}\nResponse: ${lastResponse.text}\nTimestamp: ${timestamp}`;
    mimeType = 'text/plain';
    filename = `response_${Date.now()}.txt`;
  }

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

app.get('/endpoints', requireApiKey, async (req, res) => {
  try {
    const endpoints = (await loadProfiles()).map(profile => ({
      name: profile.name,
      slug: profile.slug,
      endpoint: `/run/${profile.slug}`,
      description: profile.label || profile.name,
      url: profile.url || null
    }));
    res.json({ endpoints, docs: {
      run: 'POST /run/{slug} with {"prompt":"..."}',
      runGet: 'GET /run/{slug}?prompt=...'
    } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/history', requireApiKey, async (req, res) => {
  if (!USE_POSTGRES) return res.status(404).json({ error: 'History is not enabled without DATABASE_URL' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  try {
    const result = await dbClient.query(
      'SELECT id, profile_slug, profile_name, prompt, result, status, error, duration_ms, workflow_mode, created_at FROM runs ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json({ history: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Data API - Send and receive data from external tools/devices
app.post('/data/send', requireApiKey, async (req, res) => {
  try {
    const { key, value, metadata } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    
    if (USE_POSTGRES && dbClient) {
      await dbClient.query(
        `INSERT INTO data_store (key, value, metadata, created_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, metadata = EXCLUDED.metadata, updated_at = now()`,
        [key, JSON.stringify(value), JSON.stringify(metadata || {})]
      );
      log(`Data stored: ${key}`);
    } else {
      const dataFile = path.join(__dirname, 'data_store.json');
      let data = {};
      if (fs.existsSync(dataFile)) {
        data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      }
      data[key] = { value, metadata, updatedAt: new Date().toISOString() };
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
      log(`Data stored (file): ${key}`);
    }
    
    res.json({ ok: true, key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/data/receive', requireApiKey, async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'Key query parameter is required' });
    
    let result = null;
    if (USE_POSTGRES && dbClient) {
      const queryResult = await dbClient.query(
        'SELECT value, metadata, created_at, updated_at FROM data_store WHERE key = $1',
        [key]
      );
      if (queryResult.rows[0]) {
        result = {
          key,
          value: JSON.parse(queryResult.rows[0].value),
          metadata: JSON.parse(queryResult.rows[0].metadata || '{}'),
          createdAt: queryResult.rows[0].created_at,
          updatedAt: queryResult.rows[0].updated_at
        };
      }
    } else {
      const dataFile = path.join(__dirname, 'data_store.json');
      if (fs.existsSync(dataFile)) {
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        if (data[key]) {
          result = { key, ...data[key] };
        }
      }
    }
    
    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'Key not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/data/list', requireApiKey, async (req, res) => {
  try {
    let keys = [];
    if (USE_POSTGRES && dbClient) {
      const result = await dbClient.query(
        'SELECT key, created_at, updated_at FROM data_store ORDER BY updated_at DESC'
      );
      keys = result.rows;
    } else {
      const dataFile = path.join(__dirname, 'data_store.json');
      if (fs.existsSync(dataFile)) {
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        keys = Object.keys(data).map(key => ({
          key,
          updatedAt: data[key].updatedAt
        }));
      }
    }
    res.json({ keys });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Provider Credentials API
app.post('/provider-credentials', requireApiKey, async (req, res) => {
  try {
    const { provider, email, password, apiKey, metadata } = req.body;
    if (!provider) return res.status(400).json({ error: 'Provider is required' });
    
    if (USE_POSTGRES && dbClient) {
      await dbClient.query(
        `INSERT INTO provider_credentials (provider, email, password, api_key, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (provider) DO UPDATE 
         SET email = EXCLUDED.email, password = EXCLUDED.password, api_key = EXCLUDED.api_key, 
             metadata = EXCLUDED.metadata, updated_at = now()`,
        [provider, email || null, password || null, apiKey || null, JSON.stringify(metadata || {})]
      );
      log(`💾 Provider credentials saved for ${provider}`);
    } else {
      // Fallback to file storage
      const credsFile = path.join(__dirname, 'provider_credentials.json');
      let creds = {};
      if (fs.existsSync(credsFile)) {
        creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      }
      creds[provider] = { email, password, apiKey, metadata, updatedAt: new Date().toISOString() };
      fs.writeFileSync(credsFile, JSON.stringify(creds, null, 2));
      log(`💾 Provider credentials saved (file) for ${provider}`);
    }
    res.json({ ok: true, provider });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Provider Login Endpoint - Execute login command for a provider
app.post('/providers/:provider/login', requireApiKey, async (req, res) => {
  if (isRunning) return res.status(409).json({ error: 'Already running' });
  
  try {
    const { provider } = req.params;
    const { email, password, apiKey } = req.body;
    
    // Save credentials first if provided
    if (email || password || apiKey) {
      await fetch(`${req.protocol}://${req.headers.host}/provider-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY || 'internal' },
        body: JSON.stringify({ provider, email, password, apiKey })
      });
    }
    
    // Load context with credentials
    const credentials = await getProviderCredentials(provider);
    if (!credentials || (!credentials.email && !credentials.apiKey)) {
      return res.status(400).json({ error: 'No credentials available for this provider' });
    }
    
    const context = {
      email: credentials.email,
      password: credentials.password,
      apiKey: credentials.api_key,
      credentials
    };
    
    // Execute login through UI to match user interaction
    log(`▶ Executing login through UI for ${provider}`);
    
    const uiResult = await runJsThroughAppUI({
      runMode: 'provider',
      script: '',
      provider: provider,
      command: 'login',
      prompt: '',
      credentials: {
        email: credentials.email || '',
        password: credentials.password || '',
        apiKey: credentials.api_key || ''
      },
      chatIndex: undefined,
      imageSize: undefined,
      videoSize: undefined,
      code: context.code
    });
    
    // Save session after successful login
    await saveSession(`${provider}_login`);
    
    log(`✅ Login successful for ${provider} through UI`);
    res.json({ ok: true, message: `Login successful for ${provider}`, result: uiResult });
  } catch (e) {
    log(`❌ Login failed: ${e.message}`, 'error');
    res.status(500).json({ error: e.message });
  }
});

// Execute JS Script Endpoint - Execute custom JS script from UI
app.post('/execute-js', requireApiKey, async (req, res) => {
  if (isRunning) return res.status(409).json({ error: 'Already running' });
  
  try {
    const { profile, prompt } = req.body;
    
    if (!profile) {
      return res.status(400).json({ error: 'Profile name is required' });
    }
    
    // Find the profile
    const profileData = profiles.find(p => p.name === profile);
    if (!profileData) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    if (profileData.workflowMode !== 'js') {
      return res.status(400).json({ error: 'Profile is not in JS mode' });
    }
    
    if (!profileData.script && !(profileData.provider && profileData.command)) {
      return res.status(400).json({ error: 'No script or provider command defined for this profile' });
    }
    
    // Always execute through UI to match user interaction
    const scriptSource = profileData.scriptSource === 'custom' ? 'custom' : 'provider';
    const credentials = profileData.provider ? await getProviderCredentials(profileData.provider) : {};
    const uiResult = await runJsThroughAppUI({
      runMode: scriptSource,
      script: profileData.script || '',
      provider: profileData.provider || '',
      command: profileData.command || '',
      prompt: prompt || '',
      credentials: { email: credentials?.email || '', password: credentials?.password || '', apiKey: credentials?.api_key || '' },
      chatIndex: profileData.chatIndex,
      imageSize: profileData.imageSize,
      videoSize: profileData.videoSize,
      code: profileData.code
    });
    return res.json({ ok: true, result: uiResult });
  } catch (e) {
    log(`❌ JS execution failed: ${e.message}`, 'error');
    res.status(500).json({ error: e.message });
  }
});

// Execute JS directly from Builder without saving profile
app.post('/execute-js-direct', requireApiKey, async (req, res) => {
  if (isRunning) return res.status(409).json({ error: 'Already running' });
  
  try {
    const { script, context: reqContext } = req.body;
    
    if (!script && !(reqContext?.provider && reqContext?.command)) {
      return res.status(400).json({ error: 'Script or provider command is required' });
    }

    // Always execute through UI to match user interaction
    const uiResult = await runJsThroughAppUI({
      runMode: script ? 'custom' : 'provider',
      script: script || '',
      provider: reqContext?.provider || '',
      command: reqContext?.command || '',
      prompt: reqContext?.prompt || '',
      credentials: reqContext?.credentials || {},
      chatIndex: reqContext?.chatIndex,
      imageSize: reqContext?.imageSize,
      videoSize: reqContext?.videoSize,
      code: reqContext?.code
    });
    return res.json({ ok: true, result: uiResult });
  } catch (e) {
    log(`❌ JS execution failed: ${e.message}`, 'error');
    res.status(500).json({ error: e.message });
  }
});

app.post('/execute-js-ui', requireApiKey, async (req, res) => {
  if (isRunning) return res.status(409).json({ error: 'Already running' });
  
  try {
    const { runMode, script, context: reqContext } = req.body;
    if (!runMode || !['provider', 'custom'].includes(runMode)) {
      return res.status(400).json({ error: 'runMode must be either "provider" or "custom"' });
    }
    if (runMode === 'custom' && !script) {
      return res.status(400).json({ error: 'Custom script is required for custom runMode' });
    }
    if (runMode === 'provider' && !(reqContext?.provider && reqContext?.command)) {
      return res.status(400).json({ error: 'provider and command are required for provider runMode' });
    }

    const uiResult = await runJsThroughAppUI({
      runMode,
      script: script || '',
      provider: reqContext?.provider || '',
      command: reqContext?.command || '',
      prompt: reqContext?.prompt || '',
      credentials: reqContext?.credentials || {},
      chatIndex: reqContext?.chatIndex,
      imageSize: reqContext?.imageSize,
      videoSize: reqContext?.videoSize,
      code: reqContext?.code
    });

    res.json({ ok: true, result: uiResult });
  } catch (e) {
    log(`❌ JS UI execution failed: ${e.message}`, 'error');
    res.status(500).json({ error: e.message });
  }
});

app.get('/provider-credentials/:provider', requireApiKey, async (req, res) => {
  try {
    const { provider } = req.params;
    let result = null;
    
    if (USE_POSTGRES && dbClient) {
      const queryResult = await dbClient.query(
        'SELECT provider, email, api_key, metadata, created_at, updated_at FROM provider_credentials WHERE provider = $1',
        [provider]
      );
      if (queryResult.rows[0]) {
        result = {
          ...queryResult.rows[0],
          password: null // Never expose password
        };
      }
    } else {
      const credsFile = path.join(__dirname, 'provider_credentials.json');
      if (fs.existsSync(credsFile)) {
        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
        if (creds[provider]) {
          result = { provider, ...creds[provider], password: null };
        }
      }
    }
    
    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'Provider credentials not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/provider-credentials', requireApiKey, async (req, res) => {
  try {
    let providers = [];
    if (USE_POSTGRES && dbClient) {
      const result = await dbClient.query(
        'SELECT provider, email, api_key, metadata, created_at, updated_at FROM provider_credentials ORDER BY provider'
      );
      providers = result.rows.map(row => ({ ...row, password: null }));
    } else {
      const credsFile = path.join(__dirname, 'provider_credentials.json');
      if (fs.existsSync(credsFile)) {
        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
        providers = Object.keys(creds).map(provider => ({
          provider,
          email: creds[provider].email,
          apiKey: creds[provider].apiKey,
          metadata: creds[provider].metadata,
          updatedAt: creds[provider].updatedAt,
          password: null
        }));
      }
    }
    res.json({ providers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper function to get provider credentials (for internal use)
async function getProviderCredentials(provider) {
  try {
    let result = null;
    
    if (USE_POSTGRES && dbClient) {
      const queryResult = await dbClient.query(
        'SELECT provider, email, password, api_key, metadata FROM provider_credentials WHERE provider = $1',
        [provider]
      );
      if (queryResult.rows[0]) {
        result = queryResult.rows[0];
      }
    } else {
      const credsFile = path.join(__dirname, 'provider_credentials.json');
      if (fs.existsSync(credsFile)) {
        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
        if (creds[provider]) {
          result = { provider, ...creds[provider] };
        }
      }
    }
    
    return result;
  } catch (e) {
    log(`Failed to load provider credentials: ${e.message}`, 'warn');
    return null;
  }
}

// Execute provider command (login, newchat, gotochat, etc.)
async function executeProviderCommand(provider, command, context) {
  const commandPath = path.join(__dirname, 'providers', provider, `${command}.js`);
  
  if (!fs.existsSync(commandPath)) {
    throw new Error(`Command script not found: ${commandPath}`);
  }
  
  try {
    log(`▶ Executing provider command directly: ${provider}/${command}`);
    const result = await executeProviderScript(provider, command, {
      prompt: context.prompt || context.message || '',
      message: context.prompt || context.message || '',
      email: context.email || context.credentials?.email || '',
      password: context.password || context.credentials?.password || '',
      apiKey: context.apiKey || context.credentials?.apiKey || '',
      credentials: context.credentials || {},
      chatIndex: context.chatIndex,
      imageSize: context.imageSize,
      videoSize: context.videoSize,
      code: context.code
    });
    log(`✅ Command ${command} executed for ${provider}`);
    return result;
  } catch (err) {
    log(`❌ Command ${command} failed: ${err.message}`, 'error');
    throw err;
  }
}

app.get('/docs', async (req, res) => {
  try {
    const endpoints = (await loadProfiles()).map(profile => ({
      name: profile.name,
      slug: profile.slug,
      endpoint: `/run/${profile.slug}`,
      url: profile.url || 'n/a'
    }));
    const docsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BotForge API Docs</title>
  <style>body{font-family:system-ui,sans-serif;background:#0f0f12;color:#e0e0e0;padding:24px;}pre,code{background:#111;color:#9ece6a;padding:4px 8px;border-radius:4px;}table{width:100%;border-collapse:collapse;margin-top:16px;}th,td{padding:10px;border:1px solid #222;text-align:left;}th{background:#15151a;}</style>
</head>
<body>
  <h1>BotForge API Docs</h1>
  <p>Use <code>x-api-key</code> or <code>?api_key=...</code> when <strong>API_KEY</strong> is configured.</p>
  <h2>Endpoints</h2>
  <ul>
    <li><code>POST /run/{slug}</code> with JSON <code>{"prompt":"..."}</code></li>
    <li><code>GET /run/{slug}?prompt=...</code></li>
    <li><code>GET /endpoints</code></li>
    <li><code>GET /history?limit=20</code> (requires DB)</li>
  </ul>
  <h2>Saved flows</h2>
  <table><thead><tr><th>Name</th><th>Slug</th><th>Endpoint</th><th>URL</th></tr></thead><tbody>
    ${endpoints.map(e => `<tr><td>${e.name}</td><td>${e.slug}</td><td><code>${e.endpoint}</code></td><td>${e.url}</td></tr>`).join('')}
  </tbody></table>
</body>
</html>`;
    res.send(docsHtml);
  } catch (e) {
    res.status(500).send(`<pre>Docs load failed: ${e.message}</pre>`);
  }
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

// Start Server - Listen FIRST, then initialize browser in background
(async () => {
  try {
    await initDatabase();
    await ensureProfileStore();
    
    // Start listening on port immediately (don't wait for browser)
    app.listen(PORT, '0.0.0.0', () => log(`Server running on port ${PORT}`));
    
    // Start self-pinger to prevent idle timeout
    startSelfPinger();
    
    // Initialize browser in background
    ensurePage()
      .then(() => log('Browser ready'))
      .catch(err => log(`Browser init failed: ${err.message}`, 'error'));
  } catch (err) {
    log(`Fatal startup error: ${err.message}`, 'error');
    process.exit(1);
  }
})();
