// Өдрийн үгийн мэдэгдэл.
//
// GitHub Actions-ийн хуваарь найдваргүй (цаг тутам гэж тохируулсан ч өдөрт 3–4 л удаа ажилладаг),
// тиймээс энэ скрипт "яг одоогийн цагийнхыг илгээх" биш, ирэх 24 цагийн бүх цагийн мэдэгдлийг
// OneSignal-д урьдчилан товлодог (send_after). Өдөрт ганц удаа ажиллахад л бүх хэрэглэгчид
// сонгосон цагтаа мэдэгдэл авна. Давхар ажилласан ч idempotency_key-ийн ачаар давхардахгүй.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const APP = process.env.ONESIGNAL_APP_ID;
const KEY = process.env.ONESIGNAL_API_KEY;
const SITE = (process.env.SITE || "https://solongo-dict.netlify.app").replace(/\/$/, "");
const DATA_DIR = process.env.DATA_DIR || "";      // туршилтад: өгөгдлийг дотоод хавтаснаас унших
const DRY = process.env.DRY_RUN === "1";          // туршилтад: илгээхгүй, зөвхөн хэвлэнэ
const HOURS_AHEAD = 24;
const LV = ["초급", "중급", "고급"];

async function getJSON(name) {
  if (DATA_DIR) return JSON.parse(await readFile(`${DATA_DIR}/${name}`, "utf8"));
  const r = await fetch(`${SITE}/data/${name}`);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}

// Товлосон цаг + түвшнээс үргэлж ижил гарах UUID (давхар илгээлтээс хамгаална)
function keyFor(iso, level) {
  const h = createHash("sha256").update(`solongo-daily|${iso}|${level}`).digest("hex");
  const v = "89ab"[parseInt(h[16], 16) & 3];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Тухайн агшин дахь Солонгосын цагаар (KST) өдрийн дугаар — аппын "өнөөдрийн үг"-тэй ижил томьёо
function dayNumber(t) {
  const kst = new Date(t.getTime() + 9 * 3600e3);
  return Math.floor(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) / 864e5);
}

// ----- 1. Өөрийн Web Push (OneSignal-гүй шинэ систем) -----
// Бүртгэл, түлхүүр, илгээлт бүгд Cloudflare дээр (solongo-dict/functions/api/push). Энд зөвхөн "одоо илгээ" гэж түлхэнэ.
// Нэг дуудлагад 40 хүртэл мэдэгдэл явдаг тул дуустал давтана. Давхар дуудсан ч давхардахгүй.
const PUSH_API = (process.env.PUSH_API || "https://solongo-test.pages.dev").replace(/\/$/, "");
if (!DRY) {
  let total = 0;
  try {
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`${PUSH_API}/api/push/run`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log(`Өөрийн push: ${r.status} ${JSON.stringify(j)}`); break; }
      total += j.sent || 0;
      if (!j.remaining) break;
    }
    console.log(`Өөрийн push: ${total} мэдэгдэл илгээв`);
  } catch (e) { console.log(`Өөрийн push: алдаа ${e.message}`); }
}

// ----- 2. OneSignal (шилжилтийн хугацаанд хуучин бүртгэлтэй хэрэглэгчдэд) -----
if (!APP || !KEY) { console.log("OneSignal тохируулаагүй — алгаслаа"); process.exit(0); }
const daily = await getJSON("daily.json");
const words = await getJSON("daily_words.json");

const now = Date.now();
const firstSlot = Math.ceil((now + 3 * 60e3) / 3600e3) * 3600e3; // дор хаяж 3 минутын дараах бүтэн цаг

let sent = 0, dup = 0, empty = 0, failed = 0;
for (let k = 0; k < HOURS_AHEAD; k++) {
  const when = new Date(firstSlot + k * 3600e3);
  const iso = when.toISOString();
  const utcH = when.getUTCHours();
  const dn = dayNumber(when);
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
      send_after: iso,
      idempotency_key: keyFor(iso, i + 1),
      filters: [
        { field: "tag", key: "level", relation: "=", value: String(i + 1) },
        { operator: "AND" },
        { field: "tag", key: "h", relation: "=", value: String(utcH) },
      ],
    };
    if (DRY) { console.log(`${iso} h=${utcH} түвшин ${i + 1}: ${body.contents.en} [${body.idempotency_key}]`); sent++; continue; }
    let r, t = "";
    try {
      r = await fetch("https://api.onesignal.com/notifications?c=push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Key ${KEY}` },
        body: JSON.stringify(body),
      });
      t = await r.text();
    } catch (e) { console.log(`${iso} түвшин ${i + 1}: сүлжээний алдаа ${e.message}`); failed++; continue; }
    let j = {}; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok) { console.log(`${iso} түвшин ${i + 1}: ${r.status} ${t.slice(0, 200)}`); failed++; }
    else if (!j.id) empty++;                 // тэр цаг/түвшинд бүртгэлтэй хүн алга
    else { sent++; console.log(`${iso} түвшин ${i + 1} (${ko}): товлогдлоо ${j.id}`); }
  }
}
console.log(`Дүн: товлогдсон/баталгаажсан ${sent}, хүлээн авагчгүй ${empty}, алдаа ${failed}`);
// Цөөн алдааг дараагийн ажиллагаа нөхнө; бүгд бүтэлгүйтсэн үед л алдаа гэж тэмдэглэнэ
if (failed && !sent && !empty) process.exit(1);
