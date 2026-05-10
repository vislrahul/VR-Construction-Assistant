import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();

// =========================
// OPENAI
// =========================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================
// SUPABASE
// =========================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// =========================
// TELEGRAM
// =========================

const bot = new TelegramBot(
  process.env.TELEGRAM_BOT_TOKEN,
  {
    polling: true,
  }
);

// =========================
// CLEAR MEMORY FUNCTION
// =========================

async function clearMemory(chatId) {

  await supabase
    .from("conversation_memory")
    .delete()
    .eq("chat_id", String(chatId));

}

// =========================
// TELEGRAM BOT
// =========================

bot.on("message", async (msg) => {

  try {

    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    console.log("USER:", text);

    // =========================
    // LOAD MEMORY FROM SUPABASE
    // =========================

    let memory = {
      pendingIntent: null,
      data: {},
    };

    const { data: memoryRow } =
      await supabase
        .from("conversation_memory")
        .select("*")
        .eq("chat_id", String(chatId))
        .single();

    if (memoryRow) {

      memory.pendingIntent =
        memoryRow.pending_intent;

      memory.data =
        memoryRow.memory_data || {};

    }

    // =========================
    // AI UNDERSTANDING
    // =========================

    const completion =
      await openai.chat.completions.create({

        model: "gpt-4.1-mini",

        response_format: {
          type: "json_object",
        },

        messages: [
          {
            role: "system",
            content: `
You are VR Construction AI Assistant.

You are a smart conversational AI assistant for a construction business owner.

You must continue previous incomplete conversations naturally.

Current pending intent:
${memory.pendingIntent || "none"}

Current saved data:
${JSON.stringify(memory.data)}

You must:
- understand follow-up replies
- understand partial answers
- understand Hindi + English mixed chatting
- understand construction business operations
- ask for missing details naturally
- behave like a real assistant
- always call user sir

Return ONLY valid JSON.

FORMAT:

{
  "intent": "",
  "message": "",
  "data": {},
  "missing_fields": []
}

INTENTS:
- labour_payment
- expense
- attendance
- quotation
- create_project
- report
- general_chat

EXAMPLES:

USER:
"Raju ko 5000 diya"

RETURN:
{
  "intent": "labour_payment",
  "message": "Sir payment cash tha ya online?",
  "data": {
    "labour_name": "Raju",
    "amount": 5000
  },
  "missing_fields": ["mode"]
}

USER:
"online from AU bank"

RETURN:
{
  "intent": "labour_payment",
  "message": "Sir advance tha ya salary payment?",
  "data": {
    "mode": "online",
    "bank": "AU Bank"
  },
  "missing_fields": ["payment_type"]
}

USER:
"advance"

RETURN:
{
  "intent": "labour_payment",
  "message": "Okay sir. Payment recorded successfully.",
  "data": {
    "payment_type": "advance"
  },
  "missing_fields": []
}

Always keep replies short and natural.
`
          },

          {
            role: "user",
            content: text,
          },
        ],
      });

    // =========================
    // PARSE AI RESPONSE
    // =========================

    const aiResponse = JSON.parse(
      completion.choices[0].message.content
    );

    console.log("AI:", aiResponse);

    const intent =
      aiResponse.intent || "general_chat";

    // =========================
    // MERGE OLD + NEW DATA
    // =========================

    const data = {
      ...memory.data,
      ...(aiResponse.data || {}),
    };

    // REMOVE EMPTY VALUES

    Object.keys(data).forEach((key) => {

      if (
        data[key] === null ||
        data[key] === "" ||
        data[key] === undefined
      ) {

        delete data[key];

      }

    });

    const missingFields =
      aiResponse.missing_fields || [];

    // =========================
    // SAVE MEMORY TO SUPABASE
    // =========================

    memory.pendingIntent = intent;

    memory.data = data;

    await supabase
      .from("conversation_memory")
      .upsert([
        {
          chat_id: String(chatId),
          pending_intent:
            memory.pendingIntent,
          memory_data:
            memory.data,
          updated_at:
            new Date().toISOString(),
        },
      ]);

    // =========================
    // ASK FOR MISSING DETAILS
    // =========================

    if (missingFields.length > 0) {

      return bot.sendMessage(
        chatId,
        aiResponse.message
      );

    }

    // =========================
    // LABOUR PAYMENT
    // =========================

    if (intent === "labour_payment") {

      const labourName =
        data.labour_name || "Unknown";

      const amount =
        data.amount || 0;

      const mode =
        data.mode || "cash";

      const paymentType =
        data.payment_type || "regular";

      await supabase
        .from("labour_payments")
        .insert([
          {
            labour_name: labourName,
            amount: amount,
            mode: mode,
            payment_type: paymentType,
          },
        ]);

      await clearMemory(chatId);

      return bot.sendMessage(
        chatId,
        `✅ Payment recorded sir

Labour: ${labourName}
Amount: ₹${amount}
Mode: ${mode}
Type: ${paymentType}`
      );

    }

    // =========================
    // EXPENSE
    // =========================

    if (intent === "expense") {

      const category =
        data.category || "General";

      const amount =
        data.amount || 0;

      const project =
        data.project || "General";

      await supabase
        .from("transactions")
        .insert([
          {
            type: "Expense",
            category: category,
            amount: amount,
            notes: project,
          },
        ]);

      await clearMemory(chatId);

      return bot.sendMessage(
        chatId,
        `✅ Expense recorded sir

Category: ${category}
Amount: ₹${amount}
Project: ${project}`
      );

    }

    // =========================
    // ATTENDANCE
    // =========================

    if (intent === "attendance") {

      const labourName =
        data.labour_name || "Unknown";

      const shift =
        data.shift || "full";

      await supabase
        .from("attendance")
        .insert([
          {
            labour_name: labourName,
            shift: shift,
          },
        ]);

      await clearMemory(chatId);

      return bot.sendMessage(
        chatId,
        `✅ Attendance marked sir

Labour: ${labourName}
Shift: ${shift}`
      );

    }

    // =========================
    // CREATE PROJECT
    // =========================

    if (intent === "create_project") {

      const projectName =
        data.project_name || "Untitled Project";

      const clientName =
        data.client_name || "Unknown Client";

      const vertical =
        data.vertical || "General";

      let clientId = null;

      const { data: existingClient } =
        await supabase
          .from("clients")
          .select("*")
          .eq(
            "client_name",
            clientName
          )
          .single();

      if (existingClient) {

        clientId = existingClient.id;

      } else {

        const { data: newClient } =
          await supabase
            .from("clients")
            .insert([
              {
                client_name: clientName,
              },
            ])
            .select()
            .single();

        clientId = newClient.id;

      }

      const projectCode =
        "PRJ-" +
        Math.floor(
          Math.random() * 100000
        );

      await supabase
        .from("projects")
        .insert([
          {
            project_name: projectName,
            client_id: clientId,
            vertical: vertical,
            project_code: projectCode,
            status: "Active",
          },
        ]);

      await clearMemory(chatId);

      return bot.sendMessage(
        chatId,
        `✅ Project created sir

Project: ${projectName}
Client: ${clientName}
Vertical: ${vertical}`
      );

    }

    // =========================
    // QUOTATION
    // =========================

    if (intent === "quotation") {

      await clearMemory(chatId);

      return bot.sendMessage(
        chatId,
        "✅ Quotation update noted sir."
      );

    }

    // =========================
    // REPORT
    // =========================

    if (intent === "report") {

      return bot.sendMessage(
        chatId,
        "Sir reporting module coming next."
      );

    }

    // =========================
    // GENERAL CHAT
    // =========================

    return bot.sendMessage(
      chatId,
      aiResponse.message ||
      "Yes sir."
    );

  } catch (error) {

    console.log(error);

    bot.sendMessage(
      msg.chat.id,
      "AI error occurred sir."
    );

  }

});

// =========================
// HOME
// =========================

app.get("/", (req, res) => {

  res.send(
    "VR Construction AI Running"
  );

});

// =========================
// TEST DATABASE
// =========================

app.get("/test-db", async (req, res) => {

  try {

    const { data, error } =
      await supabase
        .from("projects")
        .select("*")
        .limit(1);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data,
    });

  } catch (err) {

    res.json({
      success: false,
      error: err.message,
    });

  }

});

// =========================
// START SERVER
// =========================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `Server running on ${PORT}`
  );

});
