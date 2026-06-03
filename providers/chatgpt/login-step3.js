// ChatGPT Login - Step 3: TOTP (Authenticator Code) Entry
// Run this after Step 2 if 2FA is required.
// Expects context.totp (6-digit code from authenticator app)

(async (context = {}) => {
  const totp = context.totp || '';
  // Ensure we are on the correct URL (Google 2FA page)
  if (!window.location.href.includes('accounts.google.com')) {
    throw new Error('Not on Google 2FA page. Complete steps 1 and 2 first.');
  }


  if (!totp) {
    throw new Error('TOTP code is required for step 3');
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

  console.log('ChatGPT Login Step 3: Entering TOTP code...');

  // Wait for page to be ready
  await new Promise(r => setTimeout(r, 1000));

  // 1. Find TOTP input
  const totpInput = document.querySelector('input[name="totpPin"]');
  if (!totpInput) {
    // Check if already logged in (maybe 2FA was not needed or already completed)
    const userMenu = document.querySelector('[data-testid="user-menu"]') || document.querySelector('nav a[href="/gpts"]');
    if (userMenu) {
      return { ok: true, message: 'Already logged in (no TOTP needed)', step: 3 };
    }
    throw new Error('TOTP input not found. Ensure you are on the 2FA page.');
  }

  // 2. Fill TOTP code
  totpInput.focus();
  setInputValue(totpInput, totp);

  await new Promise(r => setTimeout(r, 500));

  // 3. Click Next/Submit
  const nextBtn = document.querySelector('#totpNext button');
  if (!nextBtn) {
    // Try alternative selector
    const submitBtn = document.querySelector('button[type="submit"]');
    if (!submitBtn) {
      throw new Error('Next/Submit button not found for TOTP');
    }
    submitBtn.click();
  } else {
    nextBtn.click();
  }

  console.log('Submitting TOTP code, waiting for login completion...');

  // Wait for redirect
  await new Promise(r => setTimeout(r, 3000));

  // Verify login success
  const userMenu = document.querySelector('[data-testid="user-menu"]') || document.querySelector('nav a[href="/gpts"]');
  if (userMenu) {
    return { ok: true, message: 'Login successful with TOTP', step: 3 };
  }

  // If still on TOTP page, it might be wrong code
  const currentTotpInput = document.querySelector('input[name="totpPin"]');
  if (currentTotpInput) {
    throw new Error('Still on TOTP page. Code may be incorrect or expired.');
  }

  return { 
    ok: true, 
    message: 'TOTP submitted. Verifying login status...', 
    step: 3 
  };
})();
