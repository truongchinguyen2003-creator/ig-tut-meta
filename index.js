"use strict";

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");

puppeteer.use(StealthPlugin());

const { sleep, log, IGDieError } = require("./modules/utils");
const {
  parseIGMoiLine,
  parseMailLamLine,
  parseHotmailLine,
  cookieStrToPuppeteer,
  buildCookieStr,
} = require("./modules/cookies");
const { igMonitorLoop } = require("./modules/ig-monitor");
const { handleCookieConsent, metaRulesLoop } = require("./modules/meta-rules");
const {
  clickBtn,
  clickAriaLabel,
  clickContinueAs,
} = require("./modules/clicks");
const { getIGProfile } = require("./modules/profile");
const { cleanupContactEmails } = require("./modules/email-cleanup");
const { rcvAccount } = require("./modules/rcv");
const { setup2FA } = require("./modules/twofa");
const { addHotmail, checkHotmailPrimary } = require("./modules/contact-info");

const CONFIG = {
  HEADLESS: false,
  EXECUTABLE_PATH: null,
  WIN_SIZE: process.argv[5] || "1280,720",
  WIN_POS1: process.argv[6] || "0,0",
  WIN_POS2: process.argv[7] || "1280,0",
  FILES: (() => {
    const p = require("path");
    const ig = process.argv[2] || "ig-moi.txt";
    const dir = p.dirname(ig);
    return {
      IG_MOI: ig,
      MAIL_LAM: process.argv[3] || "meta-wp.txt",
      HOTMAIL: process.argv[4] || "hotmail.txt",
      OUTPUT: p.join(dir, "result.txt"),
      FAIL: p.join(dir, "fail.txt"),
      PARTIAL: p.join(dir, "partial.txt"),
    };
  })(),
  LANG_ARGS: [
    "--lang=en-US",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--no-sandbox",
  ],
};

function buildArgs(size, pos) {
  return [
    ...CONFIG.LANG_ARGS,
    `--window-size=${size}`,
    `--window-position=${pos}`,
  ];
}

