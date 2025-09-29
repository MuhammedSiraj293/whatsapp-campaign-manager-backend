// backend/src/controllers/authController.js

const User = require('../models/User');
const jwt = require('jsonwebtoken');

// This function remains the same
const sendTokenResponse = (user, statusCode, res) => {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
  res.status(statusCode).json({ 
    success: true, 
    token,
    user: { name: user.name, role: user.role }
  });
};

// --- THIS FUNCTION IS UPGRADED ---
// @desc    Register a new user (publicly or by an admin)
// @route   POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Check if a user with this email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return res.status(400).json({ success: false, error: 'A user with this email already exists.' });
    }

    const newUser = { name, email, password };

    // --- NEW LOGIC ---
    // If the request is made by an admin, they can set the role.
    // The `req.user` object is only present if the user is logged in (from our 'protect' middleware).
    if (req.user && req.user.role === 'admin') {
      if (role && ['admin', 'manager', 'viewer'].includes(role)) {
        newUser.role = role;
      } else {
        newUser.role = 'viewer'; // Default for admin creation
      }
    } else {
      // Public registration: always defaults to 'viewer'
      newUser.role = 'viewer';
    }

    const user = await User.create(newUser);

    // We don't send a token for admin creation to avoid confusion
    if (req.user && req.user.role === 'admin') {
        res.status(201).json({ success: true, message: 'User created successfully.' });
    } else {
        sendTokenResponse(user, 201, res);
    }
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Login a user
// @route   POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide an email and password' });
    }

    // Check for user, explicitly including the password field
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Check if password matches using the method we created in the model
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  register,
  login,
};