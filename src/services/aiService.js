const { GoogleGenerativeAI } = require("@google/generative-ai");
const Property = require("../models/Property");
const Reply = require("../models/Reply");
const Enquiry = require("../models/Enquiry");

// Initialize Gemini with API Key
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL_NAME = "gemini-2.0-flash"; // Available model from list

// System Prompt Template
const SYSTEM_PROMPT = `
You are the AI concierge for Capital Avenue Real Estate.
Goal: Provide a premium, natural, efficient experience. Be professional, warm, and concise (1-3 lines).
Language: Detect user language (English/Arabic) and reply in the SAME language.

CONTEXT:
User: {{userName}} | Source: {{entrySource}} | Interest: {{projectName}} | History: {{knownData}} | Valid Projects: {{validProjects}} | Valid Locations: {{validLocations}}

KNOWLEDGE BASE:
{{propertyKnowledge}}

RULES:
1. **Response**: Answer the user's last message directly. Ask max 1 question/msg. Never repeat asked questions.
2. **Name**: If {{userName}} is "Guest"/"Unknown", ask: "How may we address you?". Else, use it.
3. **Projects**:
   - Known Project: Mention 1 attractive detail (NO PRICE).
   - Hot Deals/Listings: Search KB. If match found in requested location, show it. Else, apologize & suggest alternatives.
   - Unknown: Verify, don't guess. Handover if specific unit requested.
4. **Flow**:
   - **Reset**: If user says "Start over/Cancel", ignore history, say "Let's start fresh."
   - **Properties**: If specific type/location asked and found, show it immediately. Skip greeting.
     - **Location Match (CRITICAL)**: If user asks for "Yas Island", ONLY show "Yas Island" properties.
   - **Data**: Extract Name, Phone, Area, Project, Budget, Bedrooms, Intent.
     - Budget: parse "1.7m" -> "1.7 million".
   - **Handover**: If User asks for Call/Meeting/Specific Unit OR all data (Name, Project, Loc, Budget, Beds) collected for a SPECIFIC project:
     - Say: "Thank you [Name]. A consultant will contact you shortly to discuss [Project]."
     - Set JSON "handover": true.

OUTPUT (JSON ONLY):
{
  "text": "response",
  "replyType": "text"|"buttons"|"list",
  "buttons": [ { "id": "id", "title": "Label" } ],
  "extractedData": { "name": "", "budget": "", "project": "", "area": "", "bedrooms": "", "intent": "" },
  "handover": boolean
}
`;

const getPropertyKnowledge = async (userQuery = "") => {
  const allProperties = await Property.find({ isActive: true });

  if (!allProperties || allProperties.length === 0)
    return {
      text: "No specific property details available currently.",
      projects: [],
      locations: [],
    };

  const queryLower = userQuery.toLowerCase();

  // 1. Filter Logic
  // Extract potential keywords (>3 chars) to avoid noise like "the", "and", "in"
  const queryKeywords = queryLower.split(/\s+/).filter((w) => w.length > 3);

  let filteredProps = allProperties.filter((p) => {
    // A) Direct Matches (Project Name / Location)
    const nameMatch = p.name && queryLower.includes(p.name.toLowerCase());
    const locMatch =
      p.location && queryLower.includes(p.location.toLowerCase());

    // B) Tag Match: query mentions a tag (e.g. "Waterfront")
    const tagMatch =
      p.tags && p.tags.some((t) => queryLower.includes(t.toLowerCase()));

    // C) Description/Keyword Match: deep search for "school", "mall", etc.
    const descMatch = queryKeywords.some(
      (kw) =>
        (p.description && p.description.toLowerCase().includes(kw)) ||
        (p.tags && p.tags.some((t) => t.toLowerCase().includes(kw)))
    );

    return nameMatch || locMatch || tagMatch || descMatch;
  });

  // 2. Fallback: If no specific match, show FRESH inventory
  if (filteredProps.length === 0) {
    // Sort by Newest (updatedAt)
    filteredProps = allProperties
      .sort((a, b) => {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      })
      .slice(0, 30);
  }

  // 3. Format as Text
  const text = filteredProps
    .map(
      (p) => `
    Project: ${p.name}
    Developer: ${p.developer || "N/A"}
    Location: ${p.location}
    Type: ${p.propertyType || "N/A"}
    Unit Types: ${p.unitType || "N/A"}
    Prices: ${p.priceRange || "N/A"}
    Size: ${p.unitSize || "N/A"}
    Handover: ${p.handoverDate || "N/A"}
    Desc: ${p.description || "N/A"}
    Tags: ${p.tags && p.tags.length > 0 ? p.tags.join(", ") : "None"}
  `
    )
    .join("\n---\n");

  const projects = allProperties.map((p) => p.name).join(", ");
  const locations = [...new Set(allProperties.map((p) => p.location))].join(
    ", "
  );

  return { text, projects, locations };
};

const getRecentHistory = async (phoneNumber, limit = 30) => {
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
    } = await getPropertyKnowledge(messageBody);
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
