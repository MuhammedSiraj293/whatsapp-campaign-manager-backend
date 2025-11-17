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
      const slug = parts[propIndex + 1]; // bloom-marbella

      return slug
        .replace(/-/g, " ") // bloom marbella
        .replace(/\b\w/g, (c) => c.toUpperCase()); // Bloom Marbella
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
    .replace(/{{name}}/gi, enquiry.name || "friend")
    .replace(/{{projectName}}/gi, enquiry.projectName || "our project")
    .replace(/{{email}}/gi, enquiry.email || "")
    .replace(/{{budget}}/gi, enquiry.budget || "")
    .replace(/{{bedrooms}}/gi, enquiry.bedrooms || "");
};

/**
 * Helper to send the correct message type based on the node
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
  return "main_menu";
};

/**
 * Main Bot Engine: Handles an incoming message
 */
const handleBotConversation = async (
  message,
  messageBody,
  recipientId,
  credentials
) => {
  const { accessToken } = credentials;
  const customerPhone = message.from;

  // 1. Find the Phone Number doc to get the active bot flow
  const phoneNumberDoc = await PhoneNumber.findOne({
    phoneNumberId: recipientId,
  });
  if (!phoneNumberDoc || !phoneNumberDoc.activeBotFlow) {
    console.log(`🤖 Bot disabled for ${recipientId}. No active flow.`);
    return null;
  }
  const botFlowId = phoneNumberDoc.activeBotFlow;

  // 2. Find or create the user's enquiry session
  let enquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId: recipientId,
  });

  let currentNodeKey;

  /* ------------------------------------------------
   * 2A. Handle Follow-up (45 min) & Restart Buttons
   * ------------------------------------------------ */
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const btnId = message.interactive.button_reply.id;

    // 45-min follow-up buttons
    if (btnId === "followup_yes" || btnId === "followup_no") {
      if (!enquiry) return null; // nothing to attach to

      if (btnId === "followup_yes") {
        enquiry.agentContacted = true;
        await enquiry.save();

        await sendTextMessage(
          customerPhone,
          "Thank you for confirming! We are glad our team contacted you.",
          accessToken,
          recipientId
        );
        return null;
      }

      if (btnId === "followup_no") {
        enquiry.agentContacted = false;
        enquiry.needsImmediateAttention = true;
        await enquiry.save();

        await sendTextMessage(
          customerPhone,
          "Thank you for your feedback. I will notify our team immediately so they can contact you.",
          accessToken,
          recipientId
        );
        return null;
      }
    }

    // Restart buttons (after 1 hour)
    if (btnId === "restart_yes" || btnId === "restart_no") {
      if (!enquiry) return null;

      if (btnId === "restart_no") {
        await sendTextMessage(
          customerPhone,
          "No problem 😊 I'm always here whenever you need real estate assistance.",
          accessToken,
          recipientId
        );
        return null;
      }

      if (btnId === "restart_yes") {
        // Start a brand new flow
        const flow = await BotFlow.findById(botFlowId);
        const startNode = await BotNode.findById(flow.startNode);

        // Option: keep old enquiry for history, create new one
        enquiry = await Enquiry.create({
          phoneNumber: customerPhone,
          recipientId: recipientId,
          conversationState: startNode.nodeId,
        });

        // Send START
        await sendMessageNode(
          customerPhone,
          startNode,
          enquiry,
          accessToken,
          recipientId
        );

        // Auto jump to FIRST node if exists
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

        // otherwise user will reply to START
        return null;
      }
    }
  }

  /* ------------------------------------------------
   * 2B. If enquiry already ended (END state)
   * ------------------------------------------------ */
  if (enquiry && enquiry.conversationState === "END") {
    const oneHourMs = 60 * 60 * 1000;
    const endedAt = enquiry.endedAt;

    if (endedAt && Date.now() - endedAt.getTime() < oneHourMs) {
      console.log(
        `Enquiry for ${customerPhone} already ended. Ignoring message.`
      );
      return null;
    }

    // After 1 hour → offer to start a new enquiry
    await sendButtonMessage(
      customerPhone,
      "👋 It’s been a while since your last enquiry.\nWould you like to start a new consultation?",
      [
        { id: "restart_yes", title: "Start New Enquiry" },
        { id: "restart_no", title: "No, thanks" },
      ],
      accessToken,
      recipientId
    );
    return null;
  }

  // ------------- New enquiry (first message) -------------
  if (!enquiry) {
    const flow = await BotFlow.findById(botFlowId);
    const startNode = await BotNode.findById(flow.startNode);

    // Create session
    enquiry = await Enquiry.create({
      phoneNumber: customerPhone,
      recipientId: recipientId,
      conversationState: startNode.nodeId,
    });

    // 1️⃣ Send START node
    await sendMessageNode(
      customerPhone,
      startNode,
      enquiry,
      accessToken,
      recipientId
    );

    // 2️⃣ Schedule follow-up (45 minutes)
    setTimeout(async () => {
      try {
        const freshEnquiry = await Enquiry.findOne({
          phoneNumber: customerPhone,
          recipientId,
        });

        if (!freshEnquiry) return;
        if (freshEnquiry.agentContacted) return;
        if (freshEnquiry.conversationState === "END") return;

        await sendButtonMessage(
          customerPhone,
          "👋 Just checking in...\n\nDid someone from Capital Avenue contact you?",
          [
            { id: "followup_yes", title: "Yes" },
            { id: "followup_no", title: "No" },
          ],
          accessToken,
          recipientId
        );
      } catch (err) {
        console.error("Error in follow-up timeout:", err);
      }
    }, 45 * 60 * 1000);

    // 3️⃣ Auto-jump to FIRST node
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

        return null; // STOP MAIN FLOW
      }
    }

    // Start node has no next → fallback
    currentNodeKey = startNode.nodeId;
  } else {
    currentNodeKey = enquiry.conversationState;
  }

  /*
  ===========================================
   ✅ STEP 2 — Auto-detect project URL and save name
  ===========================================
  */
  const autoProject = extractProjectFromUrl(messageBody);
  if (autoProject) {
    enquiry.projectName = autoProject;
    await enquiry.save();
    return null;
  }
  /*
  ===========================================
            END OF STEP 2
  ===========================================
  */

  // 3. Find the user's current node in the flow
  const currentNode = await BotNode.findOne({
    botFlow: botFlowId,
    nodeId: currentNodeKey,
  });
  if (!currentNode) {
    console.error(
      `❌ Bot error: Could not find node "${currentNodeKey}" in flow "${botFlowId}"`
    );
    return null;
  }

  // 4. If the current node was a question, save the answer
  if (currentNode.messageType === "text" && currentNode.saveToField) {
    const field = currentNode.saveToField.toLowerCase(); // normalize
    const userInput = (messageBody || "").trim();

    // 0. Skip option
    if (userInput.toLowerCase() === "skip") {
      // User chose to skip
      enquiry[field] = ""; // Clear or leave empty
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

    // 1. Email validation
    if (field === "email") {
      const formattedEmail = userInput.toLowerCase();

      if (!isValidEmail(formattedEmail)) {
        await sendTextMessage(
          customerPhone,
          "Invalid email. Please enter a valid email address (example: name@example.com)\n\nOr type *skip* to continue without email.",
          accessToken,
          recipientId
        );
        return null; // repeat same node
      }
      // Save valid email
      enquiry.email = formattedEmail;
    } else {
      // 2. Normal field
      enquiry[currentNode.saveToField] = userInput;
    }

    await enquiry.save();
  }

  // 5. Determine the next node to go to
  const nextNodeKey = getNextNodeKey(message, currentNode);

  // ---------- END handling ----------
  if (nextNodeKey === "END") {
    // Send END node message ONCE (from DB) if exists
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

  // 6. Fetch the next node from the database
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

  // 7. Send the new message from the next node
  const botReply = await sendMessageNode(
    customerPhone,
    nextNode,
    enquiry,
    accessToken,
    recipientId
  );

  // 8. Update the user's state to the new node
  enquiry.conversationState = nextNodeKey;
  await enquiry.save();

  // 9. Save the bot's reply to the chat history
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
    return newAutoReply; // Return the saved reply
  }

  return null;
};

module.exports = {
  handleBotConversation,
};
