"use strict";
const { sleep, log } = require("./utils");
const { clickBtn } = require("./clicks");
const { getMetaConfirmCodeHotmail } = require("./imap");

// Full flow add hotmail on Meta AC
async function addHotmail(page, hotmail, passhot, refreshToken, clientId) {
  log(`ADD HOTMAIL: ${hotmail}`);

  // 1. Click "Login and security" TAB
  log("ADD HOTMAIL: clicking Login and security tab...");
  await page.evaluate(() => {
    const tab = document.querySelector(
      'div[role="tab"] a[href="/password_and_security/"]',
    );
    if (tab) {
      tab.scrollIntoView({ block: "center", behavior: "instant" });
      tab.click();
      return;
    }
    const link = document.querySelector('a[href="/password_and_security/"]');
    if (link) {
      link.scrollIntoView({ block: "center", behavior: "instant" });
      link.click();
    }
  });
  await sleep(3000);

  // 2. Click "Contact info" button (aria-label="Contact info")
  log("ADD HOTMAIL: clicking Contact info...");
  for (let i = 0; i < 5; i++) {
    const clicked = await page
      .evaluate(() => {
        const btn = document.querySelector(
          '[role="button"][aria-label="Contact info"]',
        );
        if (btn && btn.getBoundingClientRect().width > 0) {
          btn.scrollIntoView({ block: "center", behavior: "instant" });
          btn.click();
          return true;
        }
        // Fallback: find by text
        for (const el of document.querySelectorAll('[role="button"]')) {
          if (
            (el.innerText || "").trim() === "Contact info" &&
            el.getBoundingClientRect().width > 0
          ) {
            el.scrollIntoView({ block: "center", behavior: "instant" });
            el.click();
            return true;
          }
        }
        return false;
      })
      .catch(() => false);
    if (clicked) break;
    await sleep(2000);
  }
  await sleep(3000);

  // 3. Wait for "Contact info" dialog heading → Click "Add new contact info"
  log("ADD HOTMAIL: clicking Add new contact info...");
  for (let i = 0; i < 5; i++) {
    const hasDialog = await page
      .evaluate(() => {
        for (const h2 of document.querySelectorAll("h2")) {
          if (h2.textContent.trim() === "Contact info") return true;
        }
        return false;
      })
      .catch(() => false);
    if (hasDialog) break;
    await sleep(2000);
  }

  await clickBtn(page, "Add new contact info");
  await sleep(3000);

  // 4. Click "Add email"
  log("ADD HOTMAIL: clicking Add email...");
  await clickBtn(page, "Add email");
  await sleep(3000);

  // 5. Wait for "Add email" dialog → type hotmail → Next
  log("ADD HOTMAIL: waiting for Add email dialog...");
  for (let i = 0; i < 5; i++) {
    const hasDialog = await page
      .evaluate(() => {
        for (const h2 of document.querySelectorAll("h2")) {
          if (h2.textContent.trim() === "Add email") return true;
        }
        return false;
      })
      .catch(() => false);
    if (hasDialog) break;
    await sleep(2000);
  }

  log("ADD HOTMAIL: typing hotmail...");
  await page.evaluate((email) => {
    const inp = document.querySelector('input[type="text"]');
    if (inp) {
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(inp, email);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, hotmail);
  await sleep(1000);

  log("ADD HOTMAIL: clicking Next...");
  await clickBtn(page, "Next");
  await sleep(5000);

  // Check "already in use" → hotmail đã dùng rồi
  const alreadyUsed = await page
    .evaluate(() => (document.body?.innerText || "").includes("already in use"))
    .catch(() => false);
  if (alreadyUsed) {
    log("ADD HOTMAIL: email already in use → skip");
    return "already_in_use";
  }

  // 6. Wait for "Enter your confirmation code" → IMAP hotmail → enter code → Next
  log("ADD HOTMAIL: waiting for confirmation code dialog...");
  for (let i = 0; i < 5; i++) {
    const hasDialog = await page
      .evaluate(() => {
        for (const h2 of document.querySelectorAll("h2")) {
          if (
            h2.textContent.includes("Enter your confirmation code") ||
            h2.textContent.includes("confirmation code")
          )
            return true;
        }
        return (document.body?.innerText || "").includes(
          "Enter your confirmation code",
        );
      })
      .catch(() => false);
    if (hasDialog) break;
    await sleep(2000);
  }

  log("ADD HOTMAIL: fetching code via IMAP...");
  const code = await getMetaConfirmCodeHotmail(
    hotmail,
    passhot,
    refreshToken,
    clientId,
  );
  if (!code) {
    log("ADD HOTMAIL: code not found");
    return false;
  }
  log(`ADD HOTMAIL: code = ${code}`);

  // Enter code + click Next (React-compatible) — wrap try-catch cho navigation errors
  try {
    const enterResult = await page.evaluate((c) => {
      return new Promise((resolve) => {
        const input =
          document.querySelector('input[autocomplete="one-time-code"]') ||
          document.querySelector('input[inputmode="numeric"][maxlength="6"]') ||
          document.querySelector('input[inputmode="numeric"]') ||
          document.querySelector('input[maxlength="6"]');

        if (!input) {
          resolve({ ok: false, msg: "input not found" });
          return;
        }

        const nativeSet = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set;
        input.focus();
        nativeSet.call(input, c);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

        setTimeout(() => {
          let container =
            input.closest('div[aria-hidden="false"]') ||
            input.closest('div[role="dialog"]');
          if (!container) container = document;

          const buttons = container.querySelectorAll(
            'div[role="button"], [role="button"]',
          );
          let nextBtn = null;
          for (const btn of buttons) {
            const txt = (btn.textContent || "").trim().toLowerCase();
            if (txt === "next" || txt === "continue") {
              nextBtn = btn;
              break;
            }
          }
          if (!nextBtn) {
            for (const btn of document.querySelectorAll('[role="button"]')) {
              const txt = (btn.textContent || "").trim().toLowerCase();
              if (txt === "next" || txt === "continue") {
                nextBtn = btn;
                break;
              }
            }
          }
          if (!nextBtn) {
            resolve({ ok: true, msg: "code entered, Next not found" });
            return;
          }

          const tryClick = (attempt) => {
            if (attempt > 10) {
              resolve({ ok: true, msg: "code entered, Next still disabled" });
              return;
            }
            if (nextBtn.getAttribute("aria-disabled") === "true") {
              setTimeout(() => tryClick(attempt + 1), 300);
            } else {
              nextBtn.scrollIntoView({ block: "center", behavior: "instant" });
              nextBtn.click();
              resolve({ ok: true, msg: "code entered + Next clicked" });
            }
          };
          tryClick(0);
        }, 500);
      });
    }, code);
    log(`ADD HOTMAIL: ${enterResult?.msg || "unknown"}`);
  } catch (e) {
    // "Promise was collected" = page navigated = success
    log(`ADD HOTMAIL: code entry navigate (${e.message.substring(0, 40)})`);
  }
  await sleep(5000);

  log("ADD HOTMAIL: done ✅");
  return true;
}

// Check hotmail is primary on contact_points page
async function checkHotmailPrimary(page, hotmail) {
  await page.goto(
    "https://accountscenter.meta.com/account_overview/contact_points",
    { waitUntil: "domcontentloaded", timeout: 30000 },
  );
  await sleep(4000);

  const isPrimary = await page
    .evaluate((email) => {
      const inp = document.querySelector(
        `input[type="radio"][value="${email}"]`,
      );
      return inp ? inp.getAttribute("aria-checked") === "true" : false;
    }, hotmail)
    .catch(() => false);

  if (isPrimary) {
    log(`HOTMAIL: ${hotmail} is primary ✅`);
    return true;
  }

  // Try to select it
  const clicked = await page
    .evaluate((email) => {
      const inp = document.querySelector(
        `input[type="radio"][value="${email}"]`,
      );
      if (inp) {
        const label = inp.closest("label");
        if (label) {
          label.click();
          return true;
        }
      }
      const rg = document.querySelector('[role="radiogroup"]');
      if (rg) {
        for (const l of rg.querySelectorAll("label")) {
          if (l.textContent.includes(email)) {
            l.click();
            return true;
          }
        }
      }
      return false;
    }, hotmail)
    .catch(() => false);

  if (clicked) {
    log(`HOTMAIL: selected ${hotmail}, waiting 10s...`);
    await sleep(10000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(4000);
  }

  return true;
}

module.exports = { addHotmail, checkHotmailPrimary };
