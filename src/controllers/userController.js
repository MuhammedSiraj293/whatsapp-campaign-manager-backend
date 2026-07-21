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
        const users = await User.find({})
            .populate('assignedWabas', 'accountName')
            .populate('assignedContactLists', 'name');
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

// @desc    Update user details (role, assignedWabas, assignedContactLists)
// @route   PUT /api/users/:id
const updateUser = async (req, res) => {
    try {
        const { name, email, role, assignedWabas, assignedContactLists, password } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Prevent admin from changing their own role or unassigning themselves
        if (req.user.id === user.id && role && role !== 'admin') {
            return res.status(400).json({ success: false, error: 'Admins cannot change their own admin role.' });
        }

        if (name) user.name = name;
        if (email) user.email = email;
        if (role) user.role = role;
        if (assignedWabas !== undefined) user.assignedWabas = assignedWabas;
        if (assignedContactLists !== undefined) user.assignedContactLists = assignedContactLists;

        if (password) {
            user.password = password; // pre-save hook hashes this
        }

        await user.save();

        const updatedUser = await User.findById(user._id)
            .populate('assignedWabas', 'accountName')
            .populate('assignedContactLists', 'name');

        res.status(200).json({ success: true, data: updatedUser });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
    updateUser,
    deleteUser,
};