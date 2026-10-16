"use strict";
const { sleep, log, IGDieError } = require("./utils");
const { getRecoveryCode, getVerifyCode } = require("./imap");
const { igMonitorLoop } = require("./ig-monitor");
const { getIGProfile } = require("./profile");
const { buildCookieStr } = require("./cookies");

const GALAXY_NOTE3 = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 4.3; SM-N9005 Build/JSS15J) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  viewport: {
    width: 360,
    height: 640,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
};

// Click Continue trên mobile (wbloks)
async function mobileClickContinue(page) {
  try {
    const btn = await page.$('[role="button"][aria-label="Continue"]');
    if (btn) {
      await btn.click();
      return "aria";
    }
  } catch {}
  try {
    const els = await page.$$("[data-interactable]");
    for (const el of els) {
      const a = await el.evaluate((e) => e.getAttribute("aria-label"));
      if (a === "Continue") {
        await el.click();
        return "interactable";
      }
    }
  } catch {}
  return page
    .evaluate(() => {
      for (const span of document.querySelectorAll("span")) {
        if (span.textContent.trim() === "Continue") {
          let p = span.parentElement;
          while (p && p !== document.body) {
            const r = p.getAttribute("role");
            if (
              r === "button" ||
              p.getAttribute("data-interactable") ||
              window.getComputedStyle(p).cursor === "pointer"
            ) {
              p.click();
              return "walk";
            }
            p = p.parentElement;
          }
        }
      }
      for (const el of document.querySelectorAll('[role="button"]')) {
        if (
          (el.innerText || "").trim() === "Continue" &&
          el.getBoundingClientRect().width > 0
        ) {
          el.click();
          return "btn";
        }
      }
      return null;
    })
    .catch(() => null);
}

// Click wbloks button by aria-label
async function mobileClickAriaLabel(page, label) {
  try {
    const btn = await page.$(`[role="button"][aria-label="${label}"]`);
    if (btn) {
      await btn.click();
      return true;
    }
  } catch {}
  try {
    const els = await page.$$("[data-interactable]");
    for (const el of els) {
      const a = await el.evaluate((e) => e.getAttribute("aria-label"));
      if (a === label) {
        await el.click();
        return true;
      }
    }
  } catch {}
  return page
    .evaluate((lbl) => {
      for (const span of document.querySelectorAll("span")) {
        if (span.textContent.trim() === lbl) {
          let p = span.parentElement;
          while (p && p !== document.body) {
            if (
              p.getAttribute("role") === "button" ||
              p.getAttribute("data-interactable")
            ) {
              p.click();
              return true;
            }
            p = p.parentElement;
          }
        }
      }
      return false;
    }, label)
    .catch(() => false);
}

