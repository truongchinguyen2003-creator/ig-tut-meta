"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const DATA_DIR = "data";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

async function main() {
  const n = parseInt(await ask("Số luồng: "));
  if (!n || n < 1) { console.log("Phải >= 1"); process.exit(1); }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  for (let i = 1; i <= n; i++) {
    const folder = path.join(DATA_DIR, `thread${i}`);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    for (const f of [`ig-moi${i}.txt`, `meta-wp${i}.txt`, `hotmail${i}.txt`]) {
      const fp = path.join(folder, f);
      if (!fs.existsSync(fp)) fs.writeFileSync(fp, "");
    }
    console.log(`✅ thread${i}/ → ig-moi${i}.txt + meta-wp${i}.txt + hotmail${i}.txt`);
  }
  console.log(`\n✅ Đã tạo ${n} luồng trong ${DATA_DIR}/`);
  console.log("Bỏ data vào từng folder rồi: node run.js");
  rl.close();
}
main();