// ═══════════════════════════════════════════════════════════════════
// PROCESS ONE TRIPLET: ig-moi + mail-lam + hotmail
// ═══════════════════════════════════════════════════════════════════
async function processTriplet(igMoi, mailLam, hotmail) {
  log(`\n${"═".repeat(60)}`);
  log(
    `IG mồi: ${igMoi.username} | Mail: ${mailLam.mail} | Hotmail: ${hotmail.hotmail}`,
  );
  log("═".repeat(60));

  let browser1 = null,
    browser2 = null;
  const result = { phase: 0, data: {} };

  try {
    // ════════════════════════ BROWSER 1 ════════════════════════
    const opts1 = {
      headless: CONFIG.HEADLESS,
      args: buildArgs(CONFIG.WIN_SIZE, CONFIG.WIN_POS1),
    };
    if (CONFIG.EXECUTABLE_PATH) opts1.executablePath = CONFIG.EXECUTABLE_PATH;
    browser1 = await puppeteer.launch(opts1);
    const pages1 = await browser1.pages();
    const igBaitTab = pages1[0] || (await browser1.newPage());
    await igBaitTab.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });

    // ── PHASE 1: Link IG mồi + Meta ──
    log("── PHASE 1: Link IG mồi + Meta ──");
    result.phase = 1;

    // Tab 1: IG mồi
    await igBaitTab
      .goto("https://www.instagram.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      })
      .catch(() => {});
    await sleep(1500);
    await igBaitTab.setCookie(
      ...cookieStrToPuppeteer(igMoi.cookieStr, ".instagram.com"),
    );
    await igBaitTab.goto("https://www.instagram.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(4000);
    await igMonitorLoop(igBaitTab, 60000);

    // Tab 2: Meta wp.pl
    const metaTab1 = await browser1.newPage();
    await metaTab1.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await metaTab1
      .goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      })
      .catch(() => {});
    await sleep(1500);
    await metaTab1.setCookie(
      ...cookieStrToPuppeteer(mailLam.cookieStr, ".facebook.com"),
    );
    await metaTab1.setCookie(
      ...cookieStrToPuppeteer(mailLam.cookieStr, ".meta.com"),
    );
    await metaTab1.goto("https://accountscenter.meta.com/manage", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(4000);
    for (let i = 0; i < 5; i++) {
      if (
        metaTab1.url().includes("consent") ||
        metaTab1.url().includes("cookie_choice")
      ) {
        await handleCookieConsent(metaTab1);
        await sleep(3000);
      } else break;
    }

    // Add account — link Meta ↔ IG mồi
    await clickBtn(metaTab1, "Add accounts", "Add profiles and devices");
    await sleep(3000);
    await clickAriaLabel(metaTab1, "Add Instagram");
    await sleep(4000);

    // Handle auth.meta.com → Continue as
    for (let i = 0; i < 10; i++) {
      if (
        metaTab1.url().includes("auth.meta.com") ||
        metaTab1.url().includes("fxauth")
      )
        break;
      await sleep(1500);
    }
    for (let i = 0; i < 3; i++) {
      if (metaTab1.url().includes("consent")) {
        await handleCookieConsent(metaTab1);
        await sleep(2000);
      } else break;
    }
    await clickContinueAs(metaTab1);
    await sleep(3000);

    // Meta rules (retry nếu something_wrong)
    for (let p1Attempt = 0; p1Attempt < 3; p1Attempt++) {
      const p1Result = await metaRulesLoop(metaTab1, 50000, {
        password: mailLam.passmeta,
        wpMail: mailLam.mail,
        wpPassword: mailLam.passmeta,
      });

      if (p1Result === "something_wrong" && p1Attempt < 2) {
        log(
          `PHASE 1: something_wrong → reload + retry (attempt ${p1Attempt + 2})...`,
        );
        // Reload cả IG mồi + Meta
        await igBaitTab
          .goto("https://www.instagram.com/", {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          })
          .catch(() => {});
        await metaTab1
          .goto("https://accountscenter.meta.com/manage", {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          })
          .catch(() => {});
        await sleep(5000);

        // Re-add
        await clickBtn(metaTab1, "Add accounts", "Add profiles and devices");
        await sleep(3000);
        await clickAriaLabel(metaTab1, "Add Instagram");
        await sleep(4000);

        for (let i = 0; i < 10; i++) {
          if (
            metaTab1.url().includes("auth.meta.com") ||
            metaTab1.url().includes("fxauth")
          )
            break;
          await sleep(1500);
        }
        for (let i = 0; i < 3; i++) {
          if (metaTab1.url().includes("consent")) {
            await handleCookieConsent(metaTab1);
            await sleep(2000);
          } else break;
        }
        await clickContinueAs(metaTab1);
        await sleep(3000);
        continue;
      }
      break;
    }

    // Check wp.pl is primary on contact_points
    await metaTab1.goto(
      "https://accountscenter.meta.com/account_overview/contact_points",
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );
    await sleep(4000);
    // Select wp.pl as primary if not already
    await metaTab1.evaluate((mail) => {
      const inp = document.querySelector(
        `input[type="radio"][value="${mail}"]`,
      );
      if (inp && inp.getAttribute("aria-checked") !== "true") {
        const label = inp.closest("label");
        if (label) label.click();
      }
    }, mailLam.mail);
    await sleep(5000);

    log("PHASE 1: done ✅");

    // ── PHASE 2: Delete extra emails ──
    log("── PHASE 2: Delete extra emails ──");
    result.phase = 2;
    await cleanupContactEmails(metaTab1, mailLam.mail, mailLam.passmeta);
    log("PHASE 2: done ✅");

    // ════════════════════════ BROWSER 2 ════════════════════════
    const opts2 = {
      headless: CONFIG.HEADLESS,
      args: buildArgs(CONFIG.WIN_SIZE, CONFIG.WIN_POS2),
    };
    if (CONFIG.EXECUTABLE_PATH) opts2.executablePath = CONFIG.EXECUTABLE_PATH;
    browser2 = await puppeteer.launch(opts2);
    const pages2 = await browser2.pages();
    const rcvTab = pages2[0] || (await browser2.newPage());
    await rcvTab.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    // ── PHASE 3: RCV account (retry nếu bị scraping_logged_out) ──
    log("── PHASE 3: RCV account ──");
    result.phase = 3;
    let rcvData = null;
    const MAX_RCV_RETRIES = 2;

    for (let rcvAttempt = 0; rcvAttempt < MAX_RCV_RETRIES; rcvAttempt++) {
      try {
        if (rcvAttempt > 0)
          log(`PHASE 3: retry RCV (attempt ${rcvAttempt + 1})...`);
        rcvData = await rcvAccount(
          rcvTab,
          mailLam.mail,
          mailLam.passmeta,
          igMoi.username,
        );
        break; // success
      } catch (rcvErr) {
        if (
          rcvErr.message === "scraping_logged_out" &&
          rcvAttempt < MAX_RCV_RETRIES - 1
        ) {
          log("PHASE 3: scraping_logged_out → retrying RCV...");
          await sleep(5000);
          continue;
        }
        throw rcvErr; // non-recoverable
      }
    }
    if (!rcvData) throw new IGDieError("RCV failed after retries");

    result.data = { ...result.data, ...rcvData };
    log(
      `PHASE 3: done ✅ — ${rcvData.username} | ${rcvData.posts} posts | ${rcvData.followers} followers`,
    );

    // Ghi partial data ngay — phòng crash sau này
    try {
      const d = result.data;
      const partialLine = [
        d.username || "",
        mailLam.passmeta,
        "",
        mailLam.mail,
        `${d.posts} posts`,
        `${d.followers} followers`,
        `${d.following} following`,
        d.cookieStr || "",
      ].join("|");
      fs.appendFileSync(CONFIG.FILES.PARTIAL, partialLine + "\n");
      log(`📝 Partial saved to ${CONFIG.FILES.PARTIAL}`);
    } catch (e) {
      log(`⚠ Partial save error: ${e.message}`);
    }

    // ── PHASE 4: Open Meta tab on browser 2 ──
    log("── PHASE 4: Meta tab on browser 2 ──");
    result.phase = 4;
    const metaTab2 = await browser2.newPage();
    await metaTab2.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await metaTab2
      .goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      })
      .catch(() => {});
    await sleep(1500);
    await metaTab2.setCookie(
      ...cookieStrToPuppeteer(mailLam.cookieStr, ".facebook.com"),
    );
    await metaTab2.setCookie(
      ...cookieStrToPuppeteer(mailLam.cookieStr, ".meta.com"),
    );
    await metaTab2.goto("https://accountscenter.meta.com/manage", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(4000);
    for (let i = 0; i < 5; i++) {
      if (
        metaTab2.url().includes("consent") ||
        metaTab2.url().includes("cookie_choice")
      ) {
        await handleCookieConsent(metaTab2);
        await sleep(3000);
      } else break;
    }
    log("PHASE 4: done ✅");

    // ── PHASE 5: Kick Meta from IG mồi → Link Meta to IG RCV ──
    log("── PHASE 5a: Kick Meta from IG mồi ──");
    result.phase = 5;

    // Browser 1: IG mồi tab → account center → manage AI devices → kick
    await igBaitTab.bringToFront();
    await igBaitTab.goto("https://accountscenter.instagram.com/manage/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(4000);

    // Click "Manage [Name]" link inside AI devices listitem
    const manageClicked = await igBaitTab
      .evaluate(() => {
        for (const item of document.querySelectorAll('[role="listitem"]')) {
          if (!(item.innerText || "").includes("AI, devices and more"))
            continue;
          const link = item.querySelector('a[aria-label^="Manage"]');
          if (link) {
            link.scrollIntoView({ block: "center", behavior: "instant" });
            link.click();
            return link.getAttribute("aria-label");
          }
        }
        return null;
      })
      .catch(() => null);
    if (manageClicked) log(`PHASE 5a: clicked "${manageClicked}"`);
    else log("PHASE 5a: WARNING — Manage link not found");
    await sleep(3000);

    // Handle kick rules with password — kickMode disables "AI devices listed" early exit
    await metaRulesLoop(igBaitTab, 60000, {
      password: mailLam.passmeta,
      wpMail: mailLam.mail,
      wpPassword: mailLam.passmeta,
      kickMode: true,
    });

    // Verify kicked: AI devices should be gone
    await igBaitTab.goto("https://accountscenter.instagram.com/manage/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(4000);
    const stillHasAI = await igBaitTab
      .evaluate(() => {
        for (const item of document.querySelectorAll('[role="listitem"]')) {
          if ((item.innerText || "").includes("AI, devices and more"))
            return true;
        }
        return false;
      })
      .catch(() => true);

    if (stillHasAI) {
      log("PHASE 5a: AI still linked → retry kick...");
      // Retry: click Manage again
      await igBaitTab
        .evaluate(() => {
          for (const item of document.querySelectorAll('[role="listitem"]')) {
            if (!(item.innerText || "").includes("AI, devices and more"))
              continue;
            const link = item.querySelector('a[aria-label^="Manage"]');
            if (link) {
              link.click();
              return;
            }
          }
        })
        .catch(() => {});
      await sleep(3000);
      await metaRulesLoop(igBaitTab, 60000, {
        password: mailLam.passmeta,
        wpMail: mailLam.mail,
        wpPassword: mailLam.passmeta,
        kickMode: true,
      });

      // Final verify
      await igBaitTab.goto("https://accountscenter.instagram.com/manage/", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await sleep(4000);
      const stillHas2 = await igBaitTab
        .evaluate(() => {
          for (const item of document.querySelectorAll('[role="listitem"]')) {
            if ((item.innerText || "").includes("AI, devices and more"))
              return true;
          }
          return false;
        })
        .catch(() => true);
      if (stillHas2) log("PHASE 5a: WARNING — still linked after retry");
      else log("PHASE 5a: kicked ✅ (retry)");
    } else {
      log("PHASE 5a: kicked ✅");
    }

    // Browser 2: Meta tab → add IG RCV (retry nếu bị scraping_logged_out)
    log("── PHASE 5b: Link Meta to IG RCV ──");
    for (let link5bAttempt = 0; link5bAttempt < 2; link5bAttempt++) {
      await metaTab2.bringToFront();
      await metaTab2.goto("https://accountscenter.meta.com/manage", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await sleep(4000);

      await clickBtn(metaTab2, "Add accounts", "Add profiles and devices");
      await sleep(3000);
      const link5bResult = await metaRulesLoop(metaTab2, 50000, {
        password: mailLam.passmeta,
        wpMail: mailLam.mail,
        wpPassword: mailLam.passmeta,
      });

      if (link5bResult === "sms_required") {
        throw new IGDieError("sms_verification_required");
      }
      if (link5bResult === "scraping_logged_out" && link5bAttempt < 1) {
        log("PHASE 5b: scraping_logged_out → re-doing RCV...");
        await rcvTab.bringToFront();
        const newRcvData = await rcvAccount(
          rcvTab,
          mailLam.mail,
          mailLam.passmeta,
          igMoi.username,
        );
        result.data = { ...result.data, ...newRcvData };
        log(`PHASE 5b: re-RCV done — ${newRcvData.username}`);
        continue; // retry link
      }
      break; // success or non-recoverable
    }
    log("PHASE 5b: done ✅");

    // ── PHASE 6: Enable 2FA ──
    log("── PHASE 6: Enable 2FA ──");
    result.phase = 6;
    await metaTab2.goto("https://accountscenter.meta.com/manage", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(3000);
    const twoFaSecret = await setup2FA(metaTab2, {
      wpMail: mailLam.mail,
      wpPassword: mailLam.passmeta,
    });
    if (!twoFaSecret) throw new Error("2FA setup failed");
    result.data.twofa = twoFaSecret;
    log(`PHASE 6: done ✅ — 2FA: ${twoFaSecret}`);

    // Update partial với 2FA
    try {
      const d = result.data;
      const partialLine = [
        d.username || "",
        mailLam.passmeta,
        d.twofa,
        mailLam.mail,
        `${d.posts} posts`,
        `${d.followers} followers`,
        `${d.following} following`,
        d.cookieStr || "",
      ].join("|");
      fs.appendFileSync(CONFIG.FILES.PARTIAL, partialLine + "\n");
      log(`📝 Partial+2FA saved to ${CONFIG.FILES.PARTIAL}`);
    } catch (e) {
      log(`⚠ Partial save error: ${e.message}`);
    }

    // ── PHASE 7: Add hotmail (retry up to 3 hotmails) ──
    log("── PHASE 7: Add hotmail ──");
    result.phase = 7;

    let hotmailSuccess = null;
    const MAX_HOTMAIL_RETRIES = 3;

    for (let hAttempt = 0; hAttempt < MAX_HOTMAIL_RETRIES; hAttempt++) {
      // Đọc hotmail hiện tại từ file
      const hotLine = readFirst(CONFIG.FILES.HOTMAIL);
      if (!hotLine) {
        log("PHASE 7: no more hotmails");
        break;
      }
      const currentHotmail = parseHotmailLine(hotLine);
      if (!currentHotmail) {
        log("PHASE 7: hotmail parse failed, skip");
        removeLine(CONFIG.FILES.HOTMAIL);
        continue;
      }

      log(
        `PHASE 7: attempt ${hAttempt + 1}/${MAX_HOTMAIL_RETRIES} — ${currentHotmail.hotmail}`,
      );

      // Quay lại tab meta → navigate tới Login and security
      await metaTab2.bringToFront();
      if (hAttempt > 0) {
        // Nếu retry → navigate lại trang manage
        await metaTab2.goto("https://accountscenter.meta.com/manage", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await sleep(3000);
      }

      const added = await addHotmail(
        metaTab2,
        currentHotmail.hotmail,
        currentHotmail.passhot,
        currentHotmail.refresh_token,
        currentHotmail.client_id,
      );

      if (added === true) {
        // Check primary
        await rcvTab.bringToFront();
        await checkHotmailPrimary(rcvTab, currentHotmail.hotmail);
        hotmailSuccess = currentHotmail;
        log(`PHASE 7: done ✅ — ${currentHotmail.hotmail}`);
        break;
      }

      // "already_in_use" hoặc code không về → hotmail hỏng → xóa, thử con tiếp
      const reason =
        added === "already_in_use" ? "ALREADY_IN_USE" : "HOTMAIL_CODE_TIMEOUT";
      log(
        `PHASE 7: hotmail ${currentHotmail.hotmail} → ${reason} → removing, trying next`,
      );
      try {
        fs.appendFileSync(
          CONFIG.FILES.FAIL,
          currentHotmail.raw + `|${reason}\n`,
        );
      } catch {}
      removeLine(CONFIG.FILES.HOTMAIL);
    }

    if (!hotmailSuccess) throw new Error("All hotmail attempts failed");

    // ── BUILD OUTPUT ──
    // username|passmeta|2fa|mailwp|posts|followers|following|cookie|hotmail|passhot|refresh_token|client_id|mailrcvhotmail
    const line = [
      result.data.username,
      mailLam.passmeta,
      result.data.twofa,
      mailLam.mail,
      `${result.data.posts} posts`,
      `${result.data.followers} followers`,
      `${result.data.following} following`,
      result.data.cookieStr,
      hotmailSuccess.hotmail,
      hotmailSuccess.passhot,
      hotmailSuccess.refresh_token,
      hotmailSuccess.client_id,
      hotmailSuccess.mailrcv,
    ].join("|");

    return { success: true, line };
  } catch (err) {
    log(`❌ FAILED at PHASE ${result.phase}: ${err.message}`);

    // Nếu phase >= 1 (đã link meta+ig mồi) → phải đá meta ra trước khi fail
    if (result.phase >= 1 && browser1) {
      try {
        log("CLEANUP: kicking meta from IG mồi before fail...");
        const allPages = await browser1.pages();
        const baitTab = allPages[0];
        if (baitTab) {
          await baitTab.bringToFront();
          await baitTab
            .goto("https://accountscenter.instagram.com/manage/", {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            })
            .catch(() => {});
          await sleep(4000);

          // Click "Manage" link in AI devices listitem
          const manageClicked = await baitTab
            .evaluate(() => {
              for (const item of document.querySelectorAll(
                '[role="listitem"]',
              )) {
                if (!(item.innerText || "").includes("AI, devices and more"))
                  continue;
                const link = item.querySelector('a[aria-label^="Manage"]');
                if (link) {
                  link.click();
                  return true;
                }
              }
              return false;
            })
            .catch(() => false);

          if (manageClicked) {
            await sleep(3000);
            await metaRulesLoop(baitTab, 60000, {
              password: mailLam.passmeta,
              wpMail: mailLam.mail,
              wpPassword: mailLam.passmeta,
              kickMode: true,
            });
            log("CLEANUP: meta kicked from IG mồi ✅");
          } else {
            log("CLEANUP: no AI devices found (may already be clean)");
          }
        }
      } catch (cleanupErr) {
        log(`CLEANUP: failed — ${cleanupErr.message}`);
      }
    }

    // Build partial fail line
    const d = result.data;
    const line = [
      d.username || "",
      mailLam.passmeta || "",
      d.twofa || "",
      mailLam.mail || "",
      d.posts != null ? `${d.posts} posts` : "",
      d.followers != null ? `${d.followers} followers` : "",
      d.following != null ? `${d.following} following` : "",
      d.cookieStr || "",
      hotmail.hotmail || "",
      hotmail.passhot || "",
      hotmail.refresh_token || "",
      hotmail.client_id || "",
      hotmail.mailrcv || "",
      `PHASE${result.phase}_${err.message}`,
    ].join("|");

    // Determine what failed: IG mồi die vs mail/rcv die vs other
    // IG mồi die: chỉ khi IG mồi bị suspended/login trước Phase 3
    // Mail/RCV fail: recovery_code_not_found, scraping_logged_out, sms_required, log_in_another_device
    // Phase 3+ fail = mail issue (xóa mail, giữ IG mồi)
    const isIGMoiDie = err instanceof IGDieError && result.phase < 3;
    const failType = isIGMoiDie ? "ig" : "mail";
    return { success: false, failType, line, phase: result.phase };
  } finally {
    if (browser1) await browser1.close().catch(() => {});
    if (browser2) await browser2.close().catch(() => {});
    log("Browsers closed");
  }
}

// ═══════════════════════════════════════════════════════════════════
// FILE HELPERS
// ═══════════════════════════════════════════════════════════════════
function readFirst(f) {
  try {
    return (
      fs
        .readFileSync(f, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)[0] || null
    );
  } catch {
    return null;
  }
}
function removeLine(f) {
  try {
    const l = fs.readFileSync(f, "utf8").split("\n");
    l.shift();
    fs.writeFileSync(f, l.join("\n"));
  } catch {}
}
function countLines(f) {
  try {
    return fs
      .readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  log("Meta Add IG v2 — starting...");
  log(`IG mồi: ${CONFIG.FILES.IG_MOI}`);
  log(`Mail:    ${CONFIG.FILES.MAIL_LAM}`);
  log(`Hotmail: ${CONFIG.FILES.HOTMAIL}`);
  log(`Output:  ${CONFIG.FILES.OUTPUT}`);
  log(`Fail:    ${CONFIG.FILES.FAIL}`);
  log(`Partial: ${CONFIG.FILES.PARTIAL}`);

  while (true) {
    const igLine = readFirst(CONFIG.FILES.IG_MOI);
    const mailLine = readFirst(CONFIG.FILES.MAIL_LAM);
    const hotLine = readFirst(CONFIG.FILES.HOTMAIL);

    if (!igLine || !mailLine || !hotLine) {
      log("No more triplets.");
      break;
    }
    log(
      `Remaining: ${countLines(CONFIG.FILES.IG_MOI)} IG | ${countLines(CONFIG.FILES.MAIL_LAM)} Mail | ${countLines(CONFIG.FILES.HOTMAIL)} Hotmail`,
    );

    const igMoi = parseIGMoiLine(igLine);
    const mailLam = parseMailLamLine(mailLine);
    const hotmail = parseHotmailLine(hotLine);

    if (!igMoi) {
      log("⚠ IG parse failed");
      fs.appendFileSync(CONFIG.FILES.FAIL, igLine + "|PARSE_FAILED\n");
      removeLine(CONFIG.FILES.IG_MOI);
      continue;
    }
    if (!mailLam) {
      log("⚠ Mail parse failed");
      fs.appendFileSync(CONFIG.FILES.FAIL, mailLine + "|PARSE_FAILED\n");
      removeLine(CONFIG.FILES.MAIL_LAM);
      continue;
    }
    if (!hotmail) {
      log("⚠ Hotmail parse failed");
      fs.appendFileSync(CONFIG.FILES.FAIL, hotLine + "|PARSE_FAILED\n");
      removeLine(CONFIG.FILES.HOTMAIL);
      continue;
    }

    const result = await processTriplet(igMoi, mailLam, hotmail);

    if (result.success) {
      try {
        fs.appendFileSync(CONFIG.FILES.OUTPUT, result.line + "\n");
        log(`✅ SAVED to ${CONFIG.FILES.OUTPUT}`);
      } catch (e) {
        log(`❌ WRITE ERROR: ${CONFIG.FILES.OUTPUT} — ${e.message}`);
      }
      removeLine(CONFIG.FILES.MAIL_LAM);
      removeLine(CONFIG.FILES.HOTMAIL);
    } else {
      try {
        fs.appendFileSync(CONFIG.FILES.FAIL, result.line + "\n");
        log(`📝 FAIL written to ${CONFIG.FILES.FAIL}`);
      } catch (e) {
        log(`❌ WRITE ERROR: ${CONFIG.FILES.FAIL} — ${e.message}`);
      }

      if (result.failType === "ig") {
        // IG mồi die (phase < 3) → xóa IG mồi, giữ mail+hotmail
        log("IG mồi die → removing IG, keeping mail+hotmail");
        try {
          fs.appendFileSync(
            CONFIG.FILES.FAIL,
            igMoi.raw + "|" + result.line.split("|").pop() + "\n",
          );
        } catch {}
        removeLine(CONFIG.FILES.IG_MOI);
      } else {
        // Mail/RCV/hotmail fail → xóa mail, giữ IG mồi + hotmail
        log("Mail/RCV fail → removing mail, keeping IG+hotmail");
        try {
          fs.appendFileSync(
            CONFIG.FILES.FAIL,
            mailLam.raw + "|" + result.line.split("|").pop() + "\n",
          );
        } catch {}
        removeLine(CONFIG.FILES.MAIL_LAM);
      }
    }

    log("Wait 5s...");
    await sleep(5000);
  }

  log("\nALL DONE");
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
