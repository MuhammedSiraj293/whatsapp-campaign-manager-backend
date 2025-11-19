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
        id: btn.nextNodeId || btn.id,
        title: btn.title,
      }));
      console.log(`🔘 Sending buttons:`, buttons);
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
  // FOLLOW-UP BUTTONS ONLY
  // ------------------------------------------------
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const btnId = message.interactive.button_reply.id;

    // Only handle follow-up buttons here, let regular flow buttons continue
    if (btnId === "followup_yes" || btnId === "followup_no") {
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

      enquiry.conversationState = btnId;
      await enquiry.save();

      return null;
    }
    // If not a follow-up button, continue with normal flow processing below
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
      return null;
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
    return null;
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
      await sendMessageNode(
        customerPhone,
        nn,
        enquiry,
        accessToken,
        recipientId
      );
    }
    return null;
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
      await sendMessageNode(
        customerPhone,
        nn,
        enquiry,
        accessToken,
        recipientId
      );
    }
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
      let nextNodeKey = currentNode.nextNodeId;
      enquiry.conversationState = nextNodeKey;
      await enquiry.save();

      const nextNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: nextNodeKey,
      });

      if (nextNode) {
        await sendMessageNode(
          customerPhone,
          nextNode,
          enquiry,
          accessToken,
          recipientId
        );
      }
      return null;
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
        return null;
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
  console.log(`🔍 Message type: ${message.type}`);

  let nextNodeKey = getNextNodeKey(message, currentNode);

  // Debug logging
  console.log(`🔍 Raw nextNodeKey from getNextNodeKey: "${nextNodeKey}"`);
  if (message.type === "interactive") {
    console.log(`🔍 Interactive type:`, message.interactive?.type);
    console.log(`🔍 Button reply ID:`, message.interactive?.button_reply?.id);
    console.log(`🔍 List reply ID:`, message.interactive?.list_reply?.id);
  }
  console.log(`🔍 Current node's nextNodeId: "${currentNode.nextNodeId}"`);
  console.log(`========================================\n`);

  // Fallback – if logic fails, and it's a text field with nextNodeId, use that
  if (
    !nextNodeKey ||
    nextNodeKey === "undefined" ||
    nextNodeKey === undefined
  ) {
    console.log(`⚠️ nextNodeKey is undefined, using fallback`);
    if (currentNode.nextNodeId) {
      nextNodeKey = currentNode.nextNodeId;
      console.log(`🔄 Fallback nextNodeKey: "${nextNodeKey}"`);
    } else {
      console.error(`❌ No nextNodeId found on current node!`);
      return null;
    }
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
    return null;
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
      await sendMessageNode(
        customerPhone,
        skipToNode,
        enquiry,
        accessToken,
        recipientId
      );
      enquiry.conversationState = skipToNodeKey;
      await enquiry.save();
    }
    return null;
  }

  if (nextNode.saveToField === "email" && enquiry.skipEmail) {
    console.log(`⏭️ Skipping email node for ${customerPhone}`);
    const skipToNodeKey = nextNode.nextNodeId;

    const skipToNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: skipToNodeKey,
    });

    if (skipToNode) {
      await sendMessageNode(
        customerPhone,
        skipToNode,
        enquiry,
        accessToken,
        recipientId
      );
      enquiry.conversationState = skipToNodeKey;
      await enquiry.save();
    }
    return null;
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
  await enquiry.save();
  console.log(`💾 Updated conversation state to: ${nextNodeKey}`);

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
