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

    // CREATE PROJECT COMMAND
    if (text.toLowerCase().startsWith("create project")) {

      const lines = text.split("\n");

      let clientName = "";
      let projectName = "";
      let vertical = "";

      lines.forEach((line) => {

        if (line.toLowerCase().includes("client:")) {
          clientName = line.split(":")[1]?.trim();
        }

        if (line.toLowerCase().includes("project:")) {
          projectName = line.split(":")[1]?.trim();
        }

        if (line.toLowerCase().includes("vertical:")) {
          vertical = line.split(":")[1]?.trim();
        }

      });

      // CHECK CLIENT
      let clientId = null;

      const { data: existingClient } = await supabase
        .from("clients")
        .select("*")
        .eq("client_name", clientName)
        .single();

      if (existingClient) {

        clientId = existingClient.id;

      } else {

        const { data: newClient, error: clientError } = await supabase
          .from("clients")
          .insert([
            {
              client_name: clientName,
            },
          ])
          .select()
          .single();

        if (clientError) {
          throw clientError;
        }

        clientId = newClient.id;
      }

      // CREATE PROJECT
      const projectCode =
        "PRJ-" + Math.floor(Math.random() * 100000);

      const { data: project, error: projectError } =
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
          ])
          .select()
          .single();

      if (projectError) {
        throw projectError;
      }

      return bot.sendMessage(
        chatId,
        `✅ Project Created

Project: ${project.project_name}
Code: ${project.project_code}
Vertical: ${project.vertical}`
      );
    }
    // EXPENSE ENTRY
    if (text.toLowerCase().startsWith("expense")) {

      const lines = text.split("\n");

      let projectName = "";
      let type = "";
      let amount = 0;
      let vendorName = "";
      let note = "";

      lines.forEach((line) => {

        if (line.toLowerCase().includes("project:")) {
          projectName = line.split(":")[1]?.trim();
        }

        if (line.toLowerCase().includes("type:")) {
          type = line.split(":")[1]?.trim();
        }

        if (line.toLowerCase().includes("amount:")) {
          amount = Number(
            line.split(":")[1]?.trim()
          );
        }

        if (line.toLowerCase().includes("vendor:")) {
          vendorName = line.split(":")[1]?.trim();
        }

        if (line.toLowerCase().includes("note:")) {
          note = line.split(":")[1]?.trim();
        }

      });

      // FIND PROJECT
      const { data: projectData } = await supabase
        .from("projects")
        .select("*")
        .eq("project_name", projectName)
        .single();

      if (!projectData) {

        return bot.sendMessage(
          chatId,
          "Project not found."
        );

      }

      // FIND OR CREATE VENDOR
      let vendorId = null;

      const { data: existingVendor } = await supabase
        .from("vendors")
        .select("*")
        .eq("vendor_name", vendorName)
        .single();

      if (existingVendor) {

        vendorId = existingVendor.id;

      } else {

        const { data: newVendor } = await supabase
          .from("vendors")
          .insert([
            {
              vendor_name: vendorName,
            },
          ])
          .select()
          .single();

        vendorId = newVendor.id;
      }

      // INSERT TRANSACTION
      const { error: transactionError } =
        await supabase
          .from("transactions")
          .insert([
            {
              project_id: projectData.id,
              type: "Expense",
              category: type,
              amount: amount,
              vendor_id: vendorId,
              notes: note,
              payment_status: "Paid",
            },
          ]);

      if (transactionError) {
        throw transactionError;
      }

      return bot.sendMessage(
        chatId,
        `✅ Expense Saved

Project: ${projectName}
Amount: ₹${amount}
Vendor: ${vendorName}
Type: ${type}`
      );
    }
    
    // NORMAL AI CHAT
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

You must analyze the user's message and return ONLY valid JSON.

Response format:

{
  "intent": "",
  "message": "",
  "data": {},
  "missing_fields": []
}

Possible intents:
- create_project
- expense
- labour_payment
- attendance
- quotation
- report
- general_chat

Examples:

User:
"Raju ko 5000 advance diya online"

Return:
{
  "intent": "labour_payment",
  "message": "Sir, ₹5000 advance payment for Raju recorded.",
  "data": {
    "labour_name": "Raju",
    "amount": 5000,
    "mode": "online",
    "payment_type": "advance"
  },
  "missing_fields": []
}

User:
"cement kharida"

Return:
{
  "intent": "expense",
  "message": "Sir amount kitna tha and which project should I record this under?",
  "data": {
    "category": "material"
  },
  "missing_fields": ["amount", "project"]
}

Always:
- understand casual language
- understand Hindi + English mixed language
- ask for missing important details
- always call user sir
- keep responses short and natural
`
      },

      {
        role: "user",
        content: text,
      },
    ],
  });

const aiResponse = JSON.parse(
  completion.choices[0].message.content
);

console.log(aiResponse);

const replyMessage =
  aiResponse.message || "Done sir.";

bot.sendMessage(
  chatId,
  replyMessage
);

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

app.get("/test-db", async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .limit(1);

    if (error) {
      return res.status(500).json({
        success: false,
        error: error,
      });
    }

    res.json({
      success: true,
      data: data,
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message,
    });

  }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
