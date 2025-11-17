// backend/src/services/botService.js

const Enquiry = require('../models/Enquiry');
const Reply = require('../models/Reply');
const BotFlow = require('../models/BotFlow');
const BotNode = require('../models/BotNode');
const PhoneNumber = require('../models/PhoneNumber');
const { 
  sendTextMessage, 
  sendButtonMessage, 
  sendListMessage 
} = require('../integrations/whatsappAPI');

/* --------------------------------------------------------------
   Email Validator
----------------------------------------------------------------*/
const isValidEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

/* --------------------------------------------------------------
   Extract Project Name from URL
----------------------------------------------------------------*/
const extractProjectFromUrl = (text) => {
  if (!text) return null;

  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const found = text.match(urlRegex);
  if (!found) return null;

  try {
    const url = new URL(found[0]);
    const parts = url.pathname.split('/').filter(Boolean);
    const propIndex = parts.indexOf("properties");

    if (propIndex !== -1 && parts[propIndex + 1]) {
      const slug = parts[propIndex + 1];
      return slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }
  } catch (e) {}

  return null;
};

/* --------------------------------------------------------------
   Template Variable Filler ({{name}}, {{projectName}}, etc)
----------------------------------------------------------------*/
const fillTemplate = (text, enquiry) => {
  if (!text) return "";
  return text
    .replace(/{{name}}/gi, enquiry.name || "friend")
    .replace(/{{projectName}}/gi, enquiry.projectName || "our project")
    .replace(/{{email}}/gi, enquiry.email || "")
    .replace(/{{budget}}/gi, enquiry.budget || "")
    .replace(/{{bedrooms}}/gi, enquiry.bedrooms || "");
};

/* --------------------------------------------------------------
   Send Text / Buttons / List Based on Node Type
----------------------------------------------------------------*/
const sendMessageNode = async (to, node, enquiry, accessToken, phoneNumberId) => {
  if (!node) return null;
  const text = fillTemplate(node.messageText, enquiry);

  switch (node.messageType) {
    case "text":
      return sendTextMessage(to, text, accessToken, phoneNumberId);

    case "buttons":
      return sendButtonMessage(
        to,
        text,
        node.buttons.map(btn => ({ id: btn.nextNodeId, title: btn.title })),
        accessToken,
        phoneNumberId
      );

    case "list":
      return sendListMessage(
        to,
        text,
        node.listButtonText,
        node.listSections,
        accessToken,
        phoneNumberId
      );

    default:
      console.error(`Unknown node type: ${node.messageType}`);
      return null;
  }
};

/* --------------------------------------------------------------
   Jump to Next Node
----------------------------------------------------------------*/
const getNextNodeKey = (message, currentNode) => {
  if (message.type === "interactive" && message.interactive?.button_reply)
    return message.interactive.button_reply.id;

  if (message.type === "interactive" && message.interactive?.list_reply)
    return message.interactive.list_reply.id;

  if (currentNode.messageType === "text" && currentNode.nextNodeId)
    return currentNode.nextNodeId;

  return "main_menu";
};

