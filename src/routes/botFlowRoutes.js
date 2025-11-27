// backend/src/routes/botFlowRoutes.js

const express = require("express");
const {
  getFlowsByWaba,
  createFlow,
  deleteFlow,
  getFlowById,
  updateFlow,
  getFlowNodes,
  addNode,
  updateNode,
  deleteNode,
} = require("../controllers/botFlowController");

const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// All routes in this file are for admins only
router.use(protect);
router.use(authorize("admin"));

// --- Routes for managing the Flow itself ---

// Get all flows for a specific WABA
router.get("/waba/:wabaId", getFlowsByWaba);

// Create a new flow
router.post("/", createFlow);

// Delete a flow
router.delete("/:flowId", deleteFlow);

// Get a single flow by ID
router.get("/:flowId", getFlowById);

// Update a single flow by ID
router.put("/:flowId", updateFlow);

// --- Routes for managing the Nodes *within* a flow ---

// Get all nodes for a specific flow
router.get("/:flowId/nodes", getFlowNodes);

// Add a new node to a flow
router.post("/:flowId/nodes", addNode);

// Update a specific node by its unique ID
router.put("/nodes/:nodeId", updateNode);

// Delete a specific node by its unique ID
router.delete("/nodes/:nodeId", deleteNode);

module.exports = router;
