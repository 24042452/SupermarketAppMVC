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

// Get all items in one order
const getOrderItems = (orderId, callback) => {
    const sql = `
        SELECT 
            oi.quantity,
            oi.price_each,
            p.productName,
            p.image
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
    `;
    db.query(sql, [orderId], callback);
};

// Get full order info (header + items)
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

// Admin: Get all orders with user info
const getAllOrders = (callback) => {
    const sql = `SELECT o.*, u.username, u.email 
                 FROM orders o
                 JOIN users u ON o.user_id = u.id
                 ORDER BY o.order_date DESC`;
    db.query(sql, callback);
};

// Update order status
const updateOrderStatus = (orderId, status, callback) => {
    const sql = 'UPDATE orders SET status = ? WHERE id = ?';
    db.query(sql, [status, orderId], callback);
};

module.exports = {
    createOrder,
    addOrderItem,
    getOrdersByUser,
    getOrderItems,   
    getOrderDetails,
    getAllOrders,
    updateOrderStatus
};
