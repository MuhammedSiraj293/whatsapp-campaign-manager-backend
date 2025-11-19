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
    .replace(/{{name}}/gi, enquiry.name || "")
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
    // User clicked a button, the ID *is* the next node key
    return message.interactive.button_reply.id;
  }
  if (message.type === "interactive" && message.interactive?.list_reply) {
    // User selected from a list, the ID *is* the next node key
    return message.interactive.list_reply.id;
  }
  if (currentNode.messageType === "text" && currentNode.nextNodeId) {
    // User sent text in reply to a question, follow the simple path
    return currentNode.nextNodeId;
  }
  // Fallback
  return currentNode.nextNodeId;
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
    console.log(`🤖 Bot disabled for ${recipientId}. No active flow.`);
    return null;
  }
  const botFlowId = phoneNumberDoc.activeBotFlow;

  let enquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId: recipientId,
  });

  let currentNodeKey;

  // ------------------------------------------------
  // FOLLOW-UP BUTTONS
  // ------------------------------------------------
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const btnId = message.interactive.button_reply.id;

    const replyNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: btnId,
    });

    if (!replyNode) return null;

    if (btnId === "followup_yes") {
      if (enquiry) {
        enquiry.agentContacted = true;
        await enquiry.save();
      }
    }

    if (btnId === "followup_no") {
      if (enquiry) {
        enquiry.agentContacted = false;
        enquiry.needsImmediateAttention = true;
        await enquiry.save();
      }
    }

    await sendMessageNode(
      customerPhone,
      replyNode,
      enquiry,
      accessToken,
      recipientId
    );
    return null;
  }

  // ------------------------------------------------
  // COOL-OFF CHECK (1 hour)
  // ------------------------------------------------
  if (enquiry && enquiry.conversationState === "END") {
    const oneHourMs = 60 * 60 * 1000;
    const lastActivityTime = new Date(enquiry.updatedAt).getTime();
    const diff = Date.now() - lastActivityTime;

    if (diff < oneHourMs) {
      console.log(
        `⏳ Cool-off active for ${customerPhone}, ignoring message...`
      );
      return null;
    }
  }

  // ------------------------------------------------
  // AUTO-DETECT PROJECT (first message)
  // ------------------------------------------------
  const autoProjectFirstMessage = extractProjectFromUrl(messageBody);

  // ------------------------------------------------
  // NEW ENQUIRY CREATION
  // ------------------------------------------------
  if (!enquiry) {
    const last = await Enquiry.findOne({
      phoneNumber: customerPhone,
      recipientId,
    }).sort({ createdAt: -1 });

    const flow = await BotFlow.findById(botFlowId);
    const startNode = await BotNode.findById(flow.startNode);

    enquiry = await Enquiry.create({
      phoneNumber: customerPhone,
      recipientId,
      projectName: autoProjectFirstMessage || null,
      pageUrl: autoProjectFirstMessage ? messageBody : null,
      conversationState: startNode.nodeId,

      // 🔵 SKIP LOGIC FIX
      skipName: last?.name ? true : false,
      skipEmail: last?.email ? true : false,
    });

    // send START
    await sendMessageNode(
      customerPhone,
      startNode,
      enquiry,
      accessToken,
      recipientId
    );

    // FOLLOW-UP 45 MIN
    setTimeout(async () => {
      const fresh = await Enquiry.findOne({
        phoneNumber: customerPhone,
        recipientId,
      });
      if (!fresh || fresh.agentContacted) return;

      await sendButtonMessage(
        customerPhone,
        "👋 Just checking in...\n\nDid someone from Capital Avenue contact you?",
        [
          { id: "followup_yes", title: "Yes!" },
          { id: "followup_no", title: "No" },
        ],
        accessToken,
        recipientId
      );
    }, 45 * 60 * 1000);

    // send next after START
    if (startNode.nextNodeId && startNode.nextNodeId !== "END") {
      const firstNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: startNode.nextNodeId,
      });

      if (firstNode) {
        await sendMessageNode(
          customerPhone,
          firstNode,
          enquiry,
          accessToken,
          recipientId
        );
        enquiry.conversationState = firstNode.nodeId;
        await enquiry.save();
        return null;
      }
    }

    currentNodeKey = startNode.nodeId;
  }

  if (enquiry && !currentNodeKey) {
    currentNodeKey = enquiry.conversationState;
  }

  // ------------------------------------------------
  // AUTO-DETECT PROJECT ANYTIME
  // ------------------------------------------------
  const autoProjectLater = extractProjectFromUrl(messageBody);
  if (autoProjectLater) {
    enquiry.projectName = autoProjectLater;
    enquiry.pageUrl = messageBody;
    await enquiry.save();
    return null;
  }

  // ------------------------------------------------
  // LOAD CURRENT NODE
  // ------------------------------------------------
  const currentNode = await BotNode.findOne({
    botFlow: botFlowId,
    nodeId: currentNodeKey,
  });

  if (!currentNode) return null;

  // ------------------------------------------------
  // 🔵 SKIP LOGIC (Only name + email)
  // ------------------------------------------------
  if (currentNode.saveToField === "name" && enquiry.skipName) {
    enquiry.conversationState = currentNode.nextNodeId;
    await enquiry.save();
    const nn = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: currentNode.nextNodeId,
    });
    await sendMessageNode(customerPhone, nn, enquiry, accessToken, recipientId);
    return null;
  }

  if (currentNode.saveToField === "email" && enquiry.skipEmail) {
    enquiry.conversationState = currentNode.nextNodeId;
    await enquiry.save();
    const nn = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: currentNode.nextNodeId,
    });
    await sendMessageNode(customerPhone, nn, enquiry, accessToken, recipientId);
    return null;
  }

  // ------------------------------------------------
  // SAVE USER ANSWER
  // ------------------------------------------------
  if (currentNode.messageType === "text" && currentNode.saveToField) {
    const field = currentNode.saveToField.toLowerCase();
    const userInput = (messageBody || "").trim();

    if (userInput.toLowerCase() === "skip") {
      enquiry[field] = "";
      await enquiry.save();

      // Move to next node immediately
      const nextNodeKey = currentNode.nextNodeId;
      enquiry.conversationState = nextNodeKey;
      await enquiry.save();

      return await sendMessageNode(
        customerPhone,
        await BotNode.findOne({
          botFlow: currentNode.botFlow,
          nodeId: nextNodeKey,
        }),
        enquiry,
        accessToken,
        recipientId
      );
    }

    if (field === "email") {
      const formatted = userInput.toLowerCase();
      if (!isValidEmail(formatted)) {
        await sendTextMessage(
          customerPhone,
          "Invalid email. Please enter a valid email address (example: name@example.com)\n\nOr type *skip* to continue without email.",
          accessToken,
          recipientId
        );
        return null;
      }
      enquiry.email = formatted;
    } else {
      enquiry[currentNode.saveToField] = userInput;
    }

    await enquiry.save();
  }

  const nextNodeKey = getNextNodeKey(message, currentNode);

  // END logic
  if (nextNodeKey === "END") {
    if (!enquiry.endMessageSent) {
      const endNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: "END",
      });
      if (endNode) {
        await sendMessageNode(
          customerPhone,
          endNode,
          enquiry,
          accessToken,
          recipientId
        );
      }
      enquiry.endMessageSent = true;
    }

    enquiry.conversationState = "END";
    enquiry.endedAt = new Date();
    await enquiry.save();
    console.log(`🤖 Bot flow ended for ${customerPhone}.`);
    return null;
  }

  const nextNode = await BotNode.findOne({
    botFlow: botFlowId,
    nodeId: nextNodeKey,
  });

if (!nextNode) {
    console.error(
      `❌ Bot error: Could not find next node "${nextNodeKey}" in flow "${botFlowId}"`
    );
    // Fallback: send them to the start
    const startNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: "START",
    });
    if (startNode) {
      await sendMessageNode(
        customerPhone,
        startNode,
        enquiry,
        accessToken,
        recipientId
      );
      enquiry.conversationState = "START";
      await enquiry.save();
    }
    return null;
  }

  const botReply = await sendMessageNode(
    customerPhone,
    nextNode,
    enquiry,
    accessToken,
    recipientId
  );

  enquiry.conversationState = nextNodeKey;
  await enquiry.save();

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
