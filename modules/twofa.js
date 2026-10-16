"use strict";
const { sleep, log } = require("./utils");
const { clickBtn } = require("./clicks");
const OTPAuth = require("otpauth");

// Generate TOTP 6-digit code from secret
function generateTOTP(secret) {
  const cleaned = secret.replace(/\s+/g, "").toUpperCase();
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(cleaned),
    digits: 6,
    period: 30,
  });
  return totp.generate();
}

// options: { wpMail, wpPassword } — needed for "Check your email" fallback
async function setup2FA(page, options = {}) {
  log("2FA: starting setup...");

  // Click "Login and security" TAB on screen (not navigate!)
  await page.evaluate(() => {
    // Find tab with href="/password_and_security/"
    const tab = document.querySelector(
      'div[role="tab"] a[href="/password_and_security/"]',
    );
    if (tab) {
      tab.scrollIntoView({ block: "center", behavior: "instant" });
      tab.click();
      return;
    }
    // Fallback: any link with that href
    const link = document.querySelector('a[href="/password_and_security/"]');
    if (link) {
      link.scrollIntoView({ block: "center", behavior: "instant" });
      link.click();
    }
  });
  await sleep(3000);

  // Click "Two-factor authentication"
  const clicked2fa = await page.evaluate(() => {
    for (const el of document.querySelectorAll(
      '[role="presentation"], [role="button"]',
    )) {
      if (
        (el.innerText || "").includes("Two-factor authentication") &&
        el.getBoundingClientRect().width > 0
      ) {
        el.scrollIntoView({ block: "center", behavior: "instant" });
        el.click();
        return true;
      }
    }
    return false;
  });
  if (!clicked2fa) {
    log("2FA: could not find Two-factor auth button");
    return null;
  }
  await sleep(3000);

  // "Set up extra protection" → Get started
  await clickBtn(page, "Get started");
  await sleep(3000);

  // ── Fallback: "Check your email" → IMAP wp.pl for 8-digit security code ──
  const needEmailCode = await page
    .evaluate(() =>
      (document.body?.innerText || "").includes("Check your email"),
    )
    .catch(() => false);

  if (needEmailCode && options.wpMail && options.wpPassword) {
    log("2FA: 'Check your email' → IMAP for 8-digit security code...");
    const { getMetaSecurityCode } = require("./imap");
    const secCode = await getMetaSecurityCode(
      options.wpMail,
      options.wpPassword,
    );
    if (secCode) {
      log(`2FA: security code = ${secCode}`);
      // Enter code into input
      await page.evaluate((code) => {
        const inp = document.querySelector(
          'input[type="text"], input[autocomplete="off"]',
        );
        if (inp) {
          inp.focus();
          const s = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set;
          s.call(inp, code);
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, secCode);
      await sleep(1000);
      await clickBtn(page, "Continue");
      await sleep(10000); // wait 10s to unlock next step
    } else {
      log("2FA: security code not found");
      return null;
    }
  }

  // "Help protect your account" → Continue
  await clickBtn(page, "Continue");
  await sleep(3000);

  // "Instructions for setup" → extract secret key
  let secret = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    secret = await page
      .evaluate(() => {
        // Pattern: 4+ groups of 4 base32 chars separated by spaces
        const base32Re = /^[A-Z2-7]{4}(\s+[A-Z2-7]{4}){3,7}$/;
        // Also match without spaces: 16-32 char base32 string
        const base32NoSpace = /^[A-Z2-7]{16,32}$/;

        // Search in all text elements
        for (const el of document.querySelectorAll(
          "span, div, p, code, input",
        )) {
          const t = (el.value || el.textContent || "").trim();
          if (base32Re.test(t)) return t;
          if (base32NoSpace.test(t) && t.length >= 16) return t;
        }

        // Fallback: search full page text for base32 pattern
        const bodyText = document.body?.innerText || "";
        const match = bodyText.match(
          /([A-Z2-7]{4}\s+[A-Z2-7]{4}\s+[A-Z2-7]{4}\s+[A-Z2-7]{4}(?:\s+[A-Z2-7]{4})*)/,
        );
        if (match) return match[1];

        return null;
      })
      .catch(() => null);

    if (secret) break;
    log("2FA: secret not found yet, waiting...");
    await sleep(3000);
  }

  if (!secret) {
    log("2FA: could not find secret key");
    return null;
  }
  log(`2FA: secret = ${secret}`);

  // Click "Enter code"
  await clickBtn(page, "Enter code");
  await sleep(2000);

  // Generate TOTP and enter
  const token = generateTOTP(secret);
  log(`2FA: token = ${token}`);

  await page.evaluate((code) => {
    const inp = document.querySelector(
      'input[maxlength="6"], input[type="text"]',
    );
    if (inp) {
      inp.focus();
      const s = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      s.call(inp, code);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, token);
  await sleep(1000);

  // Click Next
  await clickBtn(page, "Next");
  await sleep(5000);

  // "Get your code from authentication app" — enter again if needed
  const needCode2 = await page
    .evaluate(() =>
      (document.body?.innerText || "").includes(
        "Get your code from your authentication app",
      ),
    )
    .catch(() => false);
  if (needCode2) {
    const token2 = generateTOTP(secret);
    log(`2FA: verify token = ${token2}`);
    await page.evaluate((code) => {
      const inp = document.querySelector(
        'input[maxlength="6"], input[type="text"]',
      );
      if (inp) {
        inp.focus();
        const s = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        s.call(inp, code);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, token2);
    await sleep(1000);
    await clickBtn(page, "Next");
    await sleep(5000);
  }

  // Check success
  const success = await page
    .evaluate(() =>
      (document.body?.innerText || "").includes(
        "Your two-factor authentication has been set up",
      ),
    )
    .catch(() => false);
  if (success) {
    log("2FA: setup complete ✅");
    await clickBtn(page, "Done", "OK", "Ok");
    await sleep(2000);
  } else {
    log("2FA: may not have completed, continuing...");
  }

  return secret.trim();
}

module.exports = { generateTOTP, setup2FA };
