"use strict";
const { sleep, log, IGDieError } = require("./utils");
const { fillBirthday } = require("./birthday");

function checkDie(url) {
  if (url.includes("no_challenge")) return "no_challenge";
  if (url.includes("accounts/login/")) return "login_page";
  if (url.includes("lrr_limbo")) return "lrr_limbo";
  if (url.includes("afad")) return "afad";
  if (url.includes("auth_platform/challengepicker")) return "challengepicker";
  if (url.includes("/accounts/suspended/")) return "suspended";
  return null;
}

// ── Age 18 radio trên terms/unblock ──
async function selectAge18(page) {
  return page
    .evaluate(() => {
      const r = document.getElementById("IGDSRadioButtonabove_18");
      if (!r) return false;
      const btn = r.closest('[role="button"]');
      if (btn) {
        btn.click();
      } else {
        r.checked = true;
        ["click", "change", "input"].forEach((e) =>
          r.dispatchEvent(new Event(e, { bubbles: true })),
        );
      }
      return true;
    })
    .catch(() => false);
}

// ── Consent handler — tìm nút → bấm luôn, không cần check heading ──
async function handleConsent(page) {
  log("IG: consent page");

  for (let step = 0; step < 8; step++) {
    await sleep(1500);

    // ── Direct attempt: radio PA (click parent container, not input) ──
    const clickedRadioPA = await page
      .evaluate(() => {
        const input = document.querySelector('input[type="radio"][value="PA"]');
        if (!input || input.getAttribute("aria-checked") === "true")
          return false;
        // Click parent container all the way up to the listitem/presentation div
        let el = input.parentElement;
        while (el && el !== document.body) {
          const r = el.getBoundingClientRect();
          if (r.width > 100 && r.height > 30) {
            el.click();
            return true;
          }
          el = el.parentElement;
        }
        // Fallback: click input directly
        input.click();
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })
      .catch(() => false);
    if (clickedRadioPA) {
      log("IG: consent — clicked radio PA (direct)");
      await sleep(1500);
    }

    // ── Direct attempt: Get started via mouse coordinates ──
    const getStartedCoords = await page
      .evaluate(() => {
        for (const el of document.querySelectorAll('[role="button"]')) {
          const t = (el.innerText || el.textContent || "").trim();
          if (
            t === "Get started" &&
            el.getAttribute("aria-disabled") !== "true"
          ) {
            el.scrollIntoView({ block: "center", behavior: "instant" });
            const r = el.getBoundingClientRect();
            if (r.width > 0)
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
        }
        return null;
      })
      .catch(() => null);
    if (getStartedCoords) {
      await page.mouse.click(getStartedCoords.x, getStartedCoords.y);
      log(
        `IG: consent — clicked Get started (mouse ${Math.round(getStartedCoords.x)},${Math.round(getStartedCoords.y)})`,
      );
      await sleep(3000);
      continue;
    }

    // Scan tất cả clickable elements trên page
    const pageButtons = await page
      .evaluate(() => {
        const result = [];
        for (const el of document.querySelectorAll(
          '[role="button"], [role="radio"], [role="none"], [role="checkbox"], [value="PA"], input[type="radio"]',
        )) {
          const txt = (el.innerText || el.textContent || "").trim();
          const disabled = el.getAttribute("aria-disabled") === "true";
          const role = el.getAttribute("role") || el.tagName;
          const checked = el.getAttribute("aria-checked");
          const value = el.getAttribute("value") || el.value;
          const r = el.getBoundingClientRect();
          if (
            r.width > 0 &&
            r.height > 0 &&
            (txt.length > 0 || value) &&
            txt.length < 100
          ) {
            result.push({
              txt,
              disabled,
              role,
              checked,
              value,
              x: r.x + r.width / 2,
              y: r.y + r.height / 2,
            });
          }
        }
        return result;
      })
      .catch(() => []);

    const btnTexts = pageButtons.filter((b) => !b.disabled).map((b) => b.txt);
    log("IG: consent buttons: " + btnTexts.slice(0, 6).join(" | "));

    // ── Priority: Not now (nếu có) ──
    if (btnTexts.includes("Not now")) {
      await multiClick(page, "Not now");
      await sleep(3000);
      await multiClick(page, "Decline optional cookies");
      await sleep(2000);
      return;
    }

    // ── Radio "Use for free with ads" OR value="PA" → tick nếu chưa checked ──
    const radioPA = pageButtons.find(
      (b) =>
        (b.role === "radio" || b.value === "PA") &&
        (b.txt.includes("Use for free with ads") ||
          b.txt.includes("Use free of charge") ||
          b.value === "PA") &&
        b.checked !== "true",
    );
    if (radioPA) {
      await page.mouse.click(radioPA.x, radioPA.y);
      log("IG: clicked radio PA (mouse)");
      await sleep(1500);
      // Click Continue sau khi tick radio
      if (btnTexts.includes("Continue")) {
        await multiClick(page, "Continue");
        await sleep(3000);
        continue;
      }
    }

    // ── Get started — always mouse.click first ──
    const getStartedBtn = pageButtons.find(
      (b) => b.txt === "Get started" && !b.disabled,
    );
    if (getStartedBtn) {
      await page.mouse.click(getStartedBtn.x, getStartedBtn.y);
      log("IG: clicked 'Get started' (mouse)");
      await sleep(3000);
      continue;
    }

    if (btnTexts.includes("Allow all cookies")) {
      await multiClick(page, "Allow all cookies");
      await sleep(3000);
      continue;
    }

    // ── Agree ──
    if (btnTexts.includes("Get started")) {
      await multiClick(page, "Get started");
      await sleep(3000);
      continue;
    }

    // ── Agree ──
    if (btnTexts.includes("Agree")) {
      await multiClick(page, "Agree");
      await sleep(3000);
      continue;
    }

    // ── OK ──
    if (btnTexts.includes("OK")) {
      await multiClick(page, "OK");
      await sleep(2000);
      return;
    }

    // ── Continue (not disabled) ──
    if (btnTexts.includes("Continue")) {
      await multiClick(page, "Continue");
      await sleep(3000);
      continue;
    }

    // ── Confirm ──
    if (btnTexts.includes("Confirm")) {
      await multiClick(page, "Confirm");
      await sleep(3000);
      continue;
    }

    // ── Decline optional cookies ──
    if (btnTexts.some((t) => t.includes("Decline optional cookies"))) {
      await multiClick(page, "Decline optional cookies");
      await sleep(2000);
      return;
    }

    // ── Fallback: confirm_linking radio ──
    const linkRadio = pageButtons.find(
      (b) => b.role === "radio" && b.checked !== "true",
    );
    if (linkRadio) {
      await page.mouse.click(linkRadio.x, linkRadio.y);
      log("IG: clicked fallback radio");
      await sleep(1500);
      if (btnTexts.includes("Next")) {
        await multiClick(page, "Next");
        await sleep(3000);
      } else if (btnTexts.some((t) => t === "Get started")) {
        await multiClick(page, "Get started");
        await sleep(3000);
      }
      continue;
    }

    log("IG: consent — nothing to click");
    break;
  }
}

// Multi-strategy click: evaluate → page.$$ → mouse.click(tọa độ)
async function multiClick(page, text) {
  const SELECTOR = '[role="button"], [role="none"]';
  // Strategy 1: evaluate el.click()
  const ok1 = await page
    .evaluate(
      (t, sel) => {
        for (const el of document.querySelectorAll(sel)) {
          const txt = (el.innerText || el.textContent || "").trim();
          const match =
            t === "Decline optional cookies" ? txt.includes(t) : txt === t;
          if (
            match &&
            el.getAttribute("aria-disabled") !== "true" &&
            el.getBoundingClientRect().width > 0
          ) {
            el.scrollIntoView({ block: "center", behavior: "instant" });
            el.click();
            return true;
          }
        }
        return false;
      },
      text,
      SELECTOR,
    )
    .catch(() => false);
  if (ok1) {
    log("IG: clicked '" + text + "' (evaluate)");
    return true;
  }

  // Strategy 2: page.$$ native .click()
  try {
    const btns = await page.$$(SELECTOR);
    for (const btn of btns) {
      const btnText = await btn
        .evaluate((el) => (el.innerText || el.textContent || "").trim())
        .catch(() => "");
      const match =
        text === "Decline optional cookies"
          ? btnText.includes(text)
          : btnText === text;
      if (!match) continue;
      const disabled = await btn
        .evaluate((el) => el.getAttribute("aria-disabled"))
        .catch(() => null);
      if (disabled === "true") continue;
      await btn.click();
      log("IG: clicked '" + text + "' (native)");
      return true;
    }
  } catch {}

  // Strategy 3: mouse.click() tọa độ
  try {
    const coords = await page.evaluate(
      (t, sel) => {
        for (const el of document.querySelectorAll(sel)) {
          const txt = (el.innerText || el.textContent || "").trim();
          const match =
            t === "Decline optional cookies" ? txt.includes(t) : txt === t;
          if (match && el.getAttribute("aria-disabled") !== "true") {
            el.scrollIntoView({ block: "center", behavior: "instant" });
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0)
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
        }
        return null;
      },
      text,
      SELECTOR,
    );
    if (coords) {
      await page.mouse.click(coords.x, coords.y);
      log(
        "IG: clicked '" +
          text +
          "' (mouse " +
          Math.round(coords.x) +
          "," +
          Math.round(coords.y) +
          ")",
      );
      return true;
    }
  } catch {}

  log("IG: '" + text + "' not found");
  return false;
}

// Native click helper: evaluate → page.$$ → page.mouse.click() tọa độ
async function nativeClickBtn(page, text) {
  // Strategy 1: evaluate
  const ok = await page
    .evaluate((t) => {
      for (const el of document.querySelectorAll('[role="button"]')) {
        const txt = (el.innerText || el.textContent || "").trim();
        if (
          (t === "Decline optional cookies" ? txt.includes(t) : txt === t) &&
          el.getAttribute("aria-disabled") !== "true" &&
          el.getBoundingClientRect().width > 0
        ) {
          el.scrollIntoView({ block: "center", behavior: "instant" });
          el.click();
          return true;
        }
      }
      return false;
    }, text)
    .catch(() => false);
  if (ok) return true;

  // Strategy 2: page.$$ native click
  try {
    const btns = await page.$$('[role="button"]');
    for (const btn of btns) {
      const btnText = await btn
        .evaluate((el) => (el.innerText || el.textContent || "").trim())
        .catch(() => "");
      const match =
        text === "Decline optional cookies"
          ? btnText.includes(text)
          : btnText === text;
      if (!match) continue;
      const disabled = await btn
        .evaluate((el) => el.getAttribute("aria-disabled"))
        .catch(() => null);
      if (disabled === "true") continue;
      const visible = await btn
        .evaluate((el) => el.getBoundingClientRect().width > 0)
        .catch(() => false);
      if (!visible) continue;
      await btn.click();
      return true;
    }
  } catch {}

  // Strategy 3: page.mouse.click() tọa độ trung tâm button
  try {
    const coords = await page.evaluate((t) => {
      for (const el of document.querySelectorAll('[role="button"]')) {
        const txt = (el.innerText || el.textContent || "").trim();
        if (
          (t === "Decline optional cookies" ? txt.includes(t) : txt === t) &&
          el.getAttribute("aria-disabled") !== "true"
        ) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            el.scrollIntoView({ block: "center", behavior: "instant" });
            const rect = el.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
      }
      return null;
    }, text);
    if (coords) {
      await page.mouse.click(coords.x, coords.y);
      log(
        `IG: mouse.click(${Math.round(coords.x)}, ${Math.round(coords.y)}) for "${text}"`,
      );
      return true;
    }
  } catch {}

  return false;
}

// ── Terms/unblock handler (full: age18 radio + Next + Agree to Terms) ──
async function handleTermsUnblock(page) {
  log("IG: terms/unblock");
  await sleep(1500);

  await selectAge18(page);
  await sleep(500);

  // Check if "Next" exists
  const hasNext = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('[role="button"]')).some(
        (el) =>
          el.textContent.trim() === "Next" &&
          el.getAttribute("aria-disabled") !== "true",
      ),
    )
    .catch(() => false);

  if (hasNext) {
    await page
      .evaluate(() => {
        const btn = Array.from(
          document.querySelectorAll('[role="button"]'),
        ).find(
          (el) =>
            el.textContent.trim() === "Next" &&
            el.getAttribute("aria-disabled") !== "true",
        );
        if (btn) btn.click();
      })
      .catch(() => {});
    await sleep(2000);
    await selectAge18(page);
    await sleep(500);
  }

  // Click "Agree to Terms" or "Agree" or "I agree"
  await page
    .evaluate(() => {
      for (const btn of document.querySelectorAll('[role="button"]')) {
        const t = btn.textContent.trim();
        if (
          t === "Agree to Terms" ||
          t === "Agree" ||
          t === "I agree" ||
          t === "Accept"
        ) {
          btn.click();
          return;
        }
      }
    })
    .catch(() => {});
  await sleep(3000);
}

