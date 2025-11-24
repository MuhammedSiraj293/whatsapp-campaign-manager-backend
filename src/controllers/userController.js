// backend/src/controllers/userController.js

const User = require('../models/User');

// @desc    Create a new user (by an admin)
// @route   POST /api/users
const createUser = async (req, res) => {
    const { name, email, password, role } = req.body;

    try {
        const userExists = await User.findOne({ email });

        if (userExists) {
            return res.status(400).json({ success: false, error: 'User already exists' });
        }

        const user = await User.create({
            name,
            email,
            password,
            role,
        });

        res.status(201).json({ success: true, data: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        }});
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

// @desc    Get all users (by an admin)
// @route   GET /api/users
const getUsers = async (req, res) => {
    try {
        const users = await User.find({});
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

// @desc    Delete a user (by an admin)
// @route   DELETE /api/users/:id
const deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (user) {
            // Prevent admin from deleting themselves
            if (req.user.id === user.id) {
                return res.status(400).json({ success: false, error: 'Admins cannot delete themselves.' });
            }
            await user.deleteOne();
            res.status(200).json({ success: true, message: 'User removed' });
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

module.exports = {
    createUser,
    getUsers,
    deleteUser,
};