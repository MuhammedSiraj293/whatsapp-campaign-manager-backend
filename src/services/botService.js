// backend/src/services/botService.js

const Enquiry = require("../models/Enquiry");
const Reply = require("../models/Reply");
const BotFlow = require("../models/BotFlow");
const BotNode = require("../models/BotNode");
const PhoneNumber = require("../models/PhoneNumber");
const { getIO } = require("../socketManager");
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
  phoneNumberId,
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
          phoneNumberId,
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
          phoneNumberId,
        );
      }

      default:
        console.error(`Unknown node type: ${node.messageType}`);
        return null;
    }
  } catch (error) {
    console.error(
      `❌ Error in sendMessageNode for node ${node.nodeId}:`,
      error.message,
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
  enquiry,
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
  credentials,
) => {
  const { accessToken } = credentials;
  const customerPhone = message.from;
  const generatedReplies = []; // Store all replies generated in this turn

  // 1. Fetch Enquiry Early (Needed for system buttons)
  let enquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId: recipientId,
  }).sort({ updatedAt: -1 });

  // 2. Handle System Buttons (Stuck) - No Flow Needed
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const btnId = message.interactive.button_reply.id;

    // --- STUCK FOLLOW-UP HANDLERS ---
    if (btnId === "stuck_continue") {
      // Fetch outgoing messages (handle potential 'from'/'recipientId' inversion in legacy data)
      const history = await Reply.find({
        $or: [
          { recipientId: customerPhone, direction: "outgoing" },
          { from: customerPhone, direction: "outgoing" },
        ],
      })
        .sort({ timestamp: -1 })
        .limit(20);

      let targetMsg = null;
      // Find first message that is NOT the stuck prompt
      for (const msg of history) {
        const body = msg.body || "";

        // Check for stuck prompts (English, Arabic, or by Button ID)
        const isStuckMsg =
          body.includes("Apologies, I didn't get a response from you") ||
          body.includes("أعتذر، لم أتلق رداً منك") ||
          msg.interactive?.action?.buttons?.some(
            (b) =>
              b.reply?.id === "stuck_continue" || b.reply?.id === "stuck_end",
          );

        if (!isStuckMsg) {
          targetMsg = msg;
          break;
        }
      }

      if (!targetMsg) {
        console.log("⚠️ No previous context found. Sending fallback.");
        const fallbackText =
          enquiry?.language === "ar"
            ? "كيف يمكننا مساعدتك؟"
            : "How can we assist you?";
        await sendTextMessage(
          customerPhone,
          fallbackText,
          accessToken,
          recipientId,
        );
      } else {
        console.log(
          `✅ Resuming with message type: ${targetMsg.type || "text"}`,
        );

        let sentRes = null;

        // CASE A: BUTTONS
        if (
          targetMsg.interactive &&
          targetMsg.interactive.type === "button" &&
          targetMsg.interactive.action &&
          targetMsg.interactive.action.buttons
        ) {
          const bodyText = targetMsg.interactive.body || targetMsg.body;
          const buttons = targetMsg.interactive.action.buttons.map((b) => ({
            id: b.reply.id,
            title: b.reply.title,
          }));

          sentRes = await sendButtonMessage(
            customerPhone,
            bodyText,
            buttons,
            accessToken,
            recipientId,
          );
        }
        // CASE B: LIST
        else if (
          targetMsg.interactive &&
          targetMsg.interactive.type === "list" &&
          targetMsg.interactive.action &&
          targetMsg.interactive.action.sections
        ) {
          const bodyText = targetMsg.interactive.body || targetMsg.body;
          const btnText = targetMsg.interactive.action.button || "Options";
          const sections = targetMsg.interactive.action.sections.map((s) => ({
            title: s.title,
            rows: s.rows.map((r) => ({
              id: r.id,
              title: r.title,
              description: r.description,
            })),
          }));

          sentRes = await sendListMessage(
            customerPhone,
            bodyText,
            btnText,
            sections,
            accessToken,
            recipientId,
          );
        }
        // CASE C: TEXT (Default)
        else {
          // Ensure we don't send empty text
          const textToSend = targetMsg.body || "How can we help?";
          sentRes = await sendTextMessage(
            customerPhone,
            textToSend,
            accessToken,
            recipientId,
          );
        }

        // Save the re-sent message (optional, but good for history)
        if (sentRes?.messages?.[0]?.id) {
          // Clone the targetMsg properties but new ID/Timestamp
          const newRep = new Reply({
            messageId: sentRes.messages[0].id,
            from: recipientId,
            recipientId: customerPhone,
            body: targetMsg.body,
            timestamp: new Date(),
            direction: "outgoing",
            isAiGenerated: true, // It is a system replay
            type: targetMsg.type || "text",
            interactive: targetMsg.interactive,
          });
          await newRep.save();

          const io = getIO();
          if (io)
            io.emit("newMessage", {
              from: customerPhone,
              recipientId,
              message: newRep,
            });
        }
      }

      // Resume conversation state
      if (enquiry) {
        enquiry.lastStuckFollowUpSentAt = new Date();
        await enquiry.save();
      }
      return []; // Stop here
    }

    if (btnId === "stuck_end") {
      console.log("🛑 Processing stuck_end for:", customerPhone);

      if (!enquiry) {
        console.error(
          "❌ Enquiry not found for stuck_end. Cannot determine language.",
        );
        return [];
      }

      // Close the chat
      const byeText =
        enquiry.language === "ar"
          ? "شكراً لوقتك. سيتصل بك أحد مستشارينا قريباً لمساعدتك. نتمنى لك يوماً سعيداً! 👋"
          : "Thank you for your time. One of our Consultants will contact you shortly to assist you. Have a great day! 👋";

      console.log("📤 Sending Bye Text:", byeText);

      const byeResult = await sendTextMessage(
        customerPhone,
        byeText,
        accessToken,
        recipientId,
      );

      console.log("✅ Bye Result:", byeResult ? "Sent" : "Failed");

      // Save & Emit
      if (byeResult?.messages?.[0]?.id) {
        const byeReply = await Reply.create({
          messageId: byeResult.messages[0].id,
          from: recipientId,
          recipientId: customerPhone,
          body: byeText,
          timestamp: new Date(),
          direction: "outgoing",
          isAiGenerated: true,
          type: "text",
        });
        const io = getIO();
        if (io)
          io.emit("newMessage", {
            from: customerPhone,
            recipientId,
            message: byeReply,
          });
      }
      enquiry.conversationState = "END";
      enquiry.endedAt = new Date();
      enquiry.status = "closed"; // Mark as closed
      await enquiry.save();
      return []; // Stop here
    }
  }

  const phoneNumberDoc = await PhoneNumber.findOne({
    phoneNumberId: recipientId,
  });
  if (!phoneNumberDoc || !phoneNumberDoc.activeBotFlow) {
    console.log(`🤖 Bot disabled for ${recipientId}. No active flow.`);
    return [];
  }
  const botFlowId = phoneNumberDoc.activeBotFlow;

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

      // --- FOLLOW-UP YES/NO HANDLERS (Require Flow) ---

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
      enquiry.lastNodeSentAt = new Date(); // Reset timer
      enquiry.nodeFollowUpSent = false; // Reset sent flag
      console.log("💾 Saving enquiry state...");
      await enquiry.save();
      console.log("✅ Enquiry state saved.");

      console.log("🚀 Calling sendMessageNode...");
      const followUpReply = await sendMessageNode(
        customerPhone,
        replyNode,
        enquiry,
        accessToken,
        recipientId,
      );
      console.log("✅ sendMessageNode returned.");

      const savedReply = await saveBotReply(
        followUpReply,
        customerPhone,
        recipientId,
        replyNode,
        enquiry,
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
        `⏳ Cool-off active for ${customerPhone}, ignoring message...`,
      );
      return [];
    } else {
      // Cool-off period has expired, restart the conversation
      console.log(
        `🔄 Cool-off period expired for ${customerPhone}, restarting conversation...`,
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

      enquiry.lastNodeSentAt = new Date();
      enquiry.nodeFollowUpSent = false;
      await enquiry.save();

      // Send START message
      const startReply = await sendMessageNode(
        customerPhone,
        startNode,
        enquiry,
        accessToken,
        recipientId,
      );
      const savedStart = await saveBotReply(
        startReply,
        customerPhone,
        recipientId,
        startNode,
        enquiry,
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
            recipientId,
          );
          enquiry.conversationState = firstNode.nodeId;
          enquiry.lastNodeSentAt = new Date();
          enquiry.nodeFollowUpSent = false;
          await enquiry.save();

          const savedFirst = await saveBotReply(
            firstReply,
            customerPhone,
            recipientId,
            firstNode,
            enquiry,
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
      lastNodeSentAt: new Date(),
      nodeFollowUpSent: false,
    });

    // send START
    const startReply = await sendMessageNode(
      customerPhone,
      startNode,
      enquiry,
      accessToken,
      recipientId,
    );
    const savedStart = await saveBotReply(
      startReply,
      customerPhone,
      recipientId,
      startNode,
      enquiry,
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
          recipientId,
        );
        enquiry.conversationState = firstNode.nodeId;
        enquiry.lastNodeSentAt = new Date();
        enquiry.nodeFollowUpSent = false;
        await enquiry.save();

        const savedFirst = await saveBotReply(
          firstReply,
          customerPhone,
          recipientId,
          firstNode,
          enquiry,
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
      `📌 Using enquiry.conversationState as currentNodeKey: ${currentNodeKey}`,
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
    `📍 Current node: ${currentNode.nodeId} (type: ${currentNode.messageType})`,
  );

  // ------------------------------------------------
  // 🔵 SKIP LOGIC (Only name + email)
  // ------------------------------------------------
  if (currentNode.saveToField === "name" && enquiry.skipName) {
    console.log(`⏭️ Skipping name node`);
    enquiry.conversationState = currentNode.nextNodeId;
    enquiry.lastNodeSentAt = new Date();
    enquiry.nodeFollowUpSent = false;
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
        recipientId,
      );
      const savedSkip = await saveBotReply(
        skipReply,
        customerPhone,
        recipientId,
        nn,
        enquiry,
      );
      if (savedSkip) generatedReplies.push(savedSkip);
    }
    return generatedReplies;
  }

  if (currentNode.saveToField === "email" && enquiry.skipEmail) {
    console.log(`⏭️ Skipping email node`);
    enquiry.conversationState = currentNode.nextNodeId;
    enquiry.lastNodeSentAt = new Date();
    enquiry.nodeFollowUpSent = false;
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
        recipientId,
      );
      const savedSkip = await saveBotReply(
        skipReply,
        customerPhone,
        recipientId,
        nn,
        enquiry,
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
      enquiry.lastNodeSentAt = new Date();
      enquiry.nodeFollowUpSent = false;
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
          recipientId,
        );
        const savedSkip = await saveBotReply(
          skipReply,
          customerPhone,
          recipientId,
          nextNode,
          enquiry,
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
          recipientId,
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
        `   List reply title: ${message.interactive.list_reply.title}`,
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
        `   Button reply title: ${message.interactive.button_reply.title}`,
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
          recipientId,
        );

        const savedEnd = await saveBotReply(
          botReply,
          customerPhone,
          recipientId,
          endNode,
          enquiry,
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
      `❌ Bot error: Could not find next node "${nextNodeKey}" in flow "${botFlowId}"`,
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
        recipientId,
      );
      enquiry.conversationState = skipToNodeKey;
      enquiry.lastNodeSentAt = new Date();
      enquiry.nodeFollowUpSent = false;
      await enquiry.save();

      const savedSkip = await saveBotReply(
        skipReply,
        customerPhone,
        recipientId,
        skipToNode,
        enquiry,
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
        recipientId,
      );
      enquiry.conversationState = skipToNodeKey;
      await enquiry.save();

      const savedSkip = await saveBotReply(
        skipReply,
        customerPhone,
        recipientId,
        skipToNode,
        enquiry,
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
    recipientId,
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
    enquiry,
  );
  if (savedReply) generatedReplies.push(savedReply);

  return generatedReplies;
};

module.exports = {
  handleBotConversation,
};
