/**
 * DeepSeek Login
 * @param {Object} context - Execution context
 * @param {string} context.email - Email/phone
 * @param {string} context.password - Password
 * @returns {Promise<Object>} - Result object
 */
(async (context = {}) => {
  const email = context.email || '';
  const password = context.password || '';

  // Ensure we're on the correct URL
  if (!window.location.href.includes('chat.deepseek.com')) {
    window.location.href = 'https://chat.deepseek.com';
    await new Promise(r => setTimeout(r, 3000));
  }

  if (!email || !password) throw new Error('Email and password required');

  const setInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const inputs = document.querySelectorAll('input.ds-input__input');
  const emailInput = inputs[0];
  const passwordInput = inputs[1];

  if (!emailInput || !passwordInput) throw new Error('Login inputs not found');

  emailInput.focus();
  setInputValue(emailInput, email);

  passwordInput.focus();
  setInputValue(passwordInput, password);

  const buttons = document.querySelectorAll('[role="button"] .ds-button__content');
  const loginBtn = Array.from(buttons).find(el => el.textContent.trim() === 'Log in');
  if (!loginBtn) throw new Error('Login button not found');
  loginBtn.closest('[role="button"]').click();

  // Wait for redirect away from login page
  let attempts = 0;
  while (attempts < 20) {
    await new Promise(r => setTimeout(r, 500));
    if (!document.querySelector('input.ds-input__input')) {
      return { ok: true, message: 'Login successful' };
    }
    attempts++;
  }
  throw new Error('Login timeout — check credentials');
})();
