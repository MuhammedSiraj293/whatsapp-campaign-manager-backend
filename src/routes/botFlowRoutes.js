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

// Add a new node to a flow
router.post("/:flowId/nodes", addNode);

// Update a specific node by its unique ID
router.put("/nodes/:nodeId", updateNode);

// Delete a specific node by its unique ID
router.delete("/nodes/:nodeId", deleteNode);

module.exports = router;
