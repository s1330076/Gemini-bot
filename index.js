import express from "express";
import crypto from "crypto";
import axios from "axios";

const app = express();

// LINE の署名検証には「生のリクエストボディ」が必要
app.use(express.raw({ type: "*/*" }));

// Secrets
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// LINE署名検証（rawBody を使う）
function validateSignature(rawBody, signature) {
  const hash = crypto
    .createHmac("sha256", LINE_SECRET)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

// Geminiへ送信
async function askGemini(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = await axios.post(url, {
    contents: [{ parts: [{ text }] }]
  });
  return response.data.candidates[0].content.parts[0].text;
}

// LINEへ返信
async function replyToLine(replyToken, message) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text: message }]
    },
    {
      headers: {
        Authorization: `Bearer ${LINE_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// Webhook
app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];

  // 署名検証（rawBody を使う）
  if (!validateSignature(req.body, signature)) {
    return res.status(401).send("Unauthorized");
  }

  // LINEへ即時レスポンス
  res.sendStatus(200);

  // JSONに変換
  const body = JSON.parse(req.body.toString());
  const event = body.events[0];

  if (event.type === "message") {
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    const aiReply = await askGemini(userMessage);

    const trimmed = aiReply.slice(0, 4900); // LINE制限対策
    await replyToLine(replyToken, trimmed);
  }
});

// Health check
app.get("/healthz", (req, res) => res.send("OK"));

app.listen(3000, () => console.log("Server running"));
