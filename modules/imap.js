"use strict";
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { sleep, log } = require("./utils");

// ═══ WP.PL IMAP (standard login) ═══
async function imapWpPl(
  mail,
  password,
  {
    subject,
    codeRegex,
    folders = ["INBOX", "Spam"],
    maxWaitMs = 60000,
    pollMs = 5000,
  },
) {
  log(`IMAP wp.pl: waiting for "${subject}" → ${mail}`);
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const client = new ImapFlow({
        host: "imap.wp.pl",
        port: 993,
        secure: true,
        auth: { user: mail, pass: password },
        logger: false,
      });
      client.on("error", () => {}); // prevent unhandled error crash
      await client.connect();

      for (const folder of folders) {
        try {
          const lock = await client.getMailboxLock(folder);
          try {
            // Search recent emails (last 1 day)
            const msgs = await client.search(
              { since: new Date(Date.now() - 86400000) },
              { uid: true },
            );
            if (msgs.length > 0) {
              // Fetch latest first
              for (const uid of msgs.reverse().slice(0, 20)) {
                const msg = await client.fetchOne(
                  uid,
                  { source: true },
                  { uid: true },
                );
                if (msg?.source) {
                  const parsed = await simpleParser(msg.source);
                  const subj = parsed.subject || "";
                  if (subj.includes(subject) || subject === "*") {
                    const body = (parsed.text || "") + (parsed.html || "");
                    const match =
                      body.match(codeRegex) || subj.match(codeRegex);
                    if (match) {
                      log(`IMAP wp.pl: found code "${match[1]}" in ${folder}`);
                      lock.release();
                      await client.logout().catch(() => {});
                      return match[1];
                    }
                  }
                }
              }
            }
          } finally {
            lock.release();
          }
        } catch {}
      }

      await client.logout().catch(() => {});
    } catch (e) {
      log(`IMAP wp.pl error: ${e.message}`);
    }

    log(`IMAP wp.pl: no match yet, retry in ${pollMs / 1000}s...`);
    await sleep(pollMs);
  }

  log("IMAP wp.pl: timeout");
  return null;
}

// IG recovery code: subject "XXXXXXXXXX is your Instagram recovery code"
async function getRecoveryCode(mail, password) {
  return imapWpPl(mail, password, {
    subject: "is your Instagram recovery code",
    codeRegex: /(\d{10})\s+is your Instagram recovery code/,
    maxWaitMs: 90000,
  });
}

// IG verify code: subject "Verify your profile" — code 6 chữ số SAU "confirm your identity:"
async function getVerifyCode(mail, password) {
  return imapWpPl(mail, password, {
    subject: "Verify your profile",
    codeRegex: /confirm your identity:\s*(\d{6})/s,
    maxWaitMs: 90000,
  });
}

// Meta email confirm code: subject "Potwierdź adres e-mail"
async function getMetaConfirmCodeWp(mail, password) {
  return imapWpPl(mail, password, {
    subject: "Potwierdź adres e-mail",
    codeRegex: /(\d{6})/,
    maxWaitMs: 90000,
  });
}

// Meta Account security code 8 digits: subject "Your Meta Account security code"
async function getMetaSecurityCode(mail, password) {
  return imapWpPl(mail, password, {
    subject: "security code",
    codeRegex: /security code is:\s*(\d{8})/s,
    maxWaitMs: 90000,
  });
}

// IG "Authenticate your profile" code 8 digits: subject "Authenticate your profile"
async function getIGAuthCode(mail, password) {
  return imapWpPl(mail, password, {
    subject: "Authenticate your profile",
    codeRegex: /confirm your identity:\s*(\d{8})/s,
    maxWaitMs: 90000,
  });
}

// ═══ HOTMAIL via dongvanfb API (OAuth2) ═══
async function readHotmailMessages(hotmail, passhot, refreshToken, clientId) {
  const resp = await fetch(
    "https://tools.dongvanfb.net/api/get_messages_oauth2",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        email: hotmail,
        pass: passhot,
        refresh_token: refreshToken,
      }),
    },
  );
  return resp.json();
}

async function getHotmailCode(
  hotmail,
  passhot,
  refreshToken,
  clientId,
  { subjectMatch, codeRegex, maxWaitMs = 90000, pollMs = 5000 },
) {
  log(`HOTMAIL API: waiting for "${subjectMatch}" → ${hotmail}`);
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const data = await readHotmailMessages(
        hotmail,
        passhot,
        refreshToken,
        clientId,
      );

      // API trả về data.message (array) hoặc data.messages hoặc data.value
      const messages =
        data.message ||
        data.messages ||
        data.value ||
        (Array.isArray(data) ? data : []);

      if (Array.isArray(messages) && messages.length > 0) {
        log(`HOTMAIL API: got ${messages.length} messages`);

        for (const msg of messages) {
          // API trả subject + message (HTML body), không phải body
          const subject = msg.subject || msg.Subject || msg.title || "";
          let body = "";
          if (msg.message)
            body = msg.message; // dongvanfb API dùng "message" field
          else if (typeof msg.body === "object")
            body =
              msg.body.content || msg.body.text || JSON.stringify(msg.body);
          else
            body =
              msg.body ||
              msg.Body ||
              msg.bodyPreview ||
              msg.snippet ||
              msg.content ||
              "";

          const fullText = subject + " " + body;

          if (fullText.includes(subjectMatch) || subjectMatch === "*") {
            // Thử regex chính
            let match = fullText.match(codeRegex);
            // Fallback: tìm 6 số đứng riêng (không phải phần của số dài hơn)
            if (!match) match = body.match(/(?<!\d)(\d{6})(?!\d)/);
            if (match) {
              log(
                `HOTMAIL API: found code "${match[1]}" in "${subject.substring(0, 60)}"`,
              );
              return match[1];
            }
          }
        }
      }
    } catch (e) {
      log(`HOTMAIL API error: ${e.message}`);
    }

    log(`HOTMAIL API: no match yet, retry in ${pollMs / 1000}s...`);
    await sleep(pollMs);
  }
  log("HOTMAIL API: timeout");
  return null;
}

// Meta confirm code sent to hotmail
// API response: msg.message = HTML, code inside <div ...>988195</div>
async function getMetaConfirmCodeHotmail(
  hotmail,
  passhot,
  refreshToken,
  clientId,
) {
  return getHotmailCode(hotmail, passhot, refreshToken, clientId, {
    subjectMatch: "confirmation code",
    codeRegex: />(\d{6})<\/div>/,
    maxWaitMs: 90000,
  });
}

module.exports = {
  imapWpPl,
  getRecoveryCode,
  getVerifyCode,
  getMetaConfirmCodeWp,
  getMetaSecurityCode,
  getIGAuthCode,
  getHotmailCode,
  getMetaConfirmCodeHotmail,
};
