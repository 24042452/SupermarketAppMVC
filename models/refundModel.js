const db = require('../db');

const ensureTable = (callback) => {
    const sql = `
        CREATE TABLE IF NOT EXISTS refund_requests (
            id INT NOT NULL AUTO_INCREMENT,
            order_id INT NOT NULL,
            user_id INT NOT NULL,
            provider VARCHAR(20) NOT NULL,
            payment_id VARCHAR(255),
            amount DECIMAL(10,2) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            admin_id INT NULL,
            admin_note TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_refund_order (order_id),
            KEY idx_refund_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `;
    db.query(sql, callback);
};

const createRequest = (data, callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        const sql = `
            INSERT INTO refund_requests (order_id, user_id, provider, payment_id, amount, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `;
        db.query(sql, [data.orderId, data.userId, data.provider, data.paymentId, data.amount], callback);
    });
};

const getByOrderId = (orderId, callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        db.query('SELECT * FROM refund_requests WHERE order_id = ? ORDER BY created_at DESC', [orderId], callback);
    });
};

const getAll = (callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        const sql = `
            SELECT rr.*, u.username, u.email, o.total AS order_total
            FROM refund_requests rr
            LEFT JOIN users u ON rr.user_id = u.id
            LEFT JOIN orders o ON rr.order_id = o.id
            ORDER BY rr.created_at DESC
        `;
        db.query(sql, callback);
    });
};

const getById = (id, callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        db.query('SELECT * FROM refund_requests WHERE id = ? LIMIT 1', [id], callback);
    });
};

const updateStatus = (id, status, adminId, adminNote, amount, callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        const sql = `
            UPDATE refund_requests
            SET status = ?, admin_id = ?, admin_note = ?, amount = ?
            WHERE id = ?
        `;
        db.query(sql, [status, adminId || null, adminNote || null, amount, id], callback);
    });
};

module.exports = {
    createRequest,
    getByOrderId,
    getAll,
    updateStatus,
    getById
};
