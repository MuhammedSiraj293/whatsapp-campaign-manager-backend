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

// ---------------- Template Replace ----------------
const fillTemplate = (text, enquiry) => {
  if (!text) return "";
  return text
    .replace(/{{name}}/gi, enquiry.name || "")
    .replace(/{{projectName}}/gi, enquiry.projectName || "our project")
    .replace(/{{email}}/gi, enquiry.email || "")
    .replace(/{{budget}}/gi, enquiry.budget || "")
    .replace(/{{bedrooms}}/gi, enquiry.bedrooms || "");
};

// ---------------- Send Node ----------------
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

// ---------------- Smart Skip Logic ----------------
// Only skip for enquiries copied from previous sessions
const findNextUnansweredNode = async (flowId, nodeId, enquiry) => {
  if (nodeId === "END") return null;

  const currentNode = await BotNode.findOne({ botFlow: flowId, nodeId });
  if (!currentNode) return null;

  // SKIP only if enquiry was copied from previous session
  if (
    enquiry.copiedFromPrevious &&
    currentNode.messageType === "text" &&
    currentNode.saveToField &&
    enquiry[currentNode.saveToField]
  ) {
    enquiry.conversationState = currentNode.nextNodeId;
    await enquiry.save();
    return findNextUnansweredNode(flowId, currentNode.nextNodeId, enquiry);
  }

  return currentNode;
};

// ---------------- Main Handler ----------------
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
  if (!phoneNumberDoc || !phoneNumberDoc.activeBotFlow) return null;

  const botFlowId = phoneNumberDoc.activeBotFlow;

  let lastEnquiry = await Enquiry.findOne({
    phoneNumber: customerPhone,
    recipientId,
  }).sort({ createdAt: -1 });

  let enquiry = lastEnquiry;

  // ---------------- Follow-up Buttons ----------------
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const btnId = message.interactive.button_reply.id;
    const replyNode = await BotNode.findOne({
      botFlow: botFlowId,
      nodeId: btnId,
    });

    if (btnId === "followup_yes" && enquiry) {
      enquiry.agentContacted = true;
      await enquiry.save();
    }

    if (btnId === "followup_no" && enquiry) {
      enquiry.agentContacted = false;
      enquiry.needsImmediateAttention = true;
      await enquiry.save();
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

  // ---------------- Auto-start NEW enquiry ----------------
  const startNew = !enquiry || enquiry.conversationState === "END";

  if (startNew) {
    const flow = await BotFlow.findById(botFlowId);
    const startNode = await BotNode.findById(flow.startNode);

    const autoProject = extractProjectFromUrl(messageBody);

    enquiry = await Enquiry.create({
      phoneNumber: customerPhone,
      recipientId,
      conversationState: startNode.nodeId,
      projectName: autoProject || null,
      pageUrl: autoProject ? messageBody : null,

      // Copy name/email ONLY
      name: lastEnquiry?.name || null,
      email: lastEnquiry?.email || null,

      copiedFromPrevious:
        lastEnquiry && lastEnquiry.conversationState === "END" ? true : false,
    });

    await sendMessageNode(
      customerPhone,
      startNode,
      enquiry,
      accessToken,
      recipientId
    );

    if (startNode.nextNodeId !== "END") {
      const nextNode = await findNextUnansweredNode(
        botFlowId,
        startNode.nextNodeId,
        enquiry
      );

      if (nextNode) {
        const botReply = await sendMessageNode(
          customerPhone,
          nextNode,
          enquiry,
          accessToken,
          recipientId
        );

        enquiry.conversationState = nextNode.nodeId;
        await enquiry.save();
        return null;
      }
    }

    // 45-minute follow-up
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

    return null;
  }

  // ---------------- Continue Existing Session ----------------
  const currentNode = await BotNode.findOne({
    botFlow: botFlowId,
    nodeId: enquiry.conversationState,
  });

  // Save user answers ONLY for active node
  if (currentNode.messageType === "text" && currentNode.saveToField) {
    const field = currentNode.saveToField.toLowerCase();
    const userInput = (messageBody || "").trim();

    if (field === "email") {
      if (!isValidEmail(userInput)) {
        await sendTextMessage(
          customerPhone,
          "❌ Invalid email. Please send a valid email.\nOr type *skip* to continue.",
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

  const nextNodeKey = getNextNodeKey(message, currentNode);

  // END flow handling
  if (nextNodeKey === "END") {
    if (!enquiry.endMessageSent) {
      const endNode = await BotNode.findOne({
        botFlow: botFlowId,
        nodeId: "END",
      });
      await sendMessageNode(
        customerPhone,
        endNode,
        enquiry,
        accessToken,
        recipientId
      );
      enquiry.endMessageSent = true;
    }

    enquiry.conversationState = "END";
    enquiry.endedAt = new Date();
    await enquiry.save();
    return null;
  }

  // Smart skip for copied enquiries
  const nextNode = await findNextUnansweredNode(
    botFlowId,
    nextNodeKey,
    enquiry
  );

  if (!nextNode) return null;

  const botReply = await sendMessageNode(
    customerPhone,
    nextNode,
    enquiry,
    accessToken,
    recipientId
  );

  enquiry.conversationState = nextNode.nodeId;
  await enquiry.save();

  return null;
};

module.exports = { handleBotConversation };
