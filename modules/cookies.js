"use strict";

// ── Parse ig-moi.txt: username|password|cookie(string) ──
function parseIGMoiLine(line) {
  // cookie is everything after 2nd |
  const first = line.indexOf("|");
  if (first === -1) return null;
  const second = line.indexOf("|", first + 1);
  if (second === -1) return null;
  return {
    username: line.substring(0, first),
    password: line.substring(first + 1, second),
    cookieStr: line.substring(second + 1).trim(),
    raw: line,
  };
}

// ── Parse mail-lam.txt: mail|passmeta|username|cookie(string) ──
function parseMailLamLine(line) {
  const parts = line.split("|");
  if (parts.length < 4) return null;
  return {
    mail: parts[0],
    passmeta: parts[1],
    username: parts[2],
    cookieStr: parts.slice(3).join("|").trim(),
    raw: line,
  };
}

// ── Parse hotmail.txt: hotmail|passhot|refresh_token|client_id|mailrcvhotmail ──
function parseHotmailLine(line) {
  const parts = line.split("|");
  if (parts.length < 5) return null;
  return {
    hotmail: parts[0],
    passhot: parts[1],
    refresh_token: parts[2],
    client_id: parts[3],
    mailrcv: parts[4].trim(),
    raw: line,
  };
}

// ── Cookie string → Puppeteer setCookie format ──
function cookieStrToPuppeteer(cookieStr, domain) {
  return cookieStr.split(";").map((s) => s.trim()).filter(Boolean).map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return null;
    const name = pair.substring(0, eq).trim();
    const value = pair.substring(eq + 1).trim();
    if (!name) return null;
    return { name, value, domain, path: "/", httpOnly: false, secure: true, sameSite: "None" };
  }).filter(Boolean);
}

// ── Build ordered cookie string from Puppeteer cookies ──
function buildCookieStr(cookies) {
  const ORDER = ["datr", "ig_did", "mid", "csrftoken", "ds_user_id", "sessionid", "rur"];
  return [...cookies].sort((a, b) => {
    const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1; if (ib === -1) return -1;
    return ia - ib;
  }).map((c) => `${c.name}=${c.value}`).join("; ");
}

module.exports = {
  parseIGMoiLine, parseMailLamLine, parseHotmailLine,
  cookieStrToPuppeteer, buildCookieStr,
};
