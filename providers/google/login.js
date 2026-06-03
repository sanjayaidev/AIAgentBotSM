/**
 * Google Login - Email and Password
 * @param {Object} context - Execution context
 * @param {string} context.email - Google email
 * @param {string} context.password - Google password
 * @returns {Promise<string>} - Login status
 */
(async (context = {}) => {
  const email = context.email;
  const password = context.password;
  
  if (!email) throw new Error('No email provided');
  if (!password) throw new Error('No password provided');
  
  // Step 1: Email
  const emailInput = document.querySelector('input[type="email"]');
  if (!emailInput) throw new Error('Email input not found');
  
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(emailInput, email);
  emailInput.dispatchEvent(new Event('input', { bubbles: true }));
  emailInput.dispatchEvent(new Event('change', { bubbles: true }));
  
  emailInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
  emailInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
  
  console.log('✅ Email entered');
  
  // Wait for password page
  await new Promise(r => setTimeout(r, 2000));
  
  let attempts = 0;
  let passwordInput = null;
  
  while (attempts < 30 && !passwordInput) {
    await new Promise(r => setTimeout(r, 500));
    passwordInput = document.querySelector('input[type="password"]');
    attempts++;
  }
  
  if (!passwordInput) throw new Error('Password input not found');
  
  setter.call(passwordInput, password);
  passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
  passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
  
  passwordInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
  passwordInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, keyCode: 13, which: 13 }));
  
  console.log('✅ Password entered');
  
  return 'Login successful - password submitted';
})();