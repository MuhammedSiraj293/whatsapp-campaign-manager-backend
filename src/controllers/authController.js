// backend/src/controllers/authController.js

const User = require('../models/User');
const jwt = require('jsonwebtoken');
// use refres
const sendTokenResponse = (user, statusCode, res) => {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
  res.status(statusCode).json({ 
    success: true, 
    token,
    user: {
      _id: user._id, // Send ID as well
      name: user.name,
      role: user.role,
    }
  });
};

const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return res.status(400).json({ success: false, error: 'A user with this email already exists.' });
    }
    const newUser = { name, email, password };
    if (req.user && req.user.role === 'admin') {
      if (role && ['admin', 'manager', 'viewer'].includes(role)) {
        newUser.role = role;
      } else {
        newUser.role = 'viewer';
      }
    } else {
      newUser.role = 'viewer';
    }
    const user = await User.create(newUser);
    if (req.user && req.user.role === 'admin') {
        res.status(201).json({ success: true, message: 'User created successfully.' });
    } else {
        sendTokenResponse(user, 201, res);
    }
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide an email and password' });
    }

    // --- THIS IS THE FIX ---
    // The query now correctly selects all the necessary fields
    const user = await User.findOne({ email }).select('+password isTwoFactorEnabled name role');

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (user.isTwoFactorEnabled) {
      return res.status(200).json({
        success: true,
        twoFactorRequired: true,
      });
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  register,
  login,
  sendTokenResponse // Export this for the 2FA controller
};