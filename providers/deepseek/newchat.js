/**
 * DeepSeek New Chat
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} - Result object
 */
(async (context = {}) => {
  const selectors = [
    'div._5a8ac7a.a084f19e',
    'div.ds-icon + span',
    'div[tabindex="0"]',
    'div[role="button"]',
    'button',
    'a'
  ];
  let btn = null;
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && /new\s*chat/i.test(el.textContent || '')) {
      btn = el;
      break;
    }
  }
  if (!btn) {
    btn = [...document.querySelectorAll('button,div,a,span')].find(el =>
      el.textContent && /new\s*chat/i.test(el.textContent.trim())
    );
  }
  if (!btn) {
    return { error: 'New chat button not found' };
  }
  btn.click();
  await new Promise(r => setTimeout(r, 500));
  return { ok: true, action: 'newchat' };
})();
