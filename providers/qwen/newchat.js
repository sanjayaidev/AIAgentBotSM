/**
 * Qwen New Chat
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} - Result object
 */
(async (context = {}) => {
  const selectors = [
    '.sidebar-entry-fixed-list-content',
    'button[title*="New chat"]',
    'button[aria-label*="New chat"]',
    'button[data-testid*="new-chat"]',
    'button[data-test-id*="new-chat"]',
    '.chat-sidebar-new-chat',
    '.new-chat-button'
  ];
  let btn = null;
  for (const selector of selectors) {
    btn = document.querySelector(selector);
    if (btn) break;
  }
  if (!btn) {
    btn = [...document.querySelectorAll('button,div,a,span')].find(el =>
      el.textContent && /new\s*chat/i.test(el.textContent.trim())
    );
  }
  if (!btn) throw new Error('New chat button not found');
  btn.click();
  await new Promise(r => setTimeout(r, 500));
  return { ok: true };
})();