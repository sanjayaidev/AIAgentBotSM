// ChatGPT Login - Step 2: Google Password Entry
// Run this after Step 1 when redirected to Google login page.
// Expects context.password

(async (context = {}) => {
  const password = context.password || '';
  // Ensure we are on the correct URL
  if (!window.location.href.includes('accounts.google.com') && !window.location.href.includes('chatgpt.com')) {
    // Stay on Google page if already there, otherwise navigate to chatgpt.com first
    window.location.href = 'https://chatgpt.com';
    await new Promise(r => setTimeout(r, 3000));
  }


  if (!password) {
    throw new Error('Password is required for step 2');
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

  console.log('ChatGPT Login Step 2: Entering Google password...');

  // Wait for Google page elements to be ready
  await new Promise(r => setTimeout(r, 1000));

  // 1. Click "Next" on email confirmation screen if needed (sometimes Google shows email again)
  const identifierNextBtn = document.querySelector('#identifierNext button');
  if (identifierNextBtn) {
    console.log('Clicking identifier next...');
    identifierNextBtn.click();
    await new Promise(r => setTimeout(r, 2000));
  }

  // 2. Find password input
  const passwordInput = document.querySelector('input[name="Passwd"]');
  if (!passwordInput) {
    // Check if already logged in or on TOTP screen
    const totpInput = document.querySelector('input[name="totpPin"]');
    if (totpInput) {
      return { 
        ok: true, 
        message: 'Password skipped, proceeding to TOTP (Step 3).', 
        step: 2,
        nextStep: 'totp' 
      };
    }
    
    const userMenu = document.querySelector('[data-testid="user-menu"]');
    if (userMenu) {
      return { ok: true, message: 'Already logged in', step: 2 };
    }

    throw new Error('Password input not found. Ensure you are on the Google login page.');
  }

  // 3. Fill password
  passwordInput.focus();
  setInputValue(passwordInput, password);

  await new Promise(r => setTimeout(r, 500));

  // 4. Click Next
  const passwordNextBtn = document.querySelector('#passwordNext button');
  if (!passwordNextBtn) {
    throw new Error('Password Next button not found');
  }

  console.log('Submitting password, waiting...');
  passwordNextBtn.click();

  // Wait for redirect or TOTP prompt
  await new Promise(r => setTimeout(r, 3000));

  // Check if redirected to TOTP
  const totpInput = document.querySelector('input[name="totpPin"]');
  if (totpInput) {
    return { 
      ok: true, 
      message: 'Password accepted. Proceed to Step 3 (TOTP).', 
      step: 2,
      nextStep: 'totp' 
    };
  }

  // Check if fully logged in
  const userMenu = document.querySelector('[data-testid="user-menu"]');
  if (userMenu) {
    return { ok: true, message: 'Login successful', step: 2 };
  }

  return { 
    ok: true, 
    message: 'Password submitted. Check for TOTP or completion.', 
    step: 2 
  };
})();
