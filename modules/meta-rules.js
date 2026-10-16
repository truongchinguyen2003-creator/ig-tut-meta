"use strict";
const { sleep, log } = require("./utils");

async function handleCookieConsent(page) {
  if (
    !page.url().includes("auth.meta.com") &&
    !page.url().includes("consent") &&
    !page.url().includes("cookie_choice")
  )
    return false;
  log("META: cookie consent → Allow all cookies");
  await sleep(2000);
  const ok = await page
    .evaluate(() => {
      for (const el of [
        ...document.querySelectorAll('[role="none"]'),
        ...document.querySelectorAll('[role="button"]'),
        ...document.querySelectorAll("button"),
      ]) {
        if (
          (el.innerText || "").includes("Allow all cookies") &&
          el.getBoundingClientRect().width > 0
        ) {
          el.click();
          return true;
        }
      }
      return false;
    })
    .catch(() => false);
  if (ok) {
    await sleep(4000);
    return true;
  }
  return false;
}

async function runRulesOnce(page) {
  return page
    .evaluate(() => {
      const txt = document.body?.innerText || "";
      const url = location.href;
      function hasAria(l) {
        return !!document.querySelector(`a[aria-label^="${l}"]`);
      }
      function clickAria(l) {
        const e = [...document.querySelectorAll("a[aria-label]")].find((e) =>
          e.getAttribute("aria-label")?.startsWith(l),
        );
        if (e) {
          e.scrollIntoView({ block: "center", behavior: "instant" });
          e.click();
          return true;
        }
        return false;
      }
      function clickB(...ts) {
        for (const t of ts) {
          for (const s of [...document.querySelectorAll("span, div")].filter(
            (s) =>
              s.textContent.trim() === t &&
              !s.closest('[aria-hidden="true"]') &&
              !s.querySelector("span, div"),
          )) {
            let p = s.parentElement;
            while (p && p !== document.body) {
              const r = p.getAttribute("role");
              if (
                (r === "none" || r === "presentation" || r === "button") &&
                p.getBoundingClientRect().width > 0
              ) {
                p.scrollIntoView({ block: "center", behavior: "instant" });
                p.click();
                return true;
              }
              p = p.parentElement;
            }
          }
        }
        return false;
      }

      if (txt.includes("Something went wrong")) return "something_wrong";
      if (txt.includes("Use another profile")) return "scraping_logged_out";
      if (txt.includes("Check your text messages")) return "sms_required";
      if (
        txt.includes("Add your profiles and tools to the same") ||
        txt.includes("Finish adding your profiles") ||
        txt.includes("Finish adding to your Meta") ||
        txt.includes("Do you want to add your profiles") ||
        txt.includes("Finish adding your accounts")
      ) {
        clickB("Confirm");
        clickB("Continue");
        return "add_profiles";
      }
      if (
        txt.includes("To add your profiles and tools") ||
        txt.includes("To finish adding") ||
        txt.includes("allow the following")
      ) {
        clickB(
          "Allow and add now",
          "Allow and finish adding",
          "Allow and finish",
          "Continue",
        );
        return "allow";
      }
      if (
        url.includes("/manage") &&
        !url.includes("/remove") &&
        !url.includes("/add") &&
        txt.includes("AI, devices and more") &&
        hasAria("Remove from this Meta Account")
      ) {
        clickAria("Remove from this Meta Account");
        return "remove";
      }
      if (txt.includes("Add to this Meta Account")) {
        clickAria("Add Instagram");
        return "add_ig";
      }
      if (
        txt.includes("Select the account you want to add") ||
        txt.includes("Select an account")
      ) {
        clickAria("Add Instagram account");
        return "select_ig";
      }
      if (hasAria("Add Instagram account")) {
        clickAria("Add Instagram account");
        return "add_ig_link";
      }
      if (url.includes("/fxcal/auth/login")) {
        clickB("Continue");
        return "fxcal";
      }
      if (txt.includes("Unlock cross-profile")) {
        clickB("Confirm");
        clickB("Continue");
        return "crossprofile";
      }
      if (txt.includes("Unlock connected experiences")) {
        clickB("Continue");
        return "connected_experiences";
      }
      if (
        txt.includes("What's your birthday") ||
        txt.includes("What\u2019s your birthday") ||
        txt.includes("What's your date of birth") ||
        txt.includes("What\u2019s your date of birth") ||
        txt.includes("When is your birthday") ||
        txt.includes("Which is your date of birth")
      ) {
        clickB("Continue");
        return "birthday";
      }
      if (
        document.querySelector('a[aria-label^="Move out of this Meta Account"]')
      ) {
        clickAria("Move out of this Meta Account");
        return "move_out";
      }
      if (txt.includes("Are you sure you want to move")) {
        clickB("Yes, continue");
        return "confirm_move";
      }
      if (txt.includes("Are you sure you want to remove")) {
        clickB("Yes, continue");
        return "confirm_remove";
      }
      if (txt.includes("You will lose access")) {
        clickB("Continue");
        return "lose_access";
      }
      if (
        txt.includes("Move your Meta tools to a new") ||
        txt.includes("Move your Meta tools into a new")
      )
        return "need_password";
      if (
        txt.includes("You're all set") ||
        txt.includes("You\u2019re all set")
      ) {
        clickB("OK", "Ok");
        return "done";
      }
      if (txt.includes("Finish moving")) {
        clickB("Yes, finish moving");
        return "finish_moving";
      }
      if (txt.includes("Do you want to move your Meta tools now")) {
        clickB("Yes, move now");
        return "move_now";
      }
      // Password required during remove/kick
      if (
        txt.includes("re-enter your password") ||
        txt.includes("please re-enter")
      )
        return "need_password";
      // Check your email (IG auth or Meta security code)
      if (txt.includes("Check your email")) return "check_email";
      return null;
    })
    .catch(() => null);
}

