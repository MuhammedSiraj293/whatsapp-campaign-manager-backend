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

    // Example URL: /properties/bloom-marbella
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

/**
 * Helper to replace variables in a message, e.g., {{name}}
 */
const fillTemplate = (text, enquiry) => {
  if (!text) return "";
  return text
    .replace(/{{name}}/gi, enquiry.name || "")
    .replace(/{{projectName}}/gi, enquiry.projectName || "our project")
    .replace(/{{email}}/gi, enquiry.email || "")
    .replace(/{{budget}}/gi, enquiry.budget || "")
    .replace(/{{bedrooms}}/gi, enquiry.bedrooms || "");
};

/**
 * Helper to replace variables in a message, e.g., {{name}}
 */
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

/**
 * Helper to find the next node based on user's reply
 */
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

// --- SMART SKIPPING LOGIC ---
// Recursively find the next node that needs an answer.
// If we already have the Name/Email from a previous session, skip asking for it.
const findNextUnansweredNode = async (flowId, nodeId, enquiry) => {
  if (nodeId === "END") return null; // Let the main loop handle END

  let currentNode = await BotNode.findOne({ botFlow: flowId, nodeId: nodeId });
  if (!currentNode) return null;

  // If this node asks for a field we ALREADY have (e.g., name copied from old enquiry)
  if (
    currentNode.messageType === "text" &&
    currentNode.saveToField &&
    enquiry[currentNode.saveToField] // Data exists!
  ) {
    console.log(
      `⏩ Skipping node "${nodeId}" because we already have ${currentNode.saveToField}`
    );

    // Save state and jump to next
    enquiry.conversationState = currentNode.nextNodeId;
    await enquiry.save();

    // Recurse: Check the *next* node
    return findNextUnansweredNode(flowId, currentNode.nextNodeId, enquiry);
  }

  // If we need to ask this question, return it
  return currentNode;
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

  // 1. Find the LATEST enquiry history
  let lastEnquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId: recipientId,
  }).sort({ createdAt: -1 });

  let enquiry = lastEnquiry;

  // ============================================================
  // 2. HANDLE BUTTON CLICKS (Follow-ups / Explicit Actions)
  // ============================================================
  // Even if in cool-off, we allow button clicks to work (e.g. "Yes" to follow up)
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const btnId = message.interactive.button_reply.id; // followup_yes or followup_no

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

  // ============================================================
  // 3. COOL-OFF CHECK (The Fix)
  // ============================================================
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

  // 2. DECIDE: Continue or Start New?
  // If no enquiry exists OR the last one is finished, we start fresh.
  const isNewSession = !enquiry || enquiry.conversationState === "END";

  if (isNewSession) {
    // --- START NEW ENQUIRY AUTOMATICALLY ---
    console.log(`🔄 Starting NEW enquiry for ${customerPhone}`);

    const autoProjectFirstMessage = extractProjectFromUrl(messageBody);
    const flow = await BotFlow.findById(botFlowId);
    const startNode = await BotNode.findById(flow.startNode);

    // Create new document, copying data from history if available
    enquiry = await Enquiry.create({
      phoneNumber: customerPhone,
      recipientId: recipientId,
      projectName: autoProjectFirstMessage || null,
      pageUrl: autoProjectFirstMessage ? messageBody : null,
      conversationState: startNode.nodeId,
      // COPY HISTORY to avoid asking again
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

    // --- AUTO-JUMP logic ---
    // If start node links to "ask_name" and we HAVE the name, skip "ask_name" immediately
    if (startNode.nextNodeId && startNode.nextNodeId !== "END") {
      const nextNode = await findNextUnansweredNode(
        botFlowId,
        startNode.nextNodeId,
        enquiry
      );
      if (nextNode) {
        // We found a node that actually needs sending
        const botReply = await sendMessageNode(
          customerPhone,
          nextNode,
          enquiry,
          accessToken,
          recipientId
        );
        enquiry.conversationState = nextNode.nodeId;
        await enquiry.save();

        // Save to chat history
        if (botReply && botReply.messages && botReply.messages[0]?.id) {
          const newAutoReply = new Reply({
            messageId: botReply.messages[0].id,
            from: customerPhone,
            recipientId,
            body: fillTemplate(nextNode.messageText, enquiry),
            timestamp: new Date(),
            direction: "outgoing",
            read: true,
          });
          await newAutoReply.save();
          return newAutoReply;
        }
        return null;
      }
    }

    // 🔔 Follow-up timer logic
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

    return null; // Finished starting new session
  }

  // 3. CONTINUE EXISTING SESSION
  let currentNodeKey = enquiry.conversationState;

  // URL Detection in Middle of Chat
  const autoProjectLater = extractProjectFromUrl(messageBody);
  if (autoProjectLater) {
    enquiry.projectName = autoProjectLater;
    enquiry.pageUrl = messageBody;
    await enquiry.save();
    // Don't return, let the user continue answering the current question
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
    await enquiry.save();
  }

  // Determine Next Node Key
  const nextNodeKey = getNextNodeKey(message, currentNode);

  // Handle Transition to END
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
    enquiry.status = "completed";
    await enquiry.save();
    console.log(`🤖 Bot flow ended for ${customerPhone}.`);
    return null;
  }

  // Find the next node (using smart skipping)
  const nextNode = await findNextUnansweredNode(
    botFlowId,
    nextNodeKey,
    enquiry
  );

  if (!nextNode) {
    // If we skipped everything and reached end
    if (enquiry.conversationState === "END" || nextNodeKey === "END") {
      enquiry.conversationState = "END";
      enquiry.endedAt = new Date();
      await enquiry.save();
    }
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
