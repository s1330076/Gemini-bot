import express from "express";
import crypto from "crypto";
import axios from "axios";

const app = express();

// Webhook だけ raw を使う（これが最も安全）
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["x-line-signature"];

  // 署名検証
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");

  if (hash !== signature) {
    return res.status(401).send("Unauthorized");
  }

  // 即時レスポンス（LINEの1秒ルール）
  res.sendStatus(200);

  // JSONに変換
  const body = JSON.parse(req.body.toString());
  const event = body.events[0];

  if (event.type === "message") {
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    // Gemini呼び出し
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await axios.post(url, {
      contents: [{ parts: [{ text: userMessage }] }]
    });

    const aiReply = response.data.candidates[0].content.parts[0].text;
    const trimmed = aiReply.slice(0, 4900);

    // LINE返信
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages: [{ type: "text", text: trimmed }]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  }
});

// Health check
app.get("/healthz", (req, res) => res.send("OK"));

app.listen(3000, () => console.log("Server running"));
