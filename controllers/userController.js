const UserModel = require('../models/userModel');

// Register user
const registerUser = (req, res) => {
    const { username, email, password, address, contact, role } = req.body;

    if (!username || !email || !password || !address || !contact || !role) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    UserModel.addUser(username, email, password, address, contact, role, (err) => {
        if (err) return res.status(500).send('Error registering user');
        req.flash('success', 'Registration successful! Please login.');
        res.redirect('/login');
    });
};

// Login user
const loginUser = (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    // Find user by email
    UserModel.getAllUsers((err, users) => {
        if (err) return res.status(500).send('Error logging in');

        const user = users.find(u => u.email === email && u.password === password);

        if (user) {
            req.session.user = user;
            if (user.role === 'admin') {
                res.redirect('/admin');
            } else {
                res.redirect('/');
            }
        } else {
            req.flash('error', 'Invalid email or password');
            res.redirect('/login');
        }
    });
};

module.exports = { registerUser, loginUser };
