"use strict";
const IG_APP_ID = "936619743392459";

async function getIGProfile(page) {
  return page.evaluate((appId) => {
    const gc = (n) => { const v = `; ${document.cookie}`; const p = v.split(`; ${n}=`); if (p.length === 2) return p.pop().split(";").shift(); };
    const uid = gc("ds_user_id");
    if (!uid) return { ok: false, error: "no_ds_user_id" };
    return fetch(`https://www.instagram.com/api/v1/users/${uid}/info/`, { method: "GET", headers: { "X-IG-App-ID": appId } })
      .then((r) => r.status !== 200 ? { ok: false, error: `status_${r.status}` } : r.json())
      .then((d) => { const u = d.user; if (!u) return { ok: false }; return { ok: true, username: u.username || "", posts: u.media_count ?? 0, followers: u.follower_count ?? 0, following: u.following_count ?? 0 }; })
      .catch((e) => ({ ok: false, error: e.message }));
  }, IG_APP_ID).catch(() => ({ ok: false, error: "evaluate_failed" }));
}

module.exports = { getIGProfile };
