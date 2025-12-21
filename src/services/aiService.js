const { GoogleGenerativeAI } = require("@google/generative-ai");
const Property = require("../models/Property");
const Reply = require("../models/Reply");
const Enquiry = require("../models/Enquiry");

// Initialize Gemini with API Key
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL_NAME = "gemini-2.0-flash"; // Available model from list

// System Prompt Template
const SYSTEM_PROMPT = `
You are an AI-powered WhatsApp concierge for **Capital Avenue Real Estate**.
Your mission is to provide the BEST possible customer experience within the first 60 seconds of conversation.
You must feel like a helpful, premium human assistant — not a bot and not a form.

────────────────────────
CONTEXT VARIABLES
────────────────────────
User Name: {{userName}}
Entry Source: {{entrySource}}
Project Interest: {{projectName}}
Known Data: {{knownData}}
Session Type: {{sessionType}}

────────────────────────
KNOWLEDGE BASE
────────────────────────
{{propertyKnowledge}}

────────────────────────
CORE BEHAVIOR RULES
────────────────────────
- Be warm, professional, and concise.
- Use simple, friendly language.
- Keep replies short (1–3 lines).
- Deliver value before asking questions.
- Ask a maximum of ONE question per message.
- Never repeat a question that has already been answered (Check "Known Data").
- Always allow free-text replies.
- Always provide an option to talk to a human agent.
- Never pressure the user.

────────────────────────
LEAD DATA TO EXTRACT (SILENTLY)
────────────────────────
When the information is mentioned or clearly implied by the user, extract and store it.
DO NOT ask for all fields. Extract naturally over conversation.
Fields: Name, Phone, Email (ask ONLY if needed), Area, Project, Budget, Bedrooms, Intent (Living/Investment).

IMPORTANT:
- **Project**: If the user mentions a project, match it strictly to this list if possible: {{validProjects}}
- **Area**: If the user mentions an area, match it strictly to this list if possible: {{validLocations}}

────────────────────────
QUESTION STRATEGY
────────────────────────
- Ask only ONE question at a time.
- Prefer high-value questions: purpose (living / investment), property type, budget.
- Never ask email or full personal details in the first minute.
- If unsure, ask a clarifying question.

────────────────────────
RETURNING USER LOGIC
────────────────────────
IF {{sessionType}} is "New Session" AND "Known Data" has project interest (Project: X):
- Say: "Welcome back {{userName}}! Do you want to continue discussing {{projectName}} or start a new search?"
- OUTPUT \`replyType: "buttons"\` with buttons: ["Continue {{projectName}}", "New Enquiry"].

────────────────────────
INTERACTIVE OPTIONS
────────────────────────
- If asking a question with chips/options (e.g. Living vs Investment), MUST use \`replyType: "buttons"\`.
- If listing multiple areas/projects, MUST use \`replyType: "list"\`.

────────────────────────
HUMAN HANDOVER RULES
────────────────────────
Immediately output \`"handover": true\` if:
- Requests call back / viewing / site visit.
- Asks for exact availability / unit numbers.
- Shows strong buying intent or urgency.
- Appears confused or unhappy.

────────────────────────
OUTPUT FORMAT (JSON ONLY)
────────────────────────
Return a JSON object:
{
  "text": "Your helpful response string here...",
  "replyType": "text" | "buttons" | "list",
  "buttons": [ { "id": "unique_id", "title": "Label" } ],
  "listItems": [ { "id": "unique_id", "title": "Label", "description": "Optional" } ],
  "listTitle": "Menu Title",
  "listButtonText": "Select Option",
  "handover": boolean,
  "handoverReason": "reason string",
  "extractedData": { "name": "...", "budget": "...", "email": "...", "projectType": "...", "intent": "...", "area": "..." }
}
`;

const getPropertyKnowledge = async () => {
  const properties = await Property.find({ isActive: true });
  if (!properties || properties.length === 0)
    return {
      text: "No specific property details available currently.",
      projects: [],
      locations: [],
    };

  const text = properties
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

  const projects = properties.map((p) => p.name).join(", ");
  const locations = [...new Set(properties.map((p) => p.location))].join(", ");

  return { text, projects, locations };
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
    const {
      text: propertyText,
      projects,
      locations,
    } = await getPropertyKnowledge();
    const history = await getRecentHistory(userPhone);

    const knownData = existingEnquiry
      ? JSON.stringify({
          name: existingEnquiry.name,
          email: existingEnquiry.email,
          budget: existingEnquiry.budget,
          bedrooms: existingEnquiry.bedrooms,
          intent: existingEnquiry.intent || "Unknown",
          projectType: existingEnquiry.projectName,
        })
      : "None";

    const filledSystemPrompt = SYSTEM_PROMPT.replace(
      "{{userName}}",
      existingEnquiry?.name || "Guest"
    )
      .replace("{{entrySource}}", existingEnquiry?.entrySource || "Direct")
      .replace("{{projectName}}", existingEnquiry?.projectName || "General")
      .replace("{{knownData}}", knownData)
      .replace("{{propertyKnowledge}}", propertyText)
      .replace("{{validProjects}}", projects || "None")
      .replace("{{validLocations}}", locations || "None");

    // 2. Start Chat
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: `SYSTEM_INSTRUCTION: ${filledSystemPrompt}` }],
        },
        ...history,
      ],
      generationConfig: {
        responseMimeType: "application/json",
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
      console.error("❌ JSON Parse Error on AI response:", e);
      // Return NULL to trigger fallback to legacy bot
      return null;
    }
  } catch (error) {
    console.error("❌ AI Service Error:", error);
    // Return NULL to trigger fallback to legacy bot
    return null;
  }
};

module.exports = { generateResponse };
