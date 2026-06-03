/**
 * Google 2FA Code Submission
 * @param {Object} context - Execution context
 * @param {string} context.code - 6-digit verification code
 * @returns {Promise<string>} - Submission status
 */
(async (context = {}) => {
  const code = context.code;
  
  if (!code) throw new Error('No verification code provided');
  if (code.length !== 6) throw new Error('Code must be 6 digits');
  
  const waitForElement = async (selectors, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) return el;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    return null;
  };

  const codeInput = await waitForElement([
    'input[type="tel"]',
    'input[name="totpPin"]',
    'input[name="code"]',
    'input[name="smsUserPin"]',
    'input[autocomplete="one-time-code"]',
    'input[type="text"]'
  ], 20000);
  if (!codeInput) throw new Error('Code input not found');
  
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(codeInput, code);
  codeInput.dispatchEvent(new Event('input', { bubbles: true }));
  codeInput.dispatchEvent(new Event('change', { bubbles: true }));
  
  codeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
  codeInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
  
  console.log('✅ Verification code submitted');
  
  return '2FA code submitted successfully';
})();