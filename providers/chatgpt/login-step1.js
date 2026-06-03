// ChatGPT Login - Step 1: Initial Email Entry on chatgpt.com
// Run this first. It will click login and enter the email, then stop at the password/Google redirect.

(async (context = {}) => {
  const email = context.email || '';

  // Ensure we are on the correct URL
  if (!window.location.href.includes('chatgpt.com')) {
    window.location.href = 'https://chatgpt.com';
    await new Promise(r => setTimeout(r, 3000));
  }

  if (!email) {
    throw new Error('Email is required for step 1');
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

  console.log('ChatGPT Login Step 1: Entering email...');

  // 1. Click login button if not already on login page
  const loginBtn = document.querySelector('button[data-testid="login-button"]');
  if (loginBtn) {
    loginBtn.click();
    console.log('Clicked login button, waiting...');
    await new Promise(r => setTimeout(r, 2000));
  }

  // 2. Find email input
  const emailInput = document.querySelector('input[id="email"]');
  if (!emailInput) {
    // Check if already logged in
    const userMenu = document.querySelector('[data-testid="user-menu"]') || document.querySelector('nav a[href="/gpts"]');
    if (userMenu) {
      return { ok: true, message: 'Already logged in', step: 1 };
    }
    throw new Error('Email input not found. Ensure you are on chatgpt.com');
  }

  // 3. Fill email
  emailInput.focus();
  setInputValue(emailInput, email);
  
  await new Promise(r => setTimeout(r, 500));

  // 4. Click Continue
  const continueBtn = document.querySelector('button[type="submit"]');
  if (!continueBtn) {
    throw new Error('Continue button not found');
  }
  
  console.log('Submitting email, waiting for redirect...');
  continueBtn.click();

  // Wait a bit for the next page (Google or Password) to start loading
  await new Promise(r => setTimeout(r, 2000));

  return { 
    ok: true, 
    message: 'Email entered. Proceed to Step 2 (Password/Google).', 
    step: 1,
    nextStep: 'password' 
  };
})();
