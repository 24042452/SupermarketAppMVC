const db = require('../db');

const ensurePaymentColumns = (callback) => {
    const statements = [
        'ALTER TABLE orders ADD COLUMN payment_provider VARCHAR(20) NULL',
        'ALTER TABLE orders ADD COLUMN payment_id VARCHAR(255) NULL',
        'ALTER TABLE orders ADD COLUMN payment_amount DECIMAL(10,2) NULL',
        'ALTER TABLE orders ADD COLUMN refund_status VARCHAR(20) NULL',
        'ALTER TABLE orders ADD COLUMN refunded_amount DECIMAL(10,2) NULL'
    ];

    let index = 0;
    const next = () => {
        if (index >= statements.length) return callback(null);
        db.query(statements[index], (err) => {
            if (err && err.code !== 'ER_DUP_FIELDNAME') return callback(err);
            index += 1;
            next();
        });
    };

    next();
};

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
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
    `;
    db.query(sql, [orderId], callback);
};

// Get full order info (header + items)
const getOrderDetails = (orderId, callback) => {
    const sql = `
        SELECT o.id AS orderId, o.user_id AS userId, o.total, o.order_date, o.status,
               o.payment_provider, o.payment_id, o.refund_status, o.refunded_amount,
               oi.product_id, oi.quantity, oi.price_each,
               p.productName, p.image
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.id = ?
    `;
    db.query(sql, [orderId], callback);
};

// Admin: Get all orders with user info
const getAllOrders = (callback) => {
    const sql = `SELECT o.*, u.username, u.email, u.address
                 FROM orders o
                 LEFT JOIN users u ON o.user_id = u.id
                 ORDER BY o.order_date DESC`;
    db.query(sql, callback);
};

// Update order status
const updateOrderStatus = (orderId, status, callback) => {
    const sql = 'UPDATE orders SET status = ? WHERE id = ?';
    db.query(sql, [status, orderId], callback);
};

const updatePaymentInfo = (orderId, payment, callback) => {
    const sql = `
        UPDATE orders
        SET payment_provider = ?, payment_id = ?, payment_amount = ?
        WHERE id = ?
    `;
    db.query(sql, [payment.provider, payment.paymentId, payment.amount, orderId], (err) => {
        if (err && err.code === 'ER_BAD_FIELD_ERROR') {
            return ensurePaymentColumns((alterErr) => {
                if (alterErr) return callback(alterErr);
                db.query(sql, [payment.provider, payment.paymentId, payment.amount, orderId], callback);
            });
        }
        callback(err);
    });
};

const updateRefundStatus = (orderId, refundStatus, refundedAmount, callback) => {
    const sql = `
        UPDATE orders
        SET refund_status = ?, refunded_amount = ?
        WHERE id = ?
    `;
    db.query(sql, [refundStatus, refundedAmount, orderId], (err) => {
        if (err && err.code === 'ER_BAD_FIELD_ERROR') {
            return ensurePaymentColumns((alterErr) => {
                if (alterErr) return callback(alterErr);
                db.query(sql, [refundStatus, refundedAmount, orderId], callback);
            });
        }
        callback(err);
    });
};

module.exports = {
    createOrder,
    addOrderItem,
    getOrdersByUser,
    getOrderItems,   
    getOrderDetails,
    getAllOrders,
    updateOrderStatus,
    updatePaymentInfo,
    updateRefundStatus
};
