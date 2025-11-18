const db = require('../db');

// Create a new order
const createOrder = (userId, total, callback) => {
    const sql = "INSERT INTO orders (user_id, total) VALUES (?, ?)";
    db.query(sql, [userId, total], callback);
};

// Insert items into order_items table
const addOrderItem = (orderId, productId, quantity, priceEach, callback) => {
    const sql = "INSERT INTO order_items (order_id, product_id, quantity, price_each) VALUES (?, ?, ?, ?)";
    db.query(sql, [orderId, productId, quantity, priceEach], callback);
};

// Get all orders of one user
const getOrdersByUser = (userId, callback) => {
    const sql = "SELECT * FROM orders WHERE user_id = ? ORDER BY order_date DESC";
    db.query(sql, [userId], callback);
};

// Get full order (header + items)
const getOrderDetails = (orderId, callback) => {
    const sql = `
        SELECT o.id AS orderId, o.total, o.order_date, o.status,
               oi.product_id, oi.quantity, oi.price_each,
               p.productName, p.image
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN products p ON oi.product_id = p.id
        WHERE o.id = ?
    `;
    db.query(sql, [orderId], callback);
};

module.exports = {
    createOrder,
    addOrderItem,
    getOrdersByUser,
    getOrderDetails
};
