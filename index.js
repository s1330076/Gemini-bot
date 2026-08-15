import express from "express";
import crypto from "crypto";
import axios from "axios";

const app = express();

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {

    console.log("===== LINE WEBHOOK RECEIVED =====");

    try {
      // --------------------------------
      // 1. LINE署名を確認
      // --------------------------------

      const signature = req.headers["x-line-signature"];

      if (!signature) {
        console.log("ERROR: x-line-signature がありません");
        return res.sendStatus(401);
      }

      const hash = crypto
        .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
        .update(req.body)
        .digest("base64");

      if (hash !== signature) {
        console.log("ERROR: LINE署名が一致しません");
        return res.sendStatus(401);
      }

      console.log("LINE署名 OK");

      // --------------------------------
      // 2. LINEに即200を返す
      // --------------------------------

      res.sendStatus(200);

      // --------------------------------
      // 3. JSON解析
      // --------------------------------

      const body = JSON.parse(req.body.toString("utf8"));

      console.log("LINE EVENT:", JSON.stringify(body));

      if (!body.events || body.events.length === 0) {
        console.log("イベントなし");
        return;
      }

      const event = body.events[0];

      // --------------------------------
      // 4. メッセージイベントか確認
      // --------------------------------

      if (event.type !== "message") {
        console.log("メッセージイベントではありません:", event.type);
        return;
      }

      if (event.message.type !== "text") {
        console.log("テキストメッセージではありません");
        return;
      }

      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      console.log("ユーザー:", userMessage);
      console.log("replyToken取得 OK");

      // --------------------------------
      // 5. Gemini
      // --------------------------------

      console.log("Geminiに問い合わせ開始");

      const geminiUrl =
        `https://generativelanguage.googleapis.com/v1beta/models/` +
        `gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

      const geminiResponse = await axios.post(
        geminiUrl,
        {
          contents: [
            {
              parts: [
                {
                  text: userMessage
                }
              ]
            }
          ]
        },
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

      console.log("Gemini response OK");

      const aiReply =
        geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!aiReply) {
        console.log(
          "Geminiの回答を取得できませんでした:",
          JSON.stringify(geminiResponse.data)
        );
        return;
      }

      const trimmed = aiReply.slice(0, 4900);

      console.log("Gemini回答:", trimmed);

      // --------------------------------
      // 6. LINEへ返信
      // --------------------------------

      console.log("LINE返信開始");

      const lineResponse = await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: replyToken,
          messages: [
            {
              type: "text",
              text: trimmed
            }
          ]
        },
        {
          headers: {
            Authorization:
              `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      console.log("LINE返信成功");
      console.log("LINE response:", lineResponse.data);

    } catch (error) {

      console.error("===== ERROR =====");

      if (error.response) {
        console.error("Status:", error.response.status);
        console.error(
          "Response:",
          JSON.stringify(error.response.data)
        );
      } else {
        console.error("Error:", error.message);
      }

      console.error("=================");
    }
  }
);

// --------------------------------
// Health check
// --------------------------------

app.get("/healthz", (req, res) => {
  res.send("OK");
});

// --------------------------------
// Render用PORT
// --------------------------------

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
