const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env.threads");
const lines = fs.readFileSync(envPath, "utf-8").split("\n");
for (const line of lines) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function run() {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=0`);
  const data = await res.json();

  for (const update of (data.result || [])) {
    const cq = update.callback_query;
    if (!cq) continue;

    console.log("처리:", cq.data);

    await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cq.id, text: "승인됨 처리 완료!" })
    });

    const name = cq.data.includes("approve") ? "승인됨" : "거절됨";
    const emoji = cq.data.includes("approve") ? "✅" : "❌";

    await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: `${emoji} ${name} (처리 완료)`
      })
    });
    console.log("텔레그램 메시지 편집 완료");
  }

  if (data.result && data.result.length > 0) {
    const lastId = data.result[data.result.length - 1].update_id;
    await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${lastId + 1}&timeout=0`);
    console.log("offset 업데이트:", lastId + 1);
  }
}

run().catch(e => console.error("에러:", e.message));
