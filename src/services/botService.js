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
    console.log(`Bot disabled for ${recipientId}. No active flow.`);
    return null;
  }
  const botFlowId = phoneNumberDoc.activeBotFlow;

  // 1. Find the LATEST enquiry history (to check status)
  let lastEnquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId: recipientId,
  }).sort({ createdAt: -1 });

  let enquiry = lastEnquiry;

  // ============================================================
  // 2. HANDLE BUTTON CLICKS (Follow-ups)
  // ============================================================
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const btnId = message.interactive.button_reply.id;

    // Load reply BotNode from DB
    const replyNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: btnId,
    });

    if (!replyNode) {
      console.warn("No BotNode found for button:", btnId);
      return null;
    }

    // Handle enquiry updates
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

    // Send message as BotNode (same function you use everywhere)
    await sendMessageNode(
      customerPhone,
      replyNode,
      enquiry,
      accessToken,
      recipientId
    );
    return null;
  }
  // cool of time
  if (enquiry && enquiry.conversationState === "END") {
    const oneHourMs = 60 * 60 * 1000;
    // Check time since last update or endedAt
    const lastActivityTime = new Date(enquiry.updatedAt).getTime();
    const timeDiff = Date.now() - lastActivityTime;

    // If less than 1 hour has passed since the last interaction ended
    if (timeDiff < oneHourMs) {
      console.log(
        `⏳ Cool-off period active for ${customerPhone} (${Math.floor(
          timeDiff / 60000
        )} mins). Ignoring message.`
      );
      return null; // STOP HERE. Do not start new flow.
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

    // ✅ RESTORED: Copy history so we don't ask name/email again
    enquiry = await Enquiry.create({
      phoneNumber: customerPhone,
      recipientId: recipientId,
      projectName: autoProjectFirstMessage || null,
      pageUrl: autoProjectFirstMessage ? messageBody : null,
      conversationState: startNode.nodeId,
      name: lastEnquiry ? lastEnquiry.name : undefined,
      email: lastEnquiry ? lastEnquiry.email : undefined,
    });

    // Send START message
    await sendMessageNode(
      customerPhone,
      startNode,
      enquiry,
      accessToken,
      recipientId
    );

    // --- AUTO-JUMP FOR START NODE ---
    if (startNode.nextNodeId && startNode.nextNodeId !== "END") {
      // Update state to next node immediately so the logic below picks it up
      enquiry.conversationState = startNode.nextNodeId;
      await enquiry.save();

      // The rest of the function will now process this new state
      // We do NOT return here, we let it fall through to the "Smart Skip Loop" below
    } else {
      // If start node has no next (rare), we are done
      return null;
    }

    // 45-min Follow-up timer
    setTimeout(async () => {
      const fresh = await Enquiry.findById(enquiry._id);
      if (fresh && !fresh.agentContacted && fresh.conversationState !== "END") {
        await sendButtonMessage(
          customerPhone,
          "👋 Just checking in...\n\nDid someone from Capital Avenue Real Estate contact you?",
          [
            { id: "followup_yes", title: "Yes!" },
            { id: "followup_no", title: "No" },
          ],
          accessToken,
          recipientId
        );
      }
    }, 45 * 60 * 1000);
  }

  // ============================================================
  // 4. CONTINUE SESSION & SMART SKIP LOOP
  // ============================================================

  // URL Detection
  const autoProjectLater = extractProjectFromUrl(messageBody);
  if (autoProjectLater) {
    enquiry.projectName = autoProjectLater;
    enquiry.pageUrl = messageBody;
    await enquiry.save();
  }

  let currentNodeKey = enquiry.conversationState;
  let currentNode = await BotNode.findOne({
    botFlow: botFlowId,
    nodeId: currentNodeKey,
  });

  // If user just sent a text answer, save it first
  if (
    !isNewSession &&
    currentNode &&
    currentNode.messageType === "text" &&
    currentNode.saveToField
  ) {
    const field = currentNode.saveToField.toLowerCase();
    const userInput = (messageBody || "").trim();

    if (userInput.toLowerCase() === "skip") {
      enquiry[field] = "";
    } else if (field === "email") {
      if (!isValidEmail(userInput)) {
        await sendTextMessage(
          customerPhone,
          "Invalid email. Please enter a valid email address (example: name@example.com)\n\nOr type *skip* to continue without email..",
          accessToken,
          recipientId
        );
        return null;
      }
      enquiry.email = userInput.toLowerCase();
    } else {
      enquiry[field] = userInput;
    }

    // Move to next node after saving
    currentNodeKey = getNextNodeKey(message, currentNode);
    enquiry.conversationState = currentNodeKey;
    await enquiry.save();

    // Re-fetch the NEW current node to process in the loop
    currentNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: currentNodeKey,
    });
  } else if (!isNewSession && currentNode) {
    // It was a button/list click, move to next
    currentNodeKey = getNextNodeKey(message, currentNode);
    enquiry.conversationState = currentNodeKey;
    await enquiry.save();
    currentNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: currentNodeKey,
    });
  }

  // --- THE SMART SKIP LOOP ---
  // Keep advancing while we have the answer
  while (
    currentNode &&
    currentNode.messageType === "text" &&
    currentNode.saveToField &&
    enquiry[currentNode.saveToField] // We already have this data!
  ) {
    console.log(
      `⏩ Smart Skip: Already have ${currentNode.saveToField} ("${
        enquiry[currentNode.saveToField]
      }"). Moving to ${currentNode.nextNodeId}`
    );

    // Advance state
    currentNodeKey = currentNode.nextNodeId;
    enquiry.conversationState = currentNodeKey;
    await enquiry.save();

    if (currentNodeKey === "END") break; // Exit loop if we hit END

    // Load next node for checking
    currentNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: currentNodeKey,
    });
  }

  // Handle END
  if (currentNodeKey === "END" || !currentNode) {
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
    enquiry.status = "completed";
    await enquiry.save();
    console.log(`🤖 Bot flow ended for ${customerPhone}.`);
    return null;
  }

  // Finally, send the message for the node we stopped at
  const botReply = await sendMessageNode(
    customerPhone,
    currentNode,
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
      body: fillTemplate(currentNode.messageText, enquiry),
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
