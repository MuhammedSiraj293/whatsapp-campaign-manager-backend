// backend/src/routes/userRoutes.js

const express = require('express');
const {
  createUser,
  getUsers,
  deleteUser,
} = require('../controllers/userController');

const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes in this file will first be protected by the 'protect' middleware,
// and then authorized to only allow the 'admin' role.
router.use(protect);
router.use(authorize('admin'));

router.route('/')
  .get(getUsers)
  .post(createUser);

router.route('/:id')
  .delete(deleteUser);

module.exports = router;