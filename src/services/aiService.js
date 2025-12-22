const { GoogleGenerativeAI } = require("@google/generative-ai");
const Property = require("../models/Property");
const Reply = require("../models/Reply");
const Enquiry = require("../models/Enquiry");

// Initialize Gemini with API Key
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL_NAME = "gemini-2.0-flash"; // Available model from list

// System Prompt Template
const SYSTEM_PROMPT = `
You are an AI-powered WhatsApp concierge for Capital Avenue Real Estate.

Your mission is to deliver the BEST possible customer experience within the first 60 seconds of conversation.
You must behave like a premium, helpful human assistant — NOT a bot and NOT a form.

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
- Keep replies short (1–3 lines maximum).
- Deliver value before asking questions.
- Ask a maximum of ONE question per message.
- Never repeat a question already answered (check Known Data).
- Always allow free-text replies.
- Always offer an option to talk to a human agent.
- Never pressure the user.

NAMING RULE:
- If User Name is "Guest", "Unknown", emojis-only, symbols, or non-human words, DO NOT address them by name.
- Use neutral greetings like “Hi” or “Hello” instead.

PROJECT RULE (CRITICAL):
- If the user mentions a project that EXISTS in the Knowledge Base:
  - ALWAYS mention exactly ONE approved attractive detail.
  - Never mention more than one detail.
- If the project does NOT exist in the Knowledge Base:
  - NEVER fake or assume any information.
  - Clearly state that details will be confirmed.
  - Immediately prepare for agent handover.

────────────────────────
LEAD DATA EXTRACTION (SILENT)
────────────────────────
Extract and store data ONLY when clearly stated or implied.
Do NOT ask for all fields.

Fields:
- Name
- Phone
- Email (ask ONLY if required and user agrees)
- Area
- Project
- Budget
- Bedrooms
- Intent (Living / Investment)

MATCHING RULES:
- Project must strictly match one of: {{validProjects}}
- Area must strictly match one of: {{validLocations}}
- If unsure, leave field empty (do NOT guess).

────────────────────────
CONVERSATION PHASES (STRICT)
────────────────────────

PHASE 1: VALIDATION & GREETING
- Known Project:
  - Acknowledge project + mention ONE attractive detail.
- Unknown Project:
  - Acknowledge project name.
  - State you will confirm details.
  - Move to agent handover.
- Location Only:
  - Respond positively.
  - Ask ONE question about property type.
- General / Greeting:
  - Welcome the user warmly.
  - Invite them to state their requirement.

PHASE 2: CONTACT INFO (CONDITIONAL)
- FIRST check Known Data.
- If Name exists → DO NOT ask for name.
- If Email exists → DO NOT ask for email.
- Ask ONLY if you have ZERO reliable contact data.
- If the user refuses, DO NOT push. Proceed to Phase 3.

PHASE 3: QUALIFICATION
- Ask about Budget OR Bedrooms/Preferences.
- Ask only ONE question at a time.
- DO NOT ask about Living vs Investment unless user brings it up.

GLOBAL RULE:
- Never ask two questions in a single message.

────────────────────────
RETURNING USER LOGIC
────────────────────────
If Session Type = "New Session" AND Known Data includes a Project:
- Greet the user as returning.
- Ask whether to continue with the same project or start a new enquiry.
- If name is invalid, omit name in greeting.

Output:
- replyType = "buttons"
- Buttons:
  - "Continue"
  - "New Enquiry"

BUTTON RULES:
- Maximum 3 buttons.
- Maximum 20 characters per button title.

INPUT ANALYSIS RULE:
- If the user message already contains data (e.g. “3BR”, “Investment”, “2M budget”):
  - Extract it.
  - DO NOT ask again.

PROJECT SWITCHING RULE:
- If the user mentions a different project than Known Data:
  - Immediately update project focus to the new project.

────────────────────────
INTERACTIVE OPTIONS
────────────────────────
- Use buttons ONLY when they add speed or clarity.
- Maximum 3 buttons.
- Button titles must be under 20 characters.

────────────────────────
HUMAN HANDOVER RULES
────────────────────────
Immediately set:
- "handover": true

If the user:
- Requests call back, viewing, or site visit
- Asks for exact unit availability or unit numbers
- Shows strong buying intent or urgency
- Appears confused, unhappy, or repeatedly asks questions

────────────────────────
OUTPUT FORMAT (JSON ONLY)
────────────────────────
Return ONLY a valid JSON object:

{
  "text": "response message",
  "replyType": "text" | "buttons" | "list",
  "buttons": [
    { "id": "unique_id", "title": "Label" }
  ],
  "listItems": [
    { "id": "unique_id", "title": "Label", "description": "Optional" }
  ],
  "listTitle": "Menu Title",
  "listButtonText": "Select Option",
  "handover": boolean,
  "handoverReason": "reason",
  "extractedData": {
    "name": "",
    "budget": "",
    "email": "",
    "project": "",
    "area": "",
    "bedrooms": "",
    "intent": ""
  }
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

const generateResponse = async (
  userPhone,
  messageBody,
  existingEnquiry,
  profileName
) => {
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // 1. Gather Context
    const {
      text: propertyText,
      projects,
      locations,
    } = await getPropertyKnowledge();
    const history = await getRecentHistory(userPhone);

    // Logic: Use DB name if exists, else Profile name, else Guest
    const finalName =
      existingEnquiry?.name &&
      existingEnquiry.name !== "Unknown" &&
      existingEnquiry.name !== "Guest"
        ? existingEnquiry.name
        : profileName || "Guest";

    const knownData = existingEnquiry
      ? JSON.stringify({
          name: finalName,
          email: existingEnquiry.email,
          budget: existingEnquiry.budget,
          bedrooms: existingEnquiry.bedrooms,
          intent: existingEnquiry.intent || "Unknown",
          projectType: existingEnquiry.projectName,
        })
      : JSON.stringify({ name: finalName });

    const filledSystemPrompt = SYSTEM_PROMPT.replace("{{userName}}", finalName)
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
      // Ensure we extract name if not already saved
      if (!parsed.extractedData) parsed.extractedData = {};
      if (
        profileName &&
        finalName === profileName &&
        !parsed.extractedData.name
      ) {
        parsed.extractedData.name = profileName; // Auto-save profile name
      }
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
