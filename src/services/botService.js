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

  try {
    switch (node.messageType) {
      case "text":
        return await sendTextMessage(to, text, accessToken, phoneNumberId);

      case "buttons": {
        const buttons = (node.buttons || []).map((btn) => ({
          id: btn.nextNodeId || btn.id,
          title: btn.title,
        }));
        console.log(`🔘 Sending buttons:`, buttons);
        return await sendButtonMessage(
          to,
          text,
          buttons,
          accessToken,
          phoneNumberId
        );
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

        // Fallback for missing listButtonText
        const buttonText = node.listButtonText || "Options";

        return await sendListMessage(
          to,
          text,
          buttonText,
          sections,
          accessToken,
          phoneNumberId
        );
      }

      default:
        console.error(`Unknown node type: ${node.messageType}`);
        return null;
    }
  } catch (error) {
    console.error(
      `❌ Error in sendMessageNode for node ${node.nodeId}:`,
      error.message
    );
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

const saveBotReply = async (
  botReply,
  customerPhone,
  recipientId,
  node,
  enquiry
) => {
  if (!botReply || !botReply.messages || !botReply.messages[0]?.id) return null;

  const newAutoReply = new Reply({
    messageId: botReply.messages[0].id,
    from: customerPhone,
    recipientId: recipientId,
    body: fillTemplate(node.messageText, enquiry),
    timestamp: new Date(),
    direction: "outgoing",
    read: true,
  });

  // --- SAVE INTERACTIVE DATA ---
  if (node.messageType === "buttons") {
    newAutoReply.interactive = {
      type: "button",
      body: fillTemplate(node.messageText, enquiry),
      action: {
        buttons: (node.buttons || []).map((btn) => ({
          type: "reply",
          reply: {
            id: btn.nextNodeId || btn.id,
            title: btn.title,
          },
        })),
      },
    };
  } else if (node.messageType === "list") {
    newAutoReply.interactive = {
      type: "list",
      body: fillTemplate(node.messageText, enquiry),
      action: {
        button: node.listButtonText || "Options",
        sections: (node.listSections || []).map((sec) => ({
          title: sec.title,
          rows: (sec.rows || []).map((row) => ({
            id: row.nextNodeId,
            title: row.title,
            description: row.description,
          })),
        })),
      },
    };
  }

  await newAutoReply.save();
  return newAutoReply;
};

const handleBotConversation = async (
  message,
  messageBody,
  recipientId,
  credentials
) => {
  const { accessToken } = credentials;
  const customerPhone = message.from;
  const generatedReplies = []; // Store all replies generated in this turn

  const phoneNumberDoc = await PhoneNumber.findOne({
    phoneNumberId: recipientId,
  });
  if (!phoneNumberDoc || !phoneNumberDoc.activeBotFlow) {
    console.log(`🤖 Bot disabled for ${recipientId}. No active flow.`);
    return [];
  }
  const botFlowId = phoneNumberDoc.activeBotFlow;

  let enquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId: recipientId,
  });

  let currentNodeKey;

  // ------------------------------------------------
  // FOLLOW-UP BUTTONS ONLY
  // ------------------------------------------------
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const btnId = message.interactive.button_reply.id;

    // Only handle follow-up buttons here, let regular flow buttons continue
    if (btnId === "followup_yes" || btnId === "followup_no") {
      console.log(`🎯 Received follow-up response: ${btnId}`);

      const flow = await BotFlow.findById(botFlowId);
      if (!flow) {
        console.error("❌ Bot flow not found for follow-up response.");
        return [];
      }

      let targetNodeId = null;

      if (btnId === "followup_yes") {
        if (enquiry) {
          enquiry.agentContacted = true;
          await enquiry.save();
        }
        targetNodeId = flow.completionFollowUpYesNodeId;
      }

      if (btnId === "followup_no") {
        if (enquiry) {
          enquiry.agentContacted = false;
          enquiry.needsImmediateAttention = true;
          await enquiry.save();
        }
        targetNodeId = flow.completionFollowUpNoNodeId;
      }

      if (!targetNodeId) {
        console.log(`⚠️ No target node configured for ${btnId}. Ending flow.`);
        return [];
      }

      const replyNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: targetNodeId,
      });

      if (!replyNode) {
        console.error(`❌ Target node ${targetNodeId} not found.`);
        return [];
      }

      console.log(`🔄 Resuming flow at node: ${targetNodeId}`);

      // Resume conversation
      enquiry.conversationState = targetNodeId;
      enquiry.endMessageSent = false;
      enquiry.endedAt = null; // Clear ended status
      console.log("💾 Saving enquiry state...");
      await enquiry.save();
      console.log("✅ Enquiry state saved.");

      console.log("🚀 Calling sendMessageNode...");
      const followUpReply = await sendMessageNode(
        customerPhone,
        replyNode,
        enquiry,
        accessToken,
        recipientId
      );
      console.log("✅ sendMessageNode returned.");

      const savedReply = await saveBotReply(
        followUpReply,
        customerPhone,
        recipientId,
        replyNode,
        enquiry
      );
      if (savedReply) generatedReplies.push(savedReply);

      return generatedReplies;
    }
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
      return [];
    } else {
      // Cool-off period has expired, restart the conversation
      console.log(
        `🔄 Cool-off period expired for ${customerPhone}, restarting conversation...`
      );

      const flow = await BotFlow.findById(botFlowId);
      const startNode = await BotNode.findById(flow.startNode);

      // Update existing enquiry with new conversation
      enquiry.conversationState = startNode.nodeId;
      enquiry.endMessageSent = false;
      enquiry.endedAt = null;

      // Auto-detect project from new message
      const autoProjectRestart = extractProjectFromUrl(messageBody);
      if (autoProjectRestart) {
        enquiry.projectName = autoProjectRestart;
        enquiry.pageUrl = messageBody;
      }

      await enquiry.save();

      // Send START message
      const startReply = await sendMessageNode(
        customerPhone,
        startNode,
        enquiry,
        accessToken,
        recipientId
      );
      const savedStart = await saveBotReply(
        startReply,
        customerPhone,
        recipientId,
        startNode,
        enquiry
      );
      if (savedStart) generatedReplies.push(savedStart);

      // Send next node after START
      if (startNode.nextNodeId && startNode.nextNodeId !== "END") {
        const firstNode = await BotNode.findOne({
          botFlow: botFlowId,
          nodeId: startNode.nextNodeId,
        });

        if (firstNode) {
          const firstReply = await sendMessageNode(
            customerPhone,
            firstNode,
            enquiry,
            accessToken,
            recipientId
          );
          enquiry.conversationState = firstNode.nodeId;
          await enquiry.save();

          const savedFirst = await saveBotReply(
            firstReply,
            customerPhone,
            recipientId,
            firstNode,
            enquiry
          );
          if (savedFirst) generatedReplies.push(savedFirst);

          return generatedReplies;
        }
      }

      return generatedReplies;
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
    const startReply = await sendMessageNode(
      customerPhone,
      startNode,
      enquiry,
      accessToken,
      recipientId
    );
    const savedStart = await saveBotReply(
      startReply,
      customerPhone,
      recipientId,
      startNode,
      enquiry
    );
    if (savedStart) generatedReplies.push(savedStart);

    // send next after START
    if (startNode.nextNodeId && startNode.nextNodeId !== "END") {
      const firstNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: startNode.nextNodeId,
      });

      if (firstNode) {
        const firstReply = await sendMessageNode(
          customerPhone,
          firstNode,
          enquiry,
          accessToken,
          recipientId
        );
        enquiry.conversationState = firstNode.nodeId;
        await enquiry.save();

        const savedFirst = await saveBotReply(
          firstReply,
          customerPhone,
          recipientId,
          firstNode,
          enquiry
        );
        if (savedFirst) generatedReplies.push(savedFirst);

        return generatedReplies;
      }
    }

    currentNodeKey = startNode.nodeId;
  }

  if (enquiry && !currentNodeKey) {
    currentNodeKey = enquiry.conversationState;
    console.log(
      `📌 Using enquiry.conversationState as currentNodeKey: ${currentNodeKey}`
    );
  } else if (currentNodeKey) {
    console.log(`📌 currentNodeKey already set: ${currentNodeKey}`);
  } else {
    console.log(`⚠️ WARNING: No currentNodeKey and no enquiry state!`);
  }

  console.log(`\n📊 STATE CHECK:`);
  console.log(`   - Enquiry conversation state: ${enquiry?.conversationState}`);
  console.log(`   - Current node key: ${currentNodeKey}`);
  console.log(`   - Message type: ${message.type}\n`);

  // ------------------------------------------------
  // AUTO-DETECT PROJECT ANYTIME
  // ------------------------------------------------
  if (messageBody.includes("http")) {
    const autoProjectLater = extractProjectFromUrl(messageBody);
    if (autoProjectLater) {
      enquiry.projectName = autoProjectLater;
      enquiry.pageUrl = messageBody;
      await enquiry.save();
      return generatedReplies;
    }
  }

  // ------------------------------------------------
  // LOAD CURRENT NODE
  // ------------------------------------------------
  const currentNode = await BotNode.findOne({
    botFlow: botFlowId,
    nodeId: currentNodeKey,
  });

  if (!currentNode) {
    console.error(`❌ Could not find current node: ${currentNodeKey}`);
    return generatedReplies;
  }

  console.log(
    `📍 Current node: ${currentNode.nodeId} (type: ${currentNode.messageType})`
  );

  // ------------------------------------------------
  // 🔵 SKIP LOGIC (Only name + email)
  // ------------------------------------------------
  if (currentNode.saveToField === "name" && enquiry.skipName) {
    console.log(`⏭️ Skipping name node`);
    enquiry.conversationState = currentNode.nextNodeId;
    await enquiry.save();
    const nn = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: currentNode.nextNodeId,
    });
    if (nn) {
      const skipReply = await sendMessageNode(
        customerPhone,
        nn,
        enquiry,
        accessToken,
        recipientId
      );
      const savedSkip = await saveBotReply(
        skipReply,
        customerPhone,
        recipientId,
        nn,
        enquiry
      );
      if (savedSkip) generatedReplies.push(savedSkip);
    }
    return generatedReplies;
  }

  if (currentNode.saveToField === "email" && enquiry.skipEmail) {
    console.log(`⏭️ Skipping email node`);
    enquiry.conversationState = currentNode.nextNodeId;
    await enquiry.save();
    const nn = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: currentNode.nextNodeId,
    });
    if (nn) {
      const skipReply = await sendMessageNode(
        customerPhone,
        nn,
        enquiry,
        accessToken,
        recipientId
      );
      const savedSkip = await saveBotReply(
        skipReply,
        customerPhone,
        recipientId,
        nn,
        enquiry
      );
      if (savedSkip) generatedReplies.push(savedSkip);
    }
    return generatedReplies;
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
      let nextNodeKey = currentNode.nextNodeId;
      enquiry.conversationState = nextNodeKey;
      await enquiry.save();

      const nextNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: nextNodeKey,
      });

      if (nextNode) {
        const skipReply = await sendMessageNode(
          customerPhone,
          nextNode,
          enquiry,
          accessToken,
          recipientId
        );
        const savedSkip = await saveBotReply(
          skipReply,
          customerPhone,
          recipientId,
          nextNode,
          enquiry
        );
        if (savedSkip) generatedReplies.push(savedSkip);
      }
      return generatedReplies;
    }

    // Validate and save email
    if (field === "email") {
      const formatted = userInput.toLowerCase();
      if (!isValidEmail(formatted)) {
        await sendTextMessage(
          customerPhone,
          "Invalid email. Please enter a valid email address (example: name@example.com)\n\nOr type *skip* to continue without email.",
          accessToken,
          recipientId
        );
        return generatedReplies;
      }
      enquiry.email = formatted;
    } else {
      // Save other fields (name, budget, bedrooms, etc.)
      enquiry[currentNode.saveToField] = userInput;
    }

    await enquiry.save();
    console.log(`✅ Saved ${field}: ${userInput}`);
  }

  // ------------------------------------------------
  // SAVE LIST/BUTTON SELECTIONS
  // ------------------------------------------------
  if (message.type === "interactive") {
    console.log(`🎯 Interactive message received`);
    console.log(`   Type: ${message.interactive?.type}`);

    if (message.interactive?.list_reply) {
      console.log(`   List reply ID: ${message.interactive.list_reply.id}`);
      console.log(
        `   List reply title: ${message.interactive.list_reply.title}`
      );

      const selectedValue = message.interactive.list_reply.title;
      if (currentNode.saveToField) {
        enquiry[currentNode.saveToField] = selectedValue;
        await enquiry.save();
        console.log(`✅ Saved ${currentNode.saveToField}: ${selectedValue}`);
      }
    }

    if (message.interactive?.button_reply) {
      console.log(`   Button reply ID: ${message.interactive.button_reply.id}`);
      console.log(
        `   Button reply title: ${message.interactive.button_reply.title}`
      );

      const selectedValue = message.interactive.button_reply.title;
      if (currentNode.saveToField) {
        enquiry[currentNode.saveToField] = selectedValue;
        await enquiry.save();
        console.log(`✅ Saved ${currentNode.saveToField}: ${selectedValue}`);
      }
    }
  }

  // ------------------------------------------------
  // DETERMINE NEXT NODE
  // ------------------------------------------------
  console.log(`\n🔍 ========== DETERMINING NEXT NODE ==========`);
  console.log(`🔍 Current node: ${currentNode.nodeId}`);
  console.log(`🔍 Current enquiry state: ${enquiry.conversationState}`);

  let nextNodeKey = getNextNodeKey(message, currentNode);

  if (!nextNodeKey) {
    console.error(`❌ No nextNodeId found on current node!`);
    return generatedReplies;
  }

  console.log(`🔄 Moving from ${currentNode.nodeId} to ${nextNodeKey}`);

  // ------------------------------------------------
  // END LOGIC
  // ------------------------------------------------
  if (nextNodeKey === "END") {
    if (!enquiry.endMessageSent) {
      const endNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: "END",
      });
      if (endNode) {
        const botReply = await sendMessageNode(
          customerPhone,
          endNode,
          enquiry,
          accessToken,
          recipientId
        );

        const savedEnd = await saveBotReply(
          botReply,
          customerPhone,
          recipientId,
          endNode,
          enquiry
        );
        if (savedEnd) generatedReplies.push(savedEnd);
      }
      enquiry.endMessageSent = true;
    }

    enquiry.conversationState = "END";
    enquiry.endedAt = new Date();
    await enquiry.save();
    console.log(`🤖 Bot flow ended for ${customerPhone}.`);
    return generatedReplies;
  }

  // ------------------------------------------------
  // FETCH NEXT NODE
  // ------------------------------------------------
  const nextNode = await BotNode.findOne({
    botFlow: botFlowId,
    nodeId: nextNodeKey,
  });

  if (!nextNode) {
    console.error(
      `❌ Bot error: Could not find next node "${nextNodeKey}" in flow "${botFlowId}"`
    );
    console.error(`Current node was: ${currentNode.nodeId}`);
    console.error(`Enquiry state: ${enquiry.conversationState}`);

    // Don't send START again - just log the error and stop
    return generatedReplies;
  }

  console.log(`✅ Found next node: ${nextNode.nodeId}`);

  // ------------------------------------------------
  // 🔵 CHECK SKIP LOGIC FOR NEXT NODE
  // ------------------------------------------------
  if (nextNode.saveToField === "name" && enquiry.skipName) {
    console.log(`⏭️ Skipping name node for ${customerPhone}`);
    const skipToNodeKey = nextNode.nextNodeId;

    const skipToNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: skipToNodeKey,
    });

    if (skipToNode) {
      const skipReply = await sendMessageNode(
        customerPhone,
        skipToNode,
        enquiry,
        accessToken,
        recipientId
      );
      enquiry.conversationState = skipToNodeKey;
      await enquiry.save();

      const savedSkip = await saveBotReply(
        skipReply,
        customerPhone,
        recipientId,
        skipToNode,
        enquiry
      );
      if (savedSkip) generatedReplies.push(savedSkip);
    }
    return generatedReplies;
  }

  if (nextNode.saveToField === "email" && enquiry.skipEmail) {
    console.log(`⏭️ Skipping email node for ${customerPhone}`);
    const skipToNodeKey = nextNode.nextNodeId;

    const skipToNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: skipToNodeKey,
    });

    if (skipToNode) {
      const skipReply = await sendMessageNode(
        customerPhone,
        skipToNode,
        enquiry,
        accessToken,
        recipientId
      );
      enquiry.conversationState = skipToNodeKey;
      await enquiry.save();

      const savedSkip = await saveBotReply(
        skipReply,
        customerPhone,
        recipientId,
        skipToNode,
        enquiry
      );
      if (savedSkip) generatedReplies.push(savedSkip);
    }
    return generatedReplies;
  }

  // ------------------------------------------------
  // SEND NEXT NODE MESSAGE
  // ------------------------------------------------
  console.log(`📤 Sending message for node: ${nextNode.nodeId}`);

  const botReply = await sendMessageNode(
    customerPhone,
    nextNode,
    enquiry,
    accessToken,
    recipientId
  );

  // 🔴 CRITICAL: Update conversation state IMMEDIATELY after sending
  enquiry.conversationState = nextNodeKey;

  // --- Follow-Up Tracking Update ---
  enquiry.lastNodeSentAt = new Date();
  enquiry.nodeFollowUpSent = false;

  await enquiry.save();
  console.log(`💾 Updated conversation state to: ${nextNodeKey}`);

  const savedReply = await saveBotReply(
    botReply,
    customerPhone,
    recipientId,
    nextNode,
    enquiry
  );
  if (savedReply) generatedReplies.push(savedReply);

  return generatedReplies;
};

module.exports = {
  handleBotConversation,
};
