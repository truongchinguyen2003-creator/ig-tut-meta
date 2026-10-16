"use strict";
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(msg) { const ts = new Date().toLocaleTimeString("vi-VN"); console.log(`[${ts}] ${msg}`); }
class IGDieError extends Error { constructor(msg) { super(msg); this.name = "IGDieError"; } }
class MetaDieError extends Error { constructor(msg) { super(msg); this.name = "MetaDieError"; } }
module.exports = { sleep, log, IGDieError, MetaDieError };
