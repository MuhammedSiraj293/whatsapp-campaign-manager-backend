// backend/src/controllers/botFlowController.js

const BotFlow = require("../models/BotFlow");
const BotNode = require("../models/BotNode");
const { verifyWabaAccess } = require("../utils/accessControl");

// --- Flow Management ---

// @desc    Get all bot flows for a specific WABA
// @route   GET /api/bot-flows/waba/:wabaId
const getFlowsByWaba = async (req, res) => {
  try {
    const { wabaId } = req.params;
    verifyWabaAccess(req.user, wabaId);

    const flows = await BotFlow.find({ wabaAccount: wabaId });
    res.status(200).json({ success: true, data: flows });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Create a new bot flow
// @route   POST /api/bot-flows
const createFlow = async (req, res) => {
  try {
    const { name, wabaAccount } = req.body;
    verifyWabaAccess(req.user, wabaAccount);

    // Create the flow
    const newFlow = await BotFlow.create({
      name,
      wabaAccount,
    });

    // Every flow needs a "start" node
    const startNode = await BotNode.create({
      botFlow: newFlow._id,
      nodeId: "START", // This is the default entry point
      messageType: "text",
      messageText: "Hello! Welcome to our service.",
      nextNodeId: "END", // By default, it just ends
    });

    // Save the start node's ID to the flow
    newFlow.startNode = startNode._id;
    await newFlow.save();

    res.status(201).json({ success: true, data: newFlow });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Delete a bot flow (and all its nodes)
// @route   DELETE /api/bot-flows/:flowId
const deleteFlow = async (req, res) => {
  try {
    const { flowId } = req.params;
    const flow = await BotFlow.findById(flowId);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }
    verifyWabaAccess(req.user, flow.wabaAccount);

    // Delete all nodes associated with this flow
    await BotNode.deleteMany({ botFlow: flowId });
    // Delete the flow itself
    await flow.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Get a single flow by ID
// @route   GET /api/bot-flows/:flowId
const getFlowById = async (req, res) => {
  try {
    const flow = await BotFlow.findById(req.params.flowId);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }
    verifyWabaAccess(req.user, flow.wabaAccount);

    res.status(200).json({ success: true, data: flow });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Update a single flow by ID
// @route   PUT /api/bot-flows/:flowId
const updateFlow = async (req, res) => {
  try {
    const { flowId } = req.params;
    const flow = await BotFlow.findById(flowId);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }
    verifyWabaAccess(req.user, flow.wabaAccount);

    Object.assign(flow, req.body);
    await flow.save();

    res.status(200).json({ success: true, data: flow });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

// --- Node Management ---

// @desc    Get all nodes for a specific flow
// @route   GET /api/bot-flows/:flowId/nodes
const getFlowNodes = async (req, res) => {
  try {
    const { flowId } = req.params;
    const flow = await BotFlow.findById(flowId);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }
    verifyWabaAccess(req.user, flow.wabaAccount);

    const nodes = await BotNode.find({ botFlow: flowId });
    res.status(200).json({ success: true, data: nodes });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// @desc    Add a new node to a flow
// @route   POST /api/bot-flows/:flowId/nodes
const addNode = async (req, res) => {
  try {
    const { flowId } = req.params;
    const flow = await BotFlow.findById(flowId);
    if (!flow) {
      return res.status(404).json({ success: false, error: "Flow not found" });
    }
    verifyWabaAccess(req.user, flow.wabaAccount);

    const nodeData = req.body;
    const newNode = await BotNode.create({
      ...nodeData,
      botFlow: flowId,
    });
    res.status(201).json({ success: true, data: newNode });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Update a node
// @route   PUT /api/bot-flows/nodes/:nodeId
const updateNode = async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await BotNode.findById(nodeId).populate("botFlow");
    if (!node || !node.botFlow) {
      return res.status(404).json({ success: false, error: "Node or associated flow not found" });
    }
    verifyWabaAccess(req.user, node.botFlow.wabaAccount);

    Object.assign(node, req.body);
    await node.save();

    res.status(200).json({ success: true, data: node });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Delete a node
// @route   DELETE /api/bot-flows/nodes/:nodeId
const deleteNode = async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await BotNode.findById(nodeId).populate("botFlow");
    if (!node || !node.botFlow) {
      return res.status(404).json({ success: false, error: "Node or associated flow not found" });
    }
    verifyWabaAccess(req.user, node.botFlow.wabaAccount);

    await node.deleteOne();
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

module.exports = {
  getFlowsByWaba,
  createFlow,
  deleteFlow,
  getFlowById,
  updateFlow,
  getFlowNodes,
  addNode,
  updateNode,
  deleteNode,
};
