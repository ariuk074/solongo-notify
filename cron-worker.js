// Cloudflare Worker — мэдэгдлийг яг цагт нь явуулах цаг тутмын түлхэгч.
// GitHub Actions-ийн хуваарь найдваргүй (хэдэн цагаар хоцордог) тул үүнийг Cloudflare дээр тавина.
// Тохируулах: Cloudflare → Workers & Pages → Create → Worker → энэ кодыг буулгаад Deploy →
//             Settings → Triggers → Cron Triggers → "0 * * * *" (цаг тутам) нэмнэ.
// Үндсэн апп ба туршилтын сайт тус тусын сервертэй тул хоёуланг нь түлхэнэ.
const APIS = ["https://solongo-api.pages.dev/api/push/run", "https://solongo-test.pages.dev/api/push/run"];

async function run() {
  let sent = 0;
  for (const api of APIS) {
    try {
      for (let i = 0; i < 40; i++) {
        const r = await fetch(api, { method: "POST" });
        const j = await r.json().catch(() => ({}));
        sent += j.sent || 0;
        if (!r.ok || !j.remaining) break;
      }
    } catch (e) {}
  }
  return { sent };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run()); },
  async fetch() { return new Response(JSON.stringify(await run()), { headers: { "Content-Type": "application/json" } }); },
};
