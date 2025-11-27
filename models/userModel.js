const db = require('../db');

// Get all users
const getAllUsers = (callback) => {
    // Hide anonymized/deleted users from general listings and login checks
    const sql = "SELECT * FROM users WHERE role <> 'deleted' OR role IS NULL";
    db.query(sql, (err, rows) => {
        if (err && err.code === 'ER_BAD_FIELD_ERROR') {
            // Fallback if role column is missing or SQL mode rejects double quotes
            return db.query('SELECT * FROM users', callback);
        }
        callback(err, rows);
    });
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
    // Generate unique placeholders so original email can be reused
    const uniqueSuffix = `${userId}_${Date.now()}`;
    const username = safeUser.username ? `${safeUser.username} (deleted)` : `Deleted User #${uniqueSuffix}`;
    const email = `deleted+${uniqueSuffix}@example.com`;
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
