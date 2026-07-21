// backend/src/routes/authRoutes.js
    
const express = require('express');
const { register, login, changePassword } = require('../controllers/authController');
const { setupTwoFactorAuth, verifyTwoFactorAuth } = require('../controllers/twoFactorController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
    
// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/2fa/verify', verifyTwoFactorAuth);

// Protected routes
router.post('/2fa/setup', protect, setupTwoFactorAuth);
router.put('/change-password', protect, changePassword);
    
module.exports = router;