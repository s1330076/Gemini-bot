import express from "express";
import crypto from "crypto";
import axios from "axios";

const app = express();

// ========================================
// 環境変数
// ========================================

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 2026年8月現在のGeminiモデル
const GEMINI_MODEL = "gemini-3.7-flash";

// RenderのPORTを使用
const PORT = process.env.PORT || 3000;

// ========================================
// 起動時チェック
// ========================================

console.log("================================");
console.log("LINE × Gemini Bot");
console.log("Gemini Model:", GEMINI_MODEL);
console.log("PORT:", PORT);

if (!LINE_CHANNEL_SECRET) {
  console.error("ERROR: LINE_CHANNEL_SECRET が設定されていません");
}

if (!LINE_CHANNEL_ACCESS_TOKEN) {
  console.error(
    "ERROR: LINE_CHANNEL_ACCESS_TOKEN が設定されていません"
  );
}

if (!GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY が設定されていません");
}

console.log("================================");

// ========================================
// LINE Webhook
// ========================================

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {

    console.log("===== LINE WEBHOOK RECEIVED =====");

    // ------------------------------------
    // 1. LINE署名確認
    // ------------------------------------

    try {
      const signature = req.headers["x-line-signature"];

      if (!signature) {
        console.error(
          "ERROR: x-line-signature がありません"
        );

        return res.sendStatus(401);
      }

      const hash = crypto
        .createHmac("sha256", LINE_CHANNEL_SECRET)
        .update(req.body)
        .digest("base64");

      if (hash !== signature) {
        console.error(
          "ERROR: LINE署名が一致しません"
        );

        return res.sendStatus(401);
      }

      console.log("LINE署名 OK");

      // ------------------------------------
      // 2. LINEにはすぐ200を返す
      // ------------------------------------

      res.sendStatus(200);

      // ------------------------------------
      // 3. JSON解析
      // ------------------------------------

      const body = JSON.parse(
        req.body.toString("utf8")
      );

      console.log(
        "LINE EVENT:",
        JSON.stringify(body)
      );

      if (
        !body.events ||
        body.events.length === 0
      ) {
        console.log("イベントなし");
        return;
      }

      // ------------------------------------
      // 4. 複数イベントにも対応
      // ------------------------------------

      for (const event of body.events) {
        processEvent(event).catch((error) => {
          console.error(
            "イベント処理エラー:",
            error
          );
        });
      }

    } catch (error) {

      console.error(
        "Webhook処理エラー:",
        error.message
      );
    }
  }
);

// ========================================
// LINEイベント処理
// ========================================

async function processEvent(event) {

  // --------------------------------------
  // メッセージイベント以外は無視
  // --------------------------------------

  if (event.type !== "message") {

    console.log(
      "メッセージイベントではありません:",
      event.type
    );

    return;
  }

  // --------------------------------------
  // テキスト以外は無視
  // --------------------------------------

  if (event.message?.type !== "text") {

    console.log(
      "テキストメッセージではありません:",
      event.message?.type
    );

    return;
  }

  const userMessage = event.message.text;
  const replyToken = event.replyToken;

  console.log(
    "ユーザー:",
    userMessage
  );

  console.log(
    "replyToken取得 OK"
  );

  // --------------------------------------
  // Geminiへ問い合わせ
  // --------------------------------------

  let aiReply;

  try {

    console.log(
      "Geminiに問い合わせ開始"
    );

    const geminiUrl =
      `https://generativelanguage.googleapis.com/` +
      `v1beta/models/${GEMINI_MODEL}:generateContent` +
      `?key=${GEMINI_API_KEY}`;

    const geminiResponse =
      await axios.post(
        geminiUrl,
        {
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: userMessage
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000
          }
        },
        {
          headers: {
            "Content-Type":
              "application/json"
          },

          // LINEのreplyTokenを考慮して
          // Geminiが長時間待たせないようにする
          timeout: 40000
        }
      );

    console.log(
      "Gemini response OK"
    );

    aiReply =
      geminiResponse.data
        ?.candidates?.[0]
        ?.content?.parts?.[0]
        ?.text;

    if (!aiReply) {

      console.error(
        "Geminiから回答を取得できませんでした"
      );

      console.error(
        JSON.stringify(
          geminiResponse.data
        )
      );

      aiReply =
        "すみません、回答を生成できませんでした。もう一度試してください。";
    }

  } catch (error) {

    console.error(
      "===== GEMINI ERROR ====="
    );

    if (error.response) {

      console.error(
        "Status:",
        error.response.status
      );

      console.error(
        "Response:",
        JSON.stringify(
          error.response.data
        )
      );

    } else {

      console.error(
        "Error:",
        error.message
      );
    }

    console.error(
      "========================"
    );

    // Geminiが失敗した場合も
    // LINEにはエラーメッセージを返す
    aiReply =
      "申し訳ありません。AIとの通信でエラーが発生しました。少し時間をおいて、もう一度試してください。";
  }

  // --------------------------------------
  // LINEの文字数制限対策
  // --------------------------------------

  const trimmedReply =
    aiReply.slice(0, 4900);

  console.log(
    "Gemini回答:",
    trimmedReply
  );

  // --------------------------------------
  // LINEへ返信
  // --------------------------------------

  try {

    console.log(
      "LINE返信開始"
    );

    const lineResponse =
      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: replyToken,

          messages: [
            {
              type: "text",
              text: trimmedReply
            }
          ]
        },
        {
          headers: {
            Authorization:
              `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,

            "Content-Type":
              "application/json"
          },

          timeout: 10000
        }
      );

    console.log(
      "LINE返信成功"
    );

    console.log(
      "LINE response:",
      JSON.stringify(
        lineResponse.data
      )
    );

  } catch (error) {

    console.error(
      "===== LINE REPLY ERROR ====="
    );

    if (error.response) {

      console.error(
        "Status:",
        error.response.status
      );

      console.error(
        "Response:",
        JSON.stringify(
          error.response.data
        )
      );

    } else {

      console.error(
        "Error:",
        error.message
      );
    }

    console.error(
      "============================"
    );
  }
}

// ========================================
// Health Check
// ========================================

app.get(
  "/healthz",
  (req, res) => {
    res.status(200).send("OK");
  }
);

// ========================================
// Geminiモデル確認用
// ========================================
//
// ブラウザで
//
// https://あなたのRenderURL/models
//
// にアクセスすると、APIキーで使用可能な
// Geminiモデルを確認できます。
// ========================================

app.get(
  "/models",
  async (req, res) => {

    try {

      const response =
        await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`,
          {
            timeout: 10000
          }
        );

      res.json(response.data);

    } catch (error) {

      console.error(
        "モデル一覧取得エラー:",
        error.response?.data ||
        error.message
      );

      res.status(500).json(
        error.response?.data || {
          error: error.message
        }
      );
    }
  }
);

// ========================================
// Server Start
// ========================================

app.listen(
  PORT,
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);