// ── Scraping warning ──
async function handleScrapingWarning(page) {
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

// ── Main monitor loop ──
// options.onCodeEntry(page) → return code string for codeentry
async function igMonitorLoop(page, maxMs = 60000, options = {}) {
  const start = Date.now();
  let lastUrl = "";

  while (Date.now() - start < maxMs) {
    await sleep(1500);
    const url = page.url();

    const die = checkDie(url);
    if (die) throw new IGDieError(die);

    const hasWA = await page
      .evaluate(() =>
        [...document.querySelectorAll("span")].some((s) =>
          s.textContent.toLowerCase().includes("whatsapp"),
        ),
      )
      .catch(() => false);
    if (hasWA) throw new IGDieError("whatsapp_required");

    const otherDevice = await page
      .evaluate(() =>
        (document.body?.innerText || "").includes(
          "Log in on another device to continue",
        ),
      )
      .catch(() => false);
    if (otherDevice) throw new IGDieError("log_in_another_device");

    if (url === lastUrl) continue;
    log(`IG monitor: ${url.substring(0, 80)}`);

    if (url.includes("/terms/unblock/")) {
      await handleTermsUnblock(page);
      lastUrl = url;
      continue;
    }
    if (url.includes("consent")) {
      await handleConsent(page);
      lastUrl = "";
      continue;
    }
    if (url.includes("/auth_platform/codeentry/")) {
      log("IG: codeentry");
      if (options.onCodeEntry) {
        const code = await options.onCodeEntry(page);
        if (code) {
          await page.evaluate((c) => {
            for (const inp of document.querySelectorAll("input")) {
              const r = inp.getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && !inp.disabled) {
                inp.focus();
                const s = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value",
                ).set;
                s.call(inp, c);
                inp.dispatchEvent(new Event("input", { bubbles: true }));
                inp.dispatchEvent(new Event("change", { bubbles: true }));
                return;
              }
            }
          }, code);
          await sleep(1000);
          // Click Continue (desktop + wbloks)
          await page
            .evaluate(() => {
              for (const el of document.querySelectorAll('[role="button"]')) {
                const t = (el.innerText || "").trim();
                const a = el.getAttribute("aria-label") || "";
                if (t === "Continue" || a === "Continue") {
                  el.click();
                  return;
                }
              }
              for (const span of document.querySelectorAll("span")) {
                if (span.textContent.trim() === "Continue") {
                  let p = span.parentElement;
                  while (p) {
                    if (
                      p.getAttribute("role") === "button" ||
                      p.getAttribute("data-interactable")
                    ) {
                      p.click();
                      return;
                    }
                    p = p.parentElement;
                  }
                }
              }
            })
            .catch(() => {});
          await sleep(5000);
        }
      }
      lastUrl = "";
      continue;
    }
    if (url.includes("challenge/?next=") || url.includes("challenge/action/")) {
      const hasBday = await page
        .evaluate(() => document.querySelectorAll("select").length >= 3)
        .catch(() => false);
      if (hasBday) {
        await fillBirthday(page);
        await sleep(3000);
        lastUrl = "";
        continue;
      }
      await page
        .evaluate(() => {
          for (const el of document.querySelectorAll('[role="button"]')) {
            if ((el.innerText || "").trim() === "Continue") {
              el.click();
              return;
            }
          }
        })
        .catch(() => {});
      await sleep(3000);
      lastUrl = url;
      continue;
    }
    if (url.includes("/accounts/scraping_warning")) {
      log("IG: scraping warning");
      await handleScrapingWarning(page);
      lastUrl = "";
      continue;
    }
    // /api/v1/discover/ayml/ → quay về homepage
    if (url.includes("/api/v1/discover/ayml")) {
      log("IG: discover/ayml → back to homepage");
      await page
        .goto("https://www.instagram.com/", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        })
        .catch(() => {});
      await sleep(3000);
      lastUrl = "";
      continue;
    }

    // password reset → Skip
    if (
      url.includes("/accounts/password/reset") ||
      url.includes("password/reset/v2")
    ) {
      log("IG: password reset → Skip");
      const { clickBtn: cb } = require("./clicks");
      await cb(page, "Skip");
      await sleep(3000);
      lastUrl = "";
      continue;
    }

    if (url.includes("onetap") || url.includes("__coig_challenged")) {
      await page
        .evaluate(() => {
          for (const el of document.querySelectorAll('[role="button"]')) {
            if (
              (el.innerText || "").trim() === "Not now" ||
              (el.innerText || "").trim() === "Not Now"
            ) {
              el.click();
              return;
            }
          }
        })
        .catch(() => {});
      await sleep(3000);
      lastUrl = "";
      continue;
    }

    // Homepage OK
    if (
      url === "https://www.instagram.com/" ||
      url === "https://www.instagram.com" ||
      url.startsWith("https://www.instagram.com/?")
    ) {
      // Check nếu bị scraping_warning đã logout (thấy "Use another profile" button)
      const loggedOut = await page
        .evaluate(
          () =>
            !!(
              document.querySelector('[role="button"]') &&
              [...document.querySelectorAll('[role="button"]')].some((b) =>
                (b.innerText || "").includes("Use another profile"),
              )
            ),
        )
        .catch(() => false);
      if (loggedOut) throw new IGDieError("scraping_logged_out");

      const loggedIn = (await page.cookies("https://www.instagram.com")).some(
        (c) => c.name === "sessionid" && c.value,
      );
      if (loggedIn) {
        log("IG: homepage OK ✅");
        return true;
      }
    }
    lastUrl = url;
  }
  throw new IGDieError("monitor_timeout");
}

module.exports = { igMonitorLoop, IGDieError };