async function metaRulesLoop(page, durationMs = 50000, options = {}) {
  const start = Date.now();
  let lastRule = "";
  while (Date.now() - start < durationMs) {
    const rule = await runRulesOnce(page);
    if (rule && rule !== lastRule) {
      log(`META rule: ${rule}`);
      lastRule = rule;
      if (rule === "done") return "done";
      if (rule === "something_wrong") return "something_wrong";
      if (rule === "scraping_logged_out") return "scraping_logged_out";
      if (rule === "sms_required") {
        log("META: SMS verification required → fail");
        return "sms_required";
      }
      if (rule === "need_password" && options.password) {
        log("META: entering password...");
        await page.evaluate((pw) => {
          const inp = document.querySelector('input[type="password"]');
          if (inp) {
            inp.focus();
            const s = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set;
            s.call(inp, pw);
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }, options.password);
        await sleep(1000);
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('[role="button"]')) {
            if ((el.innerText || "").trim() === "Continue") {
              el.click();
              return;
            }
          }
        });
        await sleep(4000);
        lastRule = "";
        continue;
      }
      if (rule === "check_email" && options.wpMail && options.wpPassword) {
        log("META: Check your email → IMAP for auth code...");
        const { getIGAuthCode, getMetaSecurityCode } = require("./imap");
        // Try IG auth code (8 digits, "Authenticate your profile") first, then Meta security code
        let code = await getIGAuthCode(options.wpMail, options.wpPassword);
        if (!code)
          code = await getMetaSecurityCode(options.wpMail, options.wpPassword);
        if (code) {
          log(`META: email code = ${code}`);
          await page.evaluate((c) => {
            const inp = document.querySelector(
              'input[type="text"], input[autocomplete="off"], input[inputmode="numeric"]',
            );
            if (inp) {
              inp.focus();
              const s = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
              ).set;
              s.call(inp, c);
              inp.dispatchEvent(new Event("input", { bubbles: true }));
              inp.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }, code);
          await sleep(1000);
          await page.evaluate(() => {
            for (const el of document.querySelectorAll('[role="button"]')) {
              if ((el.innerText || "").trim() === "Continue") {
                el.click();
                return;
              }
            }
          });
          await sleep(10000);
        } else {
          log("META: email code not found");
        }
        lastRule = "";
        continue;
      }
      await sleep(2500);
    } else {
      lastRule = "";
      await sleep(1000);
    }

    // Early exit: check AI devices on manage page
    // kickMode: success khi AI devices KHÔNG còn
    // addMode (default): success khi AI devices CÓ
    if (!options.kickMode) {
      const hasAI = await page
        .evaluate(() => {
          if (
            !location.href.includes("/manage") &&
            !location.href.includes("/home")
          )
            return false;
          for (const item of document.querySelectorAll('[role="listitem"]')) {
            const t = item.innerText || "";
            if (
              t.includes("AI, devices and more") &&
              (t.includes("Manage") || t.includes("Remove"))
            )
              return true;
          }
          return false;
        })
        .catch(() => false);
      if (hasAI) {
        log("META: AI devices listed → done");
        return "done";
      }
    }
  }
  return "timeout";
}

module.exports = { handleCookieConsent, runRulesOnce, metaRulesLoop };
