"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DATA_DIR = "data";
const SCREEN_W = 2560,
  SCREEN_H = 1440;

function log(msg) {
  const ts = new Date().toLocaleTimeString("vi-VN");
  console.log(`[${ts}] [MAIN] ${msg}`);
}

// Parse args: node run.js 1 3 5
const args = process.argv.slice(2);
const specific = args.filter((a) => /^\d+$/.test(a)).map(Number);

let folders = fs
  .readdirSync(DATA_DIR)
  .filter((f) => fs.statSync(path.join(DATA_DIR, f)).isDirectory())
  .sort();
if (specific.length > 0) {
  const wanted = new Set(specific.map((n) => `thread${n}`));
  folders = folders.filter((f) => wanted.has(f));
  log(`Running specific threads: ${specific.join(", ")}`);
}

if (folders.length === 0) {
  log("No thread folders found.");
  process.exit(1);
}

// 2K monitor: 2560x1440
// Mỗi thread = 2 browser cạnh nhau, mỗi browser 1280x720
// Thread 1: B1(0,0) B2(1280,0)     ← row 1
// Thread 2: B1(0,720) B2(1280,720) ← row 2
const BROWSER_W = Math.floor(SCREEN_W / 2); // 1280
const ROW_H = Math.floor(SCREEN_H / 2); // 720
const THREADS_PER_SCREEN = 2; // 2 rows

log(`Found ${folders.length} threads`);
const processes = [];
let idx = 0;

for (const folder of folders) {
  const dir = path.join(DATA_DIR, folder);
  const num = folder.replace(/\D/g, "") || "";

  // Detect files
  function findFile(...names) {
    for (const n of names) {
      const fp = path.join(dir, n);
      if (fs.existsSync(fp)) return fp;
    }
    return path.join(dir, names[0]);
  }
  const igFile = findFile(`ig-moi${num}.txt`, "ig-moi.txt");
  const mailFile = findFile(
    `meta-wp${num}.txt`,
    "meta-wp.txt",
    `mail-lam${num}.txt`,
    "mail-lam.txt",
  );
  const hotFile = findFile(`hotmail${num}.txt`, "hotmail.txt");

  if (
    !fs.existsSync(igFile) ||
    !fs.existsSync(mailFile) ||
    !fs.existsSync(hotFile)
  ) {
    log(`⚠ ${folder}: missing input files, skip`);
    continue;
  }

  const igCount = fs
    .readFileSync(igFile, "utf8")
    .split("\n")
    .filter(Boolean).length;
  const mailCount = fs
    .readFileSync(mailFile, "utf8")
    .split("\n")
    .filter(Boolean).length;
  const hotCount = fs
    .readFileSync(hotFile, "utf8")
    .split("\n")
    .filter(Boolean).length;

  // Thread layout: row = thread index, 2 browsers side by side per row
  const row = idx % THREADS_PER_SCREEN;
  const baseY = row * ROW_H;
  const winSize = `${BROWSER_W},${ROW_H}`;
  const pos1 = `0,${baseY}`; // Browser 1: left half
  const pos2 = `${BROWSER_W},${baseY}`; // Browser 2: right half

  log(
    `${folder}: ${igCount} IG + ${mailCount} Mail + ${hotCount} Hot → B1(${pos1}) B2(${pos2})`,
  );

  const child = spawn(
    "node",
    ["index.js", igFile, mailFile, hotFile, winSize, pos1, pos2],
    {
      cwd: path.resolve("."),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const prefix = `[${folder}]`;
  child.stdout.on("data", (d) =>
    String(d)
      .split("\n")
      .filter(Boolean)
      .forEach((l) => console.log(`${prefix} ${l}`)),
  );
  child.stderr.on("data", (d) =>
    String(d)
      .split("\n")
      .filter(Boolean)
      .forEach((l) => console.error(`${prefix} ${l}`)),
  );
  child.on("exit", (code) => log(`${folder}: exited ${code}`));

  processes.push({ folder, child });
  idx++;
}

log(`${processes.length} threads running`);
Promise.all(
  processes.map(
    ({ folder, child }) =>
      new Promise((r) => child.on("exit", (code) => r({ folder, code }))),
  ),
).then((results) => {
  log("═".repeat(40));
  log("ALL THREADS DONE:");
  results.forEach((r) => log(`  ${r.folder}: exit ${r.code}`));
});
