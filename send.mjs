import { readFile } from "node:fs/promises";

const APP = process.env.ONESIGNAL_APP_ID;
const KEY = process.env.ONESIGNAL_API_KEY;
const SITE = (process.env.SITE || "https://solongo-dict.netlify.app").replace(/\/$/, "");
const NOW = new Date();

async function getJSON(name) {
  const r = await fetch(`${SITE}/data/${name}`);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}

const kst = new Date(NOW.getTime() + 9 * 3600e3);
const dn = Math.floor(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) / 864e5);
const utcH = NOW.getUTCHours();
const LV = ["초급", "중급", "고급"];

const daily = await getJSON("daily.json");
const words = await getJSON("daily_words.json");

let failed = 0;
for (let i = 0; i < 3; i++) {
  const pool = daily.pools[LV[i]];
  const id = pool[((dn % pool.length) + pool.length) % pool.length];
  const [ko, mn] = words[id];
  const body = {
    app_id: APP,
    headings: { en: "🌈 Өнөөдрийн үг" },
    contents: { en: `${ko} — ${mn.length > 90 ? mn.slice(0, 87) + "…" : mn}` },
    web_url: `${SITE}/?w=${id}`,
    web_buttons: [{ id: "save", text: "⭐ Хадгалах", url: `${SITE}/?w=${id}&save=1` }],
    ttl: 43200,
    filters: [
      { field: "tag", key: "level", relation: "=", value: String(i + 1) },
      { operator: "AND" },
      { field: "tag", key: "h", relation: "=", value: String(utcH) },
    ],
  };
  const r = await fetch("https://api.onesignal.com/notifications?c=push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${KEY}` },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log(`түвшин ${i + 1} (${ko}): ${r.status} ${t.slice(0, 200)}`);
  if (!r.ok) failed++;
}
if (failed) process.exit(1);
