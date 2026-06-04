(async (context = {}) => {
  const email = context.email || '';
  const password = context.password || '';
  
  // Wait for auth page to fully load by checking for auth form elements
  console.log('Waiting for auth page to load...');
  await new Promise((resolve) => {
    const checkPageLoaded = () => {
      const emailInput = document.querySelector('input[name="email"]');
      const passwordInput = document.querySelector('input[name="password"]');
      if (emailInput && passwordInput) {
        console.log('Auth page loaded successfully');
        resolve();
      } else {
        setTimeout(checkPageLoaded, 200);
      }
    };
    checkPageLoaded();
  });
  
  if (!email || !password) {
    throw new Error('Email and password required');
  }

  // Helper to properly set input values and trigger events
  const setInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  console.log('Starting Qwen login...');

  // Check if already logged in
  const userAvatar = document.querySelector('div[class*="user-avatar"]') || document.querySelector('button[data-testid="user-avatar"]');
  if (userAvatar) {
    return { ok: true, message: 'Already logged in' };
  }

  // Fill email and password directly on auth page
  const emailInput = document.querySelector('input[name="email"]');
  const passwordInput = document.querySelector('input[name="password"]');
  
  if (!emailInput || !passwordInput) {
    throw new Error('Login inputs not found on auth page.');
  }

  console.log('Filling credentials...');
  emailInput.focus();
  setInputValue(emailInput, email);
  
  await new Promise(r => setTimeout(r, 300));
  
  passwordInput.focus();
  setInputValue(passwordInput, password);

  await new Promise(r => setTimeout(r, 500));

  // Click sign in button
  const submitBtn = document.querySelector('button.qwenchat-auth-pc-submit-button');
  if (!submitBtn) {
    throw new Error('Submit button not found');
  }
  submitBtn.click();
  console.log('Submitted credentials, waiting for redirect...');

  // Wait for redirect / success
  let attempts = 0;
  while (attempts < 30) { // 15 seconds max wait
    await new Promise(r => setTimeout(r, 500));
    
    // If the login form disappears, we likely succeeded
    const currentEmailInput = document.querySelector('input[name="email"]');
    const currentSubmitBtn = document.querySelector('button.qwenchat-auth-pc-submit-button');
    
    if (!currentEmailInput && !currentSubmitBtn) {
      // Double check for user presence
      const finalUserAvatar = document.querySelector('div[class*="user-avatar"]') || document.querySelector('button[data-testid="user-avatar"]');
      if (finalUserAvatar) {
        return { ok: true, message: 'Login successful' };
      }
      // If form is gone but no avatar, might be loading or 2FA
      console.log('Login form disappeared, checking status...');
    }
    
    attempts++;
  }

  // Final check
  const finalUserAvatarCheck = document.querySelector('div[class*="user-avatar"]') || document.querySelector('button[data-testid="user-avatar"]');
  if (finalUserAvatarCheck) {
    return { ok: true, message: 'Login successful' };
  }

  throw new Error('Login timeout — check credentials or 2FA requirements');
})();
