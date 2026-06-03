/**
 * Qwen Video Generation
 * @param {Object} context - Execution context
 * @param {string} context.message - Prompt for video
 * @param {string} context.videoSize - Video size/ratio (default: 16:9)
 * @returns {Promise<string>} - Video URL
 */
(async (context = {}) => {
  const tempMessage = context.message || '';
  if (!tempMessage) throw new Error('No prompt');

  const ratio = context.videoSize || '16:9';

  // Step 1 — open a new chat
  const selectors = [
    '.sidebar-entry-fixed-list-content',
    'button[title*="New chat"]',
    'button[aria-label*="New chat"]',
    'button[data-testid*="new-chat"]',
    'button[data-test-id*="new-chat"]',
    '.chat-sidebar-new-chat',
    '.new-chat-button'
  ];
  let newChat = null;
  for (const selector of selectors) {
    newChat = document.querySelector(selector);
    if (newChat) break;
  }
  if (!newChat) {
    newChat = [...document.querySelectorAll('button,div,a,span')].find(el =>
      el.textContent && /new\s*chat/i.test(el.textContent.trim())
    );
  }
  if (!newChat) throw new Error('New Chat button not found');
  newChat.click();
  await new Promise(r => setTimeout(r, 800));

  // Step 2 — open mode menu and click Create Video
  document.querySelector('.mode-select-open').click();
  await new Promise(r => setTimeout(r, 400));

  const t2v = document.querySelector('[data-menu-id$="-t2v"]');
  if (!t2v) throw new Error('Create Video menu item not found');
  t2v.click();
  await new Promise(r => setTimeout(r, 600));

  // Step 3 — select ratio
  await new Promise((resolve, reject) => {
    document.querySelector('.size-selector .ant-dropdown-trigger').click();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const items = document.querySelectorAll('.ant-dropdown.size-selector-popup li');
      const item = [...items].find(el => el.innerText === ratio);
      if (!item) return reject(new Error(`Ratio ${ratio} not found`));
      item.click();
      resolve();
    }));
  });

  await new Promise(r => setTimeout(r, 400));

  // Step 4 — type prompt and send
  const ta = document.querySelector('textarea.message-input-textarea');
  if (!ta) throw new Error('Textarea not found');

  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, tempMessage);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  // Step 5 — wait for video inside .qwen-video (up to 3 min)
  const beforeVideos = document.querySelectorAll('.qwen-video video').length;
  let qwenSrc = null;

  for (let i = 0; i < 360; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const videos = document.querySelectorAll('.qwen-video video');
    if (videos.length > beforeVideos) {
      const vid = videos[videos.length - 1];
      const src = vid.src || vid.querySelector('source')?.src;
      if (src && src.includes('cdn.qwenlm.ai')) {
        qwenSrc = src;
        break;
      }
    }
  }

  if (!qwenSrc) throw new Error('Timeout waiting for generated video');

  return qwenSrc;
})();
