const db = require('../db');

// Get all users
const getAllUsers = (callback) => {
    const sql = 'SELECT * FROM users';
    db.query(sql, callback);
};

// Get one user by ID
const getUserById = (userId, callback) => {
    const sql = 'SELECT * FROM users WHERE id = ?';
    db.query(sql, [userId], callback);
};

// Add new user
const addUser = (username, email, password, address, contact, role, callback) => {
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(sql, [username, email, password, address, contact, role], callback);
};

// Update user
const updateUser = (userId, username, email, password, address, contact, role, callback) => {
    const sql = 'UPDATE users SET username = ?, email = ?, password = ?, address = ?, contact = ?, role = ? WHERE id = ?';
    db.query(sql, [username, email, password, address, contact, role, userId], callback);
};

// Anonymize user but keep record and original details for order history
const anonymizeUser = (userId, originalUser, callback) => {
    const safeUser = originalUser || {};
    const username = safeUser.username ? `${safeUser.username} (deleted)` : `Deleted User #${userId}`;
    const email = safeUser.email || `deleted_user_${userId}@example.com`;
    const address = safeUser.address || '';
    const contact = safeUser.contact || '';
    const sql = `
        UPDATE users
        SET username = ?, email = ?, password = ?, address = ?, contact = ?, role = ?
        WHERE id = ?`;
    db.query(sql, [
        username,
        email,
        '__deleted__',
        address,
        contact,
        'deleted',
        userId
    ], callback);
};

// Delete user
const deleteUser = (userId, callback) => {
    const sql = 'DELETE FROM users WHERE id = ?';
    db.query(sql, [userId], callback);
};

module.exports = {
    getAllUsers,
    getUserById,
    addUser,
    updateUser,
    deleteUser,
    anonymizeUser,
};