// Type vào input visible
async function mobileTypeInput(page, value) {
  await page.evaluate((val) => {
    for (const inp of document.querySelectorAll("input")) {
      const r = inp.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && !inp.disabled) {
        inp.focus();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(inp, val);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
  }, value);
}

// Full RCV flow
async function rcvAccount(page, wpMail, wpPassword, igBaitUsername) {
  log("RCV: starting recovery flow...");

  await page.setUserAgent(GALAXY_NOTE3.userAgent);
  await page.setViewport(GALAXY_NOTE3.viewport);

  // ── Step 1: Password reset page ──
  await page.goto("https://www.instagram.com/accounts/password/reset", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(4000);

  // ── Step 1b: Wait for cookie consent OR "Find your account" — handle consent first ──
  for (let i = 0; i < 15; i++) {
    const pageState = await page
      .evaluate(() => {
        const txt = document.body?.innerText || "";
        if (txt.includes("Allow the use of cookies")) return "cookies";
        if (txt.includes("Find your account")) return "ready";
        return "loading";
      })
      .catch(() => "loading");

    if (pageState === "cookies") {
      log("RCV: cookie consent → Allow all cookies");
      await page
        .evaluate(() => {
          for (const btn of document.querySelectorAll("button")) {
            if ((btn.innerText || "").includes("Allow all cookies")) {
              btn.click();
              return;
            }
          }
        })
        .catch(() => {});
      await sleep(4000);
      break;
    }
    if (pageState === "ready") break;
    await sleep(2000);
  }

  // Wait for "Find your account" (in case consent was handled)
  for (let i = 0; i < 10; i++) {
    if (
      await page
        .evaluate(() =>
          (document.body?.innerText || "").includes("Find your account"),
        )
        .catch(() => false)
    )
      break;
    await sleep(2000);
  }

  // ── Step 2: Enter mail → Continue ──
  log("RCV: entering mail...");
  await mobileTypeInput(page, wpMail);
  await sleep(1000);
  log("RCV: clicking Continue...");
  const cont1 = await mobileClickContinue(page);
  log(`RCV: Continue = ${cont1}`);
  await sleep(5000);

  // ── Step 2b: Check "Enter your password" OR "Check your email" ──
  for (let i = 0; i < 8; i++) {
    const pageState = await page
      .evaluate(() => {
        const txt = document.body?.innerText || "";
        if (txt.includes("Enter your password")) return "password";
        if (txt.includes("Check your email")) return "email";
        if (txt.includes("Choose a way to log in")) return "choose_way";
        return null;
      })
      .catch(() => null);

    if (pageState === "password") {
      log("RCV: 'Enter your password' → Try another way");
      await mobileClickAriaLabel(page, "Try another way");
      // Fallback: mouse click
      if (true) {
        const coords = await page
          .evaluate(() => {
            for (const el of document.querySelectorAll(
              '[role="button"], [data-interactable]',
            )) {
              const t = (
                el.getAttribute("aria-label") ||
                el.innerText ||
                ""
              ).trim();
              if (t === "Try another way") {
                el.scrollIntoView({ block: "center", behavior: "instant" });
                const r = el.getBoundingClientRect();
                if (r.width > 0)
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
              }
            }
            return null;
          })
          .catch(() => null);
        if (coords) await page.mouse.click(coords.x, coords.y);
      }
      await sleep(4000);
      continue; // loop lại để check "Choose a way"
    }

    if (pageState === "choose_way") {
      log("RCV: 'Choose a way to log in' → Continue");
      await mobileClickContinue(page);
      await sleep(5000);
      break;
    }

    if (pageState === "email") {
      log("RCV: already at 'Check your email'");
      break;
    }

    await sleep(2000);
  }

  // ── Step 3: "Check your email" → IMAP code 10 → Continue ──
  log("RCV: waiting for 'Check your email'...");
  for (let i = 0; i < 10; i++) {
    if (
      await page
        .evaluate(() =>
          (document.body?.innerText || "").includes("Check your email"),
        )
        .catch(() => false)
    )
      break;
    await sleep(2000);
  }

  log("RCV: fetching recovery code via IMAP...");
  const recoveryCode = await getRecoveryCode(wpMail, wpPassword);
  if (!recoveryCode) throw new IGDieError("recovery_code_not_found");
  log(`RCV: recovery code = ${recoveryCode}`);

  await mobileTypeInput(page, recoveryCode);
  await sleep(1000);
  log("RCV: clicking Continue after code 10...");
  await mobileClickContinue(page);
  await sleep(5000);

  // ── Step 4: "Choose your account" → select != bait (wbloks buttons) ──
  log("RCV: waiting for 'Choose your account'...");
  for (let i = 0; i < 10; i++) {
    if (
      await page
        .evaluate(() =>
          (document.body?.innerText || "").includes("Choose your account"),
        )
        .catch(() => false)
    )
      break;
    await sleep(2000);
  }

  // Tìm tất cả wbloks button có aria-label (= username), chọn cái khác bait
  // Tìm wbloks button có aria-label = username, chọn cái khác bait — dùng page.$$ native click
  let chosen = null;
  const allButtons = await page.$$('[role="button"][aria-label]');
  for (const btn of allButtons) {
    const label = await btn
      .evaluate((e) => e.getAttribute("aria-label"))
      .catch(() => "");
    if (
      !label ||
      label === igBaitUsername ||
      label === "Continue" ||
      label === "Try another way" ||
      label === "Log in" ||
      label === "Back" ||
      label.length < 3
    )
      continue;
    const visible = await btn
      .evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .catch(() => false);
    if (!visible) continue;
    await btn.evaluate((e) =>
      e.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await btn.click();
    chosen = label;
    break;
  }

  // Fallback: data-interactable
  if (!chosen) {
    const interactables = await page.$$("[data-interactable][aria-label]");
    for (const el of interactables) {
      const label = await el
        .evaluate((e) => e.getAttribute("aria-label"))
        .catch(() => "");
      if (
        !label ||
        label === igBaitUsername ||
        label === "Continue" ||
        label === "Try another way" ||
        label.length < 3
      )
        continue;
      const visible = await el
        .evaluate((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .catch(() => false);
      if (!visible) continue;
      await el.click();
      chosen = label;
      break;
    }
  }

  if (!chosen) throw new IGDieError("could_not_choose_account");
  log(`RCV: chose "${chosen}"`);
  await sleep(5000);

  // ── Step 5: Monitor — codeentry, birthday, consent... ──
  log("RCV: monitoring after account selection...");

  const MAX_CODE_RETRIES = 3;
  const start = Date.now();
  let codeentryDone = false;
  let desktopSwitched = false;

  while (Date.now() - start < 120000) {
    await sleep(1500);
    const url = page.url();

    // Die URLs
    if (url.includes("no_challenge")) throw new IGDieError("no_challenge");
    if (url.includes("accounts/login/")) throw new IGDieError("login_page");
    if (url.includes("lrr_limbo")) throw new IGDieError("lrr_limbo");
    if (url.includes("/accounts/suspended/")) throw new IGDieError("suspended");

    // "Log in on another device to continue" → acc die
    const logInOtherDevice = await page
      .evaluate(() =>
        (document.body?.innerText || "").includes(
          "Log in on another device to continue",
        ),
      )
      .catch(() => false);
    if (logInOtherDevice) throw new IGDieError("log_in_another_device");

    // ── codeentry: IMAP code 6 → type → Continue → check error → retry ──
    if (url.includes("/auth_platform/codeentry/") && !codeentryDone) {
      log("RCV: codeentry detected");

      for (let retry = 0; retry < MAX_CODE_RETRIES; retry++) {
        log(`RCV: fetching verify code (attempt ${retry + 1})...`);
        const code = await getVerifyCode(wpMail, wpPassword);
        if (!code) {
          log("RCV: verify code not found");
          break;
        }
        log(`RCV: verify code = ${code}`);

        await mobileTypeInput(page, code);
        await sleep(1000);
        await mobileClickContinue(page);
        await sleep(5000);

        // Code thành công → page navigate → context destroy → catch và break
        try {
          const wrongCode = await page.evaluate(
            () =>
              (document.body?.innerText || "").includes(
                "This code doesn't work",
              ) ||
              (document.body?.innerText || "").includes("code doesn't work"),
          );
          if (!wrongCode) break; // OK

          log("RCV: wrong code → Get a new code");
          await page.evaluate(() => {
            for (const el of document.querySelectorAll(
              '[role="link"], span[role="link"]',
            )) {
              if ((el.textContent || "").includes("Get a new code")) {
                el.click();
                return;
              }
            }
          });
          await sleep(10000);
        } catch {
          // Navigation happened = code worked, page moved on
          log("RCV: page navigated after code → success");
          break;
        }
      }
      // Sau codeentry → đợi page xử lý, KHÔNG chuyển viewport ngay (sẽ hủy session)
      codeentryDone = true;
      await sleep(5000);
      continue;
    }
    // Birthday
    if (url.includes("challenge/?next=") || url.includes("challenge/action/")) {
      const hasBday = await page
        .evaluate(() => document.querySelectorAll("select").length >= 3)
        .catch(() => false);
      if (hasBday) {
        const { fillBirthday } = require("./birthday");
        await fillBirthday(page);
        await sleep(3000);
        continue;
      }
      await mobileClickContinue(page);
      await sleep(3000);
      continue;
    }

    // consent → dùng handleConsent từ ig-monitor (không cần switch viewport)
    if (url.includes("consent")) {
      if (!desktopSwitched) {
        log("RCV: consent detected → switching to desktop");
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        );
        await page.setViewport({
          width: 1280,
          height: 720,
          deviceScaleFactor: 1,
          isMobile: false,
          hasTouch: false,
        });
        desktopSwitched = true;
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        await sleep(4000);
      }
      // Import handleConsent trực tiếp
      const { igMonitorLoop: monitorLoop } = require("./ig-monitor");
      try {
        await monitorLoop(page, 30000);
      } catch {}
      continue;
    }

    // terms/unblock
    if (url.includes("/terms/unblock/")) {
      const { clickBtn } = require("./clicks");
      await clickBtn(page, "Next");
      await sleep(2000);
      await clickBtn(page, "Agree", "I agree", "Accept");
      await sleep(3000);
      continue;
    }

    // scraping
    if (url.includes("/accounts/scraping_warning")) {
      const { clickBtn } = require("./clicks");
      await clickBtn(page, "Dismiss", "OK", "Got it");
      await sleep(3000);
      continue;
    }

    // Create a new password → Skip
    if (
      url.includes("/accounts/password/reset") ||
      url.includes("password/reset/v2")
    ) {
      log("RCV: password reset → Skip");
      await mobileClickAriaLabel(page, "Skip");
      await sleep(3000);
      continue;
    }

    // onetap
    if (url.includes("onetap")) {
      await mobileClickAriaLabel(page, "Not now");
      await sleep(3000);
      continue;
    }

    // Homepage OK
    if (
      url === "https://www.instagram.com/" ||
      url === "https://www.instagram.com" ||
      url.startsWith("https://www.instagram.com/?")
    ) {
      // Check bị scraping_warning logout (thấy "Use another profile")
      const loggedOut = await page
        .evaluate(() =>
          [...document.querySelectorAll('[role="button"], [role="none"]')].some(
            (b) => (b.innerText || "").includes("Use another profile"),
          ),
        )
        .catch(() => false);
      if (loggedOut) {
        log("RCV: scraping_logged_out detected (Use another profile)");
        throw new IGDieError("scraping_logged_out");
      }

      const loggedIn = (await page.cookies("https://www.instagram.com")).some(
        (c) => c.name === "sessionid" && c.value,
      );
      if (loggedIn) {
        log("RCV: homepage OK ✅");
        break;
      }
    }
  }

  // ── Step 6: Wait 10s → reload → check scraping ──
  log("RCV: waiting 10s...");
  await sleep(10000);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(4000);

  // Check bị scraping_warning sau reload
  const scrapingAfterReload = await page
    .evaluate(() =>
      [...document.querySelectorAll('[role="button"], [role="none"]')].some(
        (b) => (b.innerText || "").includes("Use another profile"),
      ),
    )
    .catch(() => false);
  if (scrapingAfterReload) {
    log("RCV: scraping_logged_out after reload");
    throw new IGDieError("scraping_logged_out");
  }

  // Handle scraping_warning dismiss nếu có
  if (page.url().includes("/accounts/scraping_warning")) {
    log("RCV: scraping_warning → Dismiss");
    await page
      .evaluate(() => {
        const TEXTS = ["Dismiss", "OK", "Got it"];
        for (const el of [
          ...document.querySelectorAll('[role="button"]'),
          ...document.querySelectorAll("button"),
          ...document.querySelectorAll('div[tabindex="0"]'),
        ]) {
          const txt = (el.innerText || el.textContent || "").trim();
          if (
            TEXTS.some((t) => txt === t || txt.includes(t)) &&
            el.getBoundingClientRect().width > 0
          ) {
            el.click();
            return;
          }
        }
      })
      .catch(() => {});
    await sleep(3000);
  }

  try {
    await igMonitorLoop(page, 30000);
  } catch (e) {
    if (e.message === "scraping_logged_out") throw e;
  }
  await sleep(2000);

  // ── Step 7: Extract profile ──
  const profile = await getIGProfile(page);
  const rawCookies = await page.cookies("https://www.instagram.com");
  const cookieStr = buildCookieStr(rawCookies);

  return {
    username: profile.ok ? profile.username : chosen,
    posts: profile.ok ? profile.posts : 0,
    followers: profile.ok ? profile.followers : 0,
    following: profile.ok ? profile.following : 0,
    cookieStr,
  };
}

module.exports = { rcvAccount, GALAXY_NOTE3 };
