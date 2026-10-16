"use strict";

async function clickBtn(page, ...texts) {
  return page.evaluate((arr) => {
    for (const text of arr) {
      for (const s of [...document.querySelectorAll("span, div")].filter(
        (s) => s.textContent.trim() === text && !s.closest('[aria-hidden="true"]') && !s.querySelector("span, div"),
      )) {
        let p = s.parentElement;
        while (p && p !== document.body) {
          const r = p.getAttribute("role");
          if ((r === "button" || r === "none" || r === "presentation") && p.getBoundingClientRect().width > 0) {
            p.scrollIntoView({ block: "center", behavior: "instant" }); p.click(); return text;
          }
          p = p.parentElement;
        }
      }
    }
    for (const el of [...document.querySelectorAll('[role="button"]'), ...document.querySelectorAll("button")]) {
      const t = (el.innerText || "").trim();
      for (const text of arr) { if (t === text && el.getBoundingClientRect().width > 0) { el.scrollIntoView({ block: "center", behavior: "instant" }); el.click(); return text; } }
    }
    return null;
  }, texts).catch(() => null);
}

async function clickLink(page, ...hrefs) {
  return page.evaluate((arr) => {
    for (const href of arr) {
      const el = document.querySelector(`a[href*="${href}"]`);
      if (el && el.getBoundingClientRect().width > 0) { el.scrollIntoView({ block: "center", behavior: "instant" }); el.click(); return href; }
    }
    return null;
  }, hrefs).catch(() => null);
}

async function clickAriaLabel(page, ...labels) {
  return page.evaluate((arr) => {
    for (const label of arr) {
      const el = [...document.querySelectorAll("a[aria-label], div[aria-label], button[aria-label]")].find(
        (e) => e.getAttribute("aria-label")?.startsWith(label),
      );
      if (el) { el.scrollIntoView({ block: "center", behavior: "instant" }); el.click(); return label; }
    }
    return null;
  }, labels).catch(() => null);
}

async function clickContinueAs(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="button"]')) {
      const t = (el.innerText || "").trim();
      if (t.startsWith("Continue as") || t.startsWith("Log in as")) {
        if (el.getBoundingClientRect().width > 0) { el.scrollIntoView({ block: "center", behavior: "instant" }); el.click(); return t; }
      }
    }
    return null;
  }).catch(() => null);
}

async function typeInInput(page, selector, value) {
  await page.evaluate((sel, val) => {
    const input = document.querySelector(sel);
    if (!input) return;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, val);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector, value);
}

// Type vào input đầu tiên visible có type phù hợp
async function typeInVisibleInput(page, value, inputType = "text") {
  await page.evaluate((val, type) => {
    const inputs = [...document.querySelectorAll(`input[type="${type}"], input:not([type])`)];
    for (const input of inputs) {
      const r = input.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && !input.disabled) {
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, val);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
  }, value, inputType);
}

module.exports = { clickBtn, clickLink, clickAriaLabel, clickContinueAs, typeInInput, typeInVisibleInput };
