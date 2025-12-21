const { GoogleGenerativeAI } = require("@google/generative-ai");
const Property = require("../models/Property");
const Reply = require("../models/Reply");
const Enquiry = require("../models/Enquiry");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const MODEL_NAME = "gemini-1.5-flash"; // Fast and efficient

// System Prompt Template
const SYSTEM_PROMPT = `
You are an AI-powered WhatsApp real estate assistant for a premium developer in Abu Dhabi.
Your primary goal is to deliver the BEST user experience within 60 seconds.
You must behave like a smart human assistant, not a form and not a chatbot.

CORE PRINCIPLES:
- Be fast, warm, and helpful.
- Deliver value before asking questions.
- Ask a maximum of ONE question per message.
- Never repeat questions already answered in session data.
- Keep replies short (1–2 lines ideal, max 3).
- Always allow free-text replies.
- Use emojis sparingly but naturally to sound warm (e.g., 👋, 🏡, ✨).

CONTEXT:
User Name: {{userName}}
Entry Source: {{entrySource}}
Project Interest: {{projectName}}
Known Data: {{knownData}}

KNOWLEDGE BASE (Properties):
{{propertyKnowledge}}

RULES:
1. If the 24-hour window is closed, the system handles it, but if you reply, assume you are chatting freely.
2. Safety: Never invent prices, availability, or dates. Only use the KNOWLEDGE BASE. If unsure, say you will check and offer human help.
3. Handover: If the user asks for a viewing, callback, exact availability, pricing, or shows urgency, you MUST output a specific JSON tool call to trigger handover.
4. Data Collection: You want to naturally gather: Name, Budget, Email, Area of Interest, Project Type. Do not interrogate. Ask one thing at a time mixed with helpful info.

OUTPUT FORMAT:
Return a JSON object:
{
  "text": "Your helpful response string here...",
  "handover": boolean, // true if human needed
  "handoverReason": "reason string" // optional
  "extractedData": { "name": "...", "budget": "...", "email": "..." } // optional updates
}
`;

const getPropertyKnowledge = async () => {
  const properties = await Property.find({ isActive: true });
  if (!properties || properties.length === 0)
    return "No specific property details available currently.";

  return properties
    .map(
      (p) => `
    Project: ${p.name}
    Location: ${p.location}
    Types: ${p.types.join(", ")}
    Prices: ${p.priceRange}
    Handover: ${p.handoverDate}
    Desc: ${p.description}
  `
    )
    .join("\n---\n");
};

const getRecentHistory = async (phoneNumber, limit = 10) => {
  // Get last N messages for context
  const history = await Reply.find({
    $or: [{ from: phoneNumber }, { recipientId: phoneNumber }],
  })
    .sort({ timestamp: -1 })
    .limit(limit);

  return history.reverse().map((h) => ({
    role: h.direction === "incoming" ? "user" : "model",
    parts: [{ text: h.body }],
  }));
};

const generateResponse = async (userPhone, messageBody, existingEnquiry) => {
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // 1. Gather Context
    const propertyKnowledge = await getPropertyKnowledge();
    const history = await getRecentHistory(userPhone);

    const knownData = existingEnquiry
      ? JSON.stringify({
          name: existingEnquiry.name,
          email: existingEnquiry.email,
          budget: existingEnquiry.budget,
          bedrooms: existingEnquiry.bedrooms,
        })
      : "None";

    const filledSystemPrompt = SYSTEM_PROMPT.replace(
      "{{userName}}",
      existingEnquiry?.name || "Guest"
    )
      .replace("{{entrySource}}", existingEnquiry?.entrySource || "Direct")
      .replace("{{projectName}}", existingEnquiry?.projectName || "General")
      .replace("{{knownData}}", knownData)
      .replace("{{propertyKnowledge}}", propertyKnowledge);

    // 2. Start Chat
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: `SYSTEM_INSTRUCTION: ${filledSystemPrompt}` }],
        },
        ...history, // Append actual conversation history
      ],
      generationConfig: {
        responseMimeType: "application/json", // Force JSON output for parsing
      },
    });

    // 3. Send Message
    const result = await chat.sendMessage(messageBody);
    const responseText = result.response.text();

    console.log("🤖 Gemini Raw Response:", responseText);

    try {
      const parsed = JSON.parse(responseText);
      return parsed;
    } catch (e) {
      // Fallback if JSON parsing fails
      console.error("❌ JSON Parse Error on AI response:", e);
      return {
        text: "I apologize, I'm having a little trouble connecting. Could you please repeat that?",
        handover: true,
        handoverReason: "AI JSON Parse Error",
      };
    }
  } catch (error) {
    console.error("❌ AI Service Error:", error);
    return {
      text: "I'm checking on that for you. One moment.",
      handover: true,
      handoverReason: "AI Service Failure",
    };
  }
};

module.exports = { generateResponse };
