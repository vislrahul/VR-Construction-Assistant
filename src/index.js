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
// CLEAR MEMORY
// =========================

async function clearMemory(chatId) {

  await supabase
    .from("conversation_memory")
    .delete()
    .eq("chat_id", String(chatId));

}

// =========================
// SAVE MEMORY
// =========================

async function saveMemory(
  chatId,
  intent,
  data
) {

  await supabase
    .from("conversation_memory")
    .upsert([
      {
        chat_id: String(chatId),
        pending_intent: intent,
        memory_data: data,
        updated_at: new Date().toISOString(),
      },
    ]);

}

// =========================
// LOAD MEMORY
// =========================

async function loadMemory(chatId) {

  const { data } =
    await supabase
      .from("conversation_memory")
      .select("*")
      .eq("chat_id", String(chatId))
      .single();

  if (!data) {

    return {
      pendingIntent: null,
      data: {},
    };

  }

  return {
    pendingIntent:
      data.pending_intent,
    data:
      data.memory_data || {},
  };

}

// =========================
// TELEGRAM MESSAGE
// =========================

bot.on("message", async (msg) => {

  try {

    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    console.log("USER:", text);

    // =========================
    // LOAD MEMORY
    // =========================

    const memory =
      await loadMemory(chatId);

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

You are a smart AI assistant for a construction company owner.

You behave like a real human assistant.

You must continue previous incomplete conversations naturally.

CURRENT PENDING INTENT:
${memory.pendingIntent || "none"}

CURRENT MEMORY:
${JSON.stringify(memory.data)}

IMPORTANT RULES:

- Understand casual chatting
- Understand Hindi + English mixed language
- Understand follow-up replies
- Understand partial answers
- Never ask again for details already provided
- If memory already contains labour_name, amount, mode, payment_type, project or other fields, NEVER ask for them again
- Always use saved memory intelligently
- Follow-up replies like "online", "phonepe", "advance", "today", "Raju", "5000" belong to previous pending conversation
- Do not restart conversation unless user changes topic completely
- If enough details are available after merging memory, complete the task immediately
- Merge old conversation memory with new replies
- Always behave intelligently
- Always call the user "sir"
- Keep replies short and natural

RETURN ONLY VALID JSON.

FORMAT:

{
  "intent": "",
  "message": "",
  "data": {},
  "missing_fields": []
}

VALID INTENTS:
- labour_payment
- expense
- attendance
- quotation
- create_project
- report
- general_chat

EXAMPLES:

USER:
"paid 4100 advance to Raju"

RETURN:
{
  "intent": "labour_payment",
  "message": "Sir payment cash tha ya online?",
  "data": {
    "labour_name": "Raju",
    "amount": 4100,
    "payment_type": "advance"
  },
  "missing_fields": ["mode"]
}

USER:
"online through phonepe"

RETURN:
{
  "intent": "labour_payment",
  "message": "Okay sir. Payment recorded successfully.",
  "data": {
    "mode": "online",
    "bank": "PhonePe"
  },
  "missing_fields": []
}

USER:
"cement kharida 3200 ka"

RETURN:
{
  "intent": "expense",
  "message": "Sir which project should I record this under?",
  "data": {
    "category": "material",
    "amount": 3200
  },
  "missing_fields": ["project"]
}

USER:
"Anjali Ghadge site"

RETURN:
{
  "intent": "expense",
  "message": "Okay sir. Expense recorded.",
  "data": {
    "project": "Anjali Ghadge site"
  },
  "missing_fields": []
}

Always return valid JSON only.
`
          },

          {
            role: "user",
            content: text,
          },
        ],
      });

    // =========================
    // PARSE RESPONSE
    // =========================

    const aiResponse = JSON.parse(
      completion.choices[0].message.content
    );

    console.log("AI:", aiResponse);

    const intent =
      aiResponse.intent ||
      "general_chat";

    // =========================
    // MERGE MEMORY
    // =========================

    const mergedData = {
      ...memory.data,
      ...(aiResponse.data || {}),
    };

    // REMOVE EMPTY VALUES

    Object.keys(mergedData)
      .forEach((key) => {

        if (
          mergedData[key] === null ||
          mergedData[key] === "" ||
          mergedData[key] === undefined
        ) {

          delete mergedData[key];

        }

      });

    const missingFields =
      aiResponse.missing_fields || [];

    // =========================
    // SAVE MEMORY
    // =========================

    await saveMemory(
      chatId,
      intent,
      mergedData
    );

    // =========================
    // ASK MISSING DETAILS
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
        mergedData.labour_name || "Unknown";

      const amount =
        mergedData.amount || 0;

      const mode =
        mergedData.mode || "cash";

      const paymentType =
        mergedData.payment_type || "regular";

      const bank =
        mergedData.bank || null;

      await supabase
        .from("labour_payments")
        .insert([
          {
            labour_name: labourName,
            amount: amount,
            mode: mode,
            payment_type: paymentType,
            bank: bank,
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
        mergedData.category || "General";

      const amount =
        mergedData.amount || 0;

      const project =
        mergedData.project || "General";

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
        mergedData.labour_name || "Unknown";

      const shift =
        mergedData.shift || "full";

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
        mergedData.project_name ||
        "Untitled Project";

      const clientName =
        mergedData.client_name ||
        "Unknown Client";

      const vertical =
        mergedData.vertical ||
        "General";

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
