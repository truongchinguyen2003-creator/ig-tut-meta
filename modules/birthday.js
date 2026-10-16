"use strict";
const { sleep, log } = require("./utils");

async function fillBirthday(page) {
  log("BIRTHDAY: filling random...");

  // Wait for select fields
  try {
    await page.waitForSelector('select[title="Month:"]', { timeout: 15000 });
  } catch {}

  const ok = await page
    .evaluate(() => {
      const monthSelect = document.querySelector('select[title="Month:"]');
      const daySelect = document.querySelector('select[title="Day:"]');
      const yearSelect = document.querySelector('select[title="Year:"]');

      // Fallback: any 3 selects
      const selects = document.querySelectorAll("select");
      const m = monthSelect || selects[0];
      const d = daySelect || selects[1];
      const y = yearSelect || selects[2];
      if (!m || !d || !y) return false;

      const setVal = (el, val) => {
        el.focus();
        el.value = val.toString();
        ["input", "change", "blur"].forEach((e) =>
          el.dispatchEvent(new Event(e, { bubbles: true })),
        );
      };

      const month = Math.floor(Math.random() * 12) + 1;
      const day = Math.floor(Math.random() * 28) + 1;
      const year = Math.floor(Math.random() * 31) + 1960;

      setVal(m, month);
      setVal(d, day);
      setVal(y, year);
      return { month, day, year };
    })
    .catch(() => false);

  if (!ok) {
    log("BIRTHDAY: select fields not found");
    return false;
  }
  log(`BIRTHDAY: set ${ok.day}/${ok.month}/${ok.year}`);
  await sleep(1000);

  // Click Next
  await page
    .evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[role="button"]')).find(
        (b) =>
          b.textContent.trim() === "Next" &&
          b.getAttribute("aria-disabled") !== "true",
      );
      if (btn) btn.click();
    })
    .catch(() => {});
  await sleep(2000);

  // Click Yes / Submit
  await page
    .evaluate(() => {
      for (const btn of [
        ...document.querySelectorAll("button"),
        ...document.querySelectorAll('[role="button"]'),
      ]) {
        const t = btn.textContent.trim();
        if (["Yes", "Submit", "Confirm"].includes(t)) {
          btn.click();
          return;
        }
      }
    })
    .catch(() => {});
  await sleep(2000);

  log("BIRTHDAY: done ✅");
  return true;
}

module.exports = { fillBirthday };
