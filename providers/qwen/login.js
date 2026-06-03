(async (context = {}) => {
  const email = context.email || '';
  const password = context.password || '';
  
  // Ensure we are on a recognized Qwen URL
  const allowedQwenHosts = ['chat.qwen.ai', 'qwen.ai', 'tongyi.aliyun.com', 'qianwen.aliyun.com'];
  const currentHref = window.location.href || '';
  const isQwenHost = allowedQwenHosts.some(host => currentHref.includes(host));
  if (!isQwenHost) {
    window.location.href = 'https://chat.qwen.ai';
    await new Promise(r => setTimeout(r, 3000));
  }

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

  // 1. Click login button
  const loginBtn = document.querySelector('button.qwen-chat-btn.header-right-auth-button');
  if (!loginBtn) {
    // Check if already logged in (presence of avatar or new chat button usually indicates login)
    const userAvatar = document.querySelector('div[class*="user-avatar"]') || document.querySelector('button[data-testid="user-avatar"]');
    if (userAvatar) {
      return { ok: true, message: 'Already logged in' };
    }
    throw new Error('Login button not found');
  }
  loginBtn.click();
  console.log('Clicked login button, waiting for modal...');

  // Wait for modal to appear
  await new Promise(r => setTimeout(r, 2000));

  // 2. Fill email and password
  const emailInput = document.querySelector('input[name="email"]');
  const passwordInput = document.querySelector('input[name="password"]');
  
  if (!emailInput || !passwordInput) {
    // Check if we are already on a logged-in state or modal failed
    throw new Error('Login inputs not found. Modal may not have appeared.');
  }

  console.log('Filling credentials...');
  emailInput.focus();
  setInputValue(emailInput, email);
  
  await new Promise(r => setTimeout(r, 300));
  
  passwordInput.focus();
  setInputValue(passwordInput, password);

  await new Promise(r => setTimeout(r, 500));

  // 3. Click sign in
  const submitBtn = document.querySelector('button.qwenchat-auth-pc-submit-button');
  if (!submitBtn) {
    throw new Error('Submit button not found');
  }
  submitBtn.click();
  console.log('Submitted credentials, waiting for redirect...');

  // 4. Wait for redirect / success
  let attempts = 0;
  while (attempts < 30) { // 15 seconds max wait
    await new Promise(r => setTimeout(r, 500));
    
    // If the login form disappears, we likely succeeded
    const currentEmailInput = document.querySelector('input[name="email"]');
    const currentSubmitBtn = document.querySelector('button.qwenchat-auth-pc-submit-button');
    
    if (!currentEmailInput && !currentSubmitBtn) {
      // Double check for user presence
      const userAvatar = document.querySelector('div[class*="user-avatar"]') || document.querySelector('button[data-testid="user-avatar"]');
      if (userAvatar) {
        return { ok: true, message: 'Login successful' };
      }
      // If form is gone but no avatar, might be loading or 2FA
      console.log('Login form disappeared, checking status...');
    }
    
    attempts++;
  }

  // Final check
  const userAvatar = document.querySelector('div[class*="user-avatar"]') || document.querySelector('button[data-testid="user-avatar"]');
  if (userAvatar) {
    return { ok: true, message: 'Login successful' };
  }

  throw new Error('Login timeout — check credentials or 2FA requirements');
})();
