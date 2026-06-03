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
  
  // Wait for code input to appear
  let attempts = 0;
  let codeInput = null;
  
  while (attempts < 30 && !codeInput) {
    await new Promise(r => setTimeout(r, 500));
    codeInput = document.querySelector('input[type="tel"], input[name="totpPin"]');
    attempts++;
  }
  
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