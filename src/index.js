import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
});

bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text;

    console.log("User:", text);

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are VR Construction AI Assistant helping manage construction business operations, labour, vendors, quotations, projects, payments, material expenses and reports.",
        },
        {
          role: "user",
          content: text,
        },
      ],
    });

    const reply =
      completion.choices[0].message.content;

    bot.sendMessage(chatId, reply);
  } catch (error) {
    console.log(error);

    bot.sendMessage(
      msg.chat.id,
      "AI error occurred."
    );
  }
});

app.get("/", (req, res) => {
  res.send("VR Construction AI Running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
