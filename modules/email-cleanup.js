"use strict";
const { sleep, log } = require("./utils");
const { clickBtn } = require("./clicks");

// ═══ List emails on contact info page ═══
async function listContactEmails(page) {
  return page
    .evaluate(() => {
      const emails = [];
      for (const item of document.querySelectorAll('[role="listitem"]')) {
        const spans = item.querySelectorAll("span");
        for (const span of spans) {
          const t = span.textContent.trim();
          if (t.includes("@") && t.includes(".") && !t.includes(" "))
            emails.push(t);
        }
      }
      return [...new Set(emails)];
    })
    .catch(() => []);
}

// ═══ Delete first email via UI (requires password) ═══
async function deleteEmailUI(page, email, passmeta) {
  log(`EMAIL: UI delete "${email}"...`);

  // Click on the email listitem
  const clicked = await page.evaluate((target) => {
    for (const item of document.querySelectorAll(
      '[role="listitem"] [role="button"]',
    )) {
      const spans = item.querySelectorAll("span");
      for (const span of spans) {
        if (span.textContent.trim() === target) {
          item.scrollIntoView({ block: "center", behavior: "instant" });
          item.click();
          return true;
        }
      }
    }
    return false;
  }, email);

  if (!clicked) {
    log(`EMAIL: "${email}" not found`);
    return false;
  }
  await sleep(3000);

  // Heading shows email → click "Delete email" button
  await clickBtn(page, "Delete email", "Delete email address");
  await sleep(3000);

  // Confirm dialog: "Delete email address?" → click "Delete"
  await clickBtn(page, "Delete");
  await sleep(3000);

  // Password dialog: "re-enter your password"
  const needPw = await page
    .evaluate(() =>
      (document.body?.innerText || "").includes("re-enter your password"),
    )
    .catch(() => false);
  if (needPw) {
    log("EMAIL: entering password...");
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
    }, passmeta);
    await sleep(1000);
    await clickBtn(page, "Continue");
    await sleep(10000);
  }

  log(`EMAIL: UI deleted "${email}" ✅`);
  return true;
}

// ═══ Delete email via GraphQL API (after password verified) ═══
async function deleteEmailAPI(page, email) {
  log(`EMAIL: API delete "${email}"...`);
  const result = await page
    .evaluate(async (target) => {
      const html = document.documentElement.innerHTML;

      // Extract tokens
      let fb_dtsg = null;
      for (const p of [
        /"DTSGInitialData"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/,
        /"dtsg"\s*:\s*\{"token"\s*:\s*"([^"]+)"/,
        /"token"\s*:\s*"(NAf[^"]+)"/,
      ]) {
        const m = html.match(p);
        if (m) {
          fb_dtsg = m[1];
          break;
        }
      }
      let lsd = null;
      for (const p of [
        /"LSD"\s*,\s*\[\]\s*,\s*\{"token"\s*:\s*"([^"]+)"/,
        /"lsd"\s*:\s*"([^"]+)"/,
      ]) {
        const m = html.match(p);
        if (m) {
          lsd = m[1];
          break;
        }
      }
      if (!fb_dtsg || !lsd) return { ok: false, error: "missing tokens" };

      let jazoest = "2";
      for (let i = 0; i < fb_dtsg.length; i++)
        jazoest = String(
          2 + [...fb_dtsg].reduce((s, c) => s + c.charCodeAt(0), 0),
        );

      const params = new URLSearchParams();
      params.set("fb_dtsg", fb_dtsg);
      params.set("lsd", lsd);
      params.set("jazoest", jazoest);
      params.set("__a", "1");
      params.set("__comet_req", "8");
      params.set("fb_api_caller_class", "RelayModern");
      params.set(
        "fb_api_req_friendly_name",
        "FXAccountsCenterUnifiedDeleteContactPointMutation",
      );
      params.set("server_timestamps", "true");
      params.set("doc_id", "9412959315500210");
      params.set(
        "variables",
        JSON.stringify({
          contact_point_id: btoa(target),
          contact_point_type: "EMAIL",
          client_mutation_id: `del_${Date.now()}`,
          family_device_id: "device_id_fetch_datr",
        }),
      );

      try {
        const resp = await fetch(
          "https://accountscenter.meta.com/api/graphql/",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "X-FB-Friendly-Name":
                "FXAccountsCenterUnifiedDeleteContactPointMutation",
              "X-FB-LSD": lsd,
            },
            body: params.toString(),
            credentials: "include",
          },
        );
        const data = await resp.json();
        const success =
          data?.data?.xfb_delete_feta_contact_point?.success === true;
        return {
          ok: success,
          error: success ? null : JSON.stringify(data).substring(0, 200),
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, email)
    .catch((e) => ({ ok: false, error: e.message }));

  if (result.ok) log(`EMAIL: API deleted "${email}" ✅`);
  else log(`EMAIL: API delete "${email}" failed: ${result.error}`);
  return result.ok;
}

// ═══ Full cleanup: navigate → list → delete all except keepEmail ═══
async function cleanupContactEmails(page, keepEmail, passmeta) {
  log(`EMAIL CLEANUP: keeping "${keepEmail}", deleting rest...`);

  // Click "Login and security" TAB (click, don't navigate!)
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

  // Click "Contact info"
  await clickBtn(page, "Contact info");
  await sleep(4000);

  // List emails
  const emails = await listContactEmails(page);
  const toDelete = emails.filter(
    (e) => e.toLowerCase() !== keepEmail.toLowerCase(),
  );
  log(
    `EMAIL CLEANUP: found ${emails.length} emails, deleting ${toDelete.length}`,
  );

  if (toDelete.length === 0) return true;

  // Delete first one via UI (needs password)
  const firstDeleted = await deleteEmailUI(page, toDelete[0], passmeta);
  if (!firstDeleted) return false;

  // Delete rest via API
  for (let i = 1; i < toDelete.length; i++) {
    await deleteEmailAPI(page, toDelete[i]);
    await sleep(2000);
  }

  log("EMAIL CLEANUP: done ✅");
  return true;
}

module.exports = {
  listContactEmails,
  deleteEmailUI,
  deleteEmailAPI,
  cleanupContactEmails,
};