/* --------------------------------------------------------------
   MAIN BOT ENGINE
----------------------------------------------------------------*/
const handleBotConversation = async (message, messageBody, recipientId, credentials) => {
  const { accessToken } = credentials;
  const customerPhone = message.from;

  /* ---------------- 1) Load BotFlow ---------------- */
  const phoneNumberDoc = await PhoneNumber.findOne({ phoneNumberId: recipientId });
  if (!phoneNumberDoc || !phoneNumberDoc.activeBotFlow) return null;

  const botFlowId = phoneNumberDoc.activeBotFlow;

  /* ---------------- 2) Load Enquiry ---------------- */
  let enquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId
  });

  /* --------------------------------------------------------------
     2A) Follow-Up Button Handler (MUST RUN AFTER LOADING ENQUIRY)
  ----------------------------------------------------------------*/
  if (
    message.type === "interactive" &&
    message.interactive?.button_reply &&
    ["followup_yes", "followup_no"].includes(message.interactive.button_reply.id)
  ) {
    if (!enquiry) return null;

    const reply = message.interactive.button_reply.id;

    if (reply === "followup_yes") {
      enquiry.agentContacted = true;
      await enquiry.save();

      await sendTextMessage(
        customerPhone,
        "🙏 Thank you for confirming!",
        accessToken,
        recipientId
      );

      return null;
    }

    if (reply === "followup_no") {
      enquiry.agentContacted = false;
      enquiry.needsImmediateAttention = true;
      await enquiry.save();

      await sendTextMessage(
        customerPhone,
        "💬 Thank you for your feedback. I will inform our agent immediately.",
        accessToken,
        recipientId
      );

      return null;
    }
  }

  /* --------------------------------------------------------------
     2B) **COOLDOWN LOGIC — 1 HOUR LOCK**
  ----------------------------------------------------------------*/
  if (enquiry && enquiry.status === "completed") {
    const oneHour = 1000 * 60 * 60;
    const now = Date.now();

    const diff = enquiry.completedAt
      ? now - enquiry.completedAt.getTime()
      : oneHour + 1;

    if (diff < oneHour) {
      await sendTextMessage(
        customerPhone,
        "⏳ Your enquiry is already completed.\nOur expert will contact you shortly.\n\nYou can start a new enquiry after 1 hour.",
        accessToken,
        recipientId
      );
      return null;
    }

    // Old enquiry > 1 hour → remove it, start new
    await Enquiry.deleteOne({ _id: enquiry._id });
    enquiry = null;
  }

  let currentNodeKey;

  /* --------------------------------------------------------------
     3) NEW USER FLOW (START + FIRST NODE + FOLLOW-UP)
  ----------------------------------------------------------------*/
  if (!enquiry) {
    const flow = await BotFlow.findById(botFlowId);
    const startNode = await BotNode.findById(flow.startNode);

    enquiry = await Enquiry.create({
      phoneNumber: customerPhone,
      recipientId,
      conversationState: startNode.nodeId,
      status: "active",
      completedAt: null
    });

    // Send START node
    await sendMessageNode(customerPhone, startNode, enquiry, accessToken, recipientId);

    // 45-minute follow-up
    setTimeout(async () => {
      const fresh = await Enquiry.findOne({ phoneNumber: customerPhone, recipientId });

      if (!fresh || fresh.agentContacted || fresh.status === "completed") return;

      await sendButtonMessage(
        customerPhone,
        "👋 Just checking in...\nDid someone from Capital Avenue contact you?",
        [
          { id: "followup_yes", title: "Yes" },
          { id: "followup_no", title: "No" }
        ],
        accessToken,
        recipientId
      );
    }, 45 * 60 * 1000);

    // Auto jump to first question
    if (startNode.nextNodeId && startNode.nextNodeId !== "END") {
      const firstNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: startNode.nextNodeId
      });

      if (firstNode) {
        await sendMessageNode(customerPhone, firstNode, enquiry, accessToken, recipientId);
        enquiry.conversationState = firstNode.nodeId;
        await enquiry.save();
        return null;
      }
    }

    currentNodeKey = startNode.nodeId;
  } else {
    currentNodeKey = enquiry.conversationState;
  }

  /* --------------------------------------------------------------
     4) PROJECT URL DETECTION
  ----------------------------------------------------------------*/
  const project = extractProjectFromUrl(messageBody);
  if (project) {
    enquiry.projectName = project;
    await enquiry.save();
    return null;
  }

  /* --------------------------------------------------------------
     5) Load current node
  ----------------------------------------------------------------*/
  const currentNode = await BotNode.findOne({ botFlow: botFlowId, nodeId: currentNodeKey });
  if (!currentNode) return null;

  /* --------------------------------------------------------------
     6) Handle Input for Text Nodes (Skip, Email, Normal)
  ----------------------------------------------------------------*/
  if (currentNode.messageType === "text" && currentNode.saveToField) {
    const field = currentNode.saveToField.toLowerCase();
    const userInput = (messageBody || "").trim();

    /* skip option */
    if (userInput.toLowerCase() === "skip") {
      enquiry[field] = "";
      await enquiry.save();
    }

    /* email validation */
    else if (field === "email") {
      const email = userInput.toLowerCase();

      if (!isValidEmail(email)) {
        await sendTextMessage(
          customerPhone,
          "Invalid email. Please enter a valid email address (example: name@example.com)\n\nOr type *skip* to continue.",
          accessToken,
          recipientId
        );
        return null;
      }

      enquiry.email = email;
      await enquiry.save();
    }

    /* normal field */
    else {
      enquiry[currentNode.saveToField] = userInput;
      await enquiry.save();
    }
  }

  /* --------------------------------------------------------------
     7) Determine Next Node
  ----------------------------------------------------------------*/
  const nextNodeKey = getNextNodeKey(message, currentNode);

  /* END node handling */
  if (nextNodeKey === "END") {
    enquiry.status = "completed";
    enquiry.completedAt = new Date();
    enquiry.conversationState = "END";
    await enquiry.save();
    return null;
  }

  /* Load next node */
  const nextNode = await BotNode.findOne({ botFlow: botFlowId, nodeId: nextNodeKey });
  if (!nextNode) return null;

  /* --------------------------------------------------------------
     8) Send it
  ----------------------------------------------------------------*/
  const botReply = await sendMessageNode(customerPhone, nextNode, enquiry, accessToken, recipientId);

  enquiry.conversationState = nextNodeKey;
  await enquiry.save();

  /* --------------------------------------------------------------
     9) Save outgoing reply
  ----------------------------------------------------------------*/
  if (botReply?.messages?.[0]?.id) {
    await Reply.create({
      messageId: botReply.messages[0].id,
      from: customerPhone,
      recipientId,
      body: fillTemplate(nextNode.messageText, enquiry),
      timestamp: new Date(),
      direction: "outgoing",
      read: true
    });
  }

  return null;
};

module.exports = {
  handleBotConversation
};
