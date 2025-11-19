// backend/src/services/botService.js

const Enquiry = require("../models/Enquiry");
const Reply = require("../models/Reply");
const BotFlow = require("../models/BotFlow");
const BotNode = require("../models/BotNode");
const PhoneNumber = require("../models/PhoneNumber");
const {
  sendTextMessage,
  sendButtonMessage,
  sendListMessage,
} = require("../integrations/whatsappAPI");

// ---------------- Email Validation ----------------
const isValidEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

// ---------------- URL → Project Name -------------
const extractProjectFromUrl = (text) => {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const found = text.match(urlRegex);
  if (!found) return null;

  try {
    const url = new URL(found[0]);
    const parts = url.pathname.split("/").filter(Boolean);
    const propIndex = parts.indexOf("properties");

    if (propIndex !== -1 && parts[propIndex + 1]) {
      const slug = parts[propIndex + 1];
      return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return null;
  } catch (err) {
    return null;
  }
};

const fillTemplate = (text, enquiry) => {
  if (!text) return "";
  return text
    .replace(/{{name}}/gi, enquiry.name || "Friend")
    .replace(/{{projectName}}/gi, enquiry.projectName || "our project")
    .replace(/{{email}}/gi, enquiry.email || "")
    .replace(/{{budget}}/gi, enquiry.budget || "")
    .replace(/{{bedrooms}}/gi, enquiry.bedrooms || "");
};

const sendMessageNode = async (
  to,
  node,
  enquiry,
  accessToken,
  phoneNumberId
) => {
  if (!node) return null;
  const text = fillTemplate(node.messageText, enquiry);

  switch (node.messageType) {
    case "text":
      return sendTextMessage(to, text, accessToken, phoneNumberId);
    case "buttons": {
      const buttons = (node.buttons || []).map((btn) => ({
        id: btn.nextNodeId,
        title: btn.title,
      }));
      return sendButtonMessage(to, text, buttons, accessToken, phoneNumberId);
    }
    case "list": {
      const sections = (node.listSections || []).map((sec) => ({
        title: sec.title,
        rows: (sec.rows || []).map((row) => ({
          id: row.nextNodeId,
          title: row.title,
          description: row.description || undefined,
        })),
      }));
      return sendListMessage(
        to,
        text,
        node.listButtonText,
        sections,
        accessToken,
        phoneNumberId
      );
    }
    default:
      console.error(`Unknown node type: ${node.messageType}`);
      return null;
  }
};

const getNextNodeKey = (message, currentNode) => {
  if (message.type === "interactive" && message.interactive?.button_reply) {
    return message.interactive.button_reply.id;
  }
  if (message.type === "interactive" && message.interactive?.list_reply) {
    return message.interactive.list_reply.id;
  }
  if (currentNode.messageType === "text" && currentNode.nextNodeId) {
    return currentNode.nextNodeId;
  }
  return "main_menu"; // Fallback
};

const handleBotConversation = async (
  message,
  messageBody,
  recipientId,
  credentials
) => {
  const { accessToken } = credentials;
  const customerPhone = message.from;

  const phoneNumberDoc = await PhoneNumber.findOne({
    phoneNumberId: recipientId,
  });
  if (!phoneNumberDoc || !phoneNumberDoc.activeBotFlow) {
    return null;
  }
  const botFlowId = phoneNumberDoc.activeBotFlow;

  // 1. Find the LATEST enquiry history
  let enquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId: recipientId,
  }).sort({ createdAt: -1 });

  // ============================================================
  // 2. HANDLE BUTTON CLICKS (Follow-ups)
  // ============================================================
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const btnId = message.interactive.button_reply.id;

    if (btnId === "followup_yes") {
      if (enquiry) {
        enquiry.agentContacted = true;
        await enquiry.save();
      }
      await sendTextMessage(
        customerPhone,
        "Great! Glad we could help.",
        accessToken,
        recipientId
      );
      return null;
    }
    if (btnId === "followup_no") {
      if (enquiry) {
        enquiry.agentContacted = false;
        enquiry.needsImmediateAttention = true;
        await enquiry.save();
      }
      await sendTextMessage(
        customerPhone,
        "Thanks for letting us know. I've alerted a manager.",
        accessToken,
        recipientId
      );
      return null;
    }
  }

  // ============================================================
  // 3. START NEW ENQUIRY (If no enquiry or previous is END)
  // ============================================================
  const isNewSession = !enquiry || enquiry.conversationState === "END";

  if (isNewSession) {
    console.log(`🔄 Starting NEW enquiry for ${customerPhone}`);

    const autoProjectFirstMessage = extractProjectFromUrl(messageBody);
    const flow = await BotFlow.findById(botFlowId);
    const startNode = await BotNode.findById(flow.startNode);

    // Create new document (CLEAN SLATE - No copying history)
    enquiry = await Enquiry.create({
      phoneNumber: customerPhone,
      recipientId: recipientId,
      projectName: autoProjectFirstMessage || null,
      pageUrl: autoProjectFirstMessage ? messageBody : null,
      conversationState: startNode.nodeId,
      // We intentionally do NOT copy name/email so the bot asks again
      name: undefined,
      email: undefined,
    });

    // Send START message
    await sendMessageNode(
      customerPhone,
      startNode,
      enquiry,
      accessToken,
      recipientId
    );

    // If start node has immediate jump (e.g. it was just a greeting), move to next
    if (
      startNode.nextNodeId &&
      startNode.nextNodeId !== "END" &&
      startNode.messageType === "text"
    ) {
      const firstNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: startNode.nextNodeId,
      });
      if (firstNode) {
        const botReply = await sendMessageNode(
          customerPhone,
          firstNode,
          enquiry,
          accessToken,
          recipientId
        );
        enquiry.conversationState = firstNode.nodeId;
        await enquiry.save();

        if (botReply && botReply.messages && botReply.messages[0]?.id) {
          const newAutoReply = new Reply({
            messageId: botReply.messages[0].id,
            from: customerPhone,
            recipientId,
            body: fillTemplate(firstNode.messageText, enquiry),
            timestamp: new Date(),
            direction: "outgoing",
            read: true,
          });
          await newAutoReply.save();
          return newAutoReply;
        }
      }
    }

    // 45-min Follow-up timer
    setTimeout(async () => {
      const fresh = await Enquiry.findById(enquiry._id);
      if (fresh && !fresh.agentContacted && fresh.conversationState !== "END") {
        await sendButtonMessage(
          customerPhone,
          "👋 Just checking in... Did someone contact you yet?",
          [
            { id: "followup_yes", title: "Yes" },
            { id: "followup_no", title: "No" },
          ],
          accessToken,
          recipientId
        );
      }
    }, 45 * 60 * 1000);

    return null;
  }

  // ============================================================
  // 4. CONTINUE EXISTING SESSION
  // ============================================================
  let currentNodeKey = enquiry.conversationState;

  // URL Detection in Middle of Chat
  const autoProjectLater = extractProjectFromUrl(messageBody);
  if (autoProjectLater) {
    enquiry.projectName = autoProjectLater;
    enquiry.pageUrl = messageBody;
    await enquiry.save();
  }

  const currentNode = await BotNode.findOne({
    botFlow: botFlowId,
    nodeId: currentNodeKey,
  });
  if (!currentNode) return null;

  // Save User Input
  if (currentNode.messageType === "text" && currentNode.saveToField) {
    const field = currentNode.saveToField.toLowerCase();
    const userInput = (messageBody || "").trim();

    if (userInput.toLowerCase() === "skip") {
      enquiry[field] = "";
    } else if (field === "email") {
      if (!isValidEmail(userInput)) {
        await sendTextMessage(
          customerPhone,
          "Invalid email. Please try again or type 'skip'.",
          accessToken,
          recipientId
        );
        return null;
      }
      enquiry.email = userInput.toLowerCase();
    } else {
      enquiry[field] = userInput;
    }
    await enquiry.save();
  }

  // Determine Next Node Key
  const nextNodeKey = getNextNodeKey(message, currentNode);

  // Handle Transition to END
  if (nextNodeKey === "END") {
    if (!enquiry.endMessageSent) {
      await sendTextMessage(
        customerPhone,
        "Thank you! Your enquiry has been saved. A consultant will contact you shortly.",
        accessToken,
        recipientId
      );
      enquiry.endMessageSent = true;
    }
    enquiry.conversationState = "END";
    enquiry.endedAt = new Date();
    enquiry.status = "completed";
    await enquiry.save();
    console.log(`🤖 Bot flow ended for ${customerPhone}.`);
    return null;
  }

  // --- NO SKIP LOGIC HERE ---
  // Just get the next node and send it.
  const nextNode = await BotNode.findOne({
    botFlow: botFlowId,
    nodeId: nextNodeKey,
  });

  if (!nextNode) {
    console.error(`❌ Bot error: Next node "${nextNodeKey}" not found.`);
    return null;
  }

  // Send Next Message
  const botReply = await sendMessageNode(
    customerPhone,
    nextNode,
    enquiry,
    accessToken,
    recipientId
  );

  // Update State
  enquiry.conversationState = nextNode.nodeId;
  await enquiry.save();

  // Save Reply to DB
  if (botReply && botReply.messages && botReply.messages[0]?.id) {
    const newAutoReply = new Reply({
      messageId: botReply.messages[0].id,
      from: customerPhone,
      recipientId: recipientId,
      body: fillTemplate(nextNode.messageText, enquiry),
      timestamp: new Date(),
      direction: "outgoing",
      read: true,
    });
    await newAutoReply.save();
    return newAutoReply;
  }

  return null;
};

module.exports = {
  handleBotConversation,
};
