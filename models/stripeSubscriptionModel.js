const db = require('../db');

const ensureTable = (callback) => {
    const sql = `
        CREATE TABLE IF NOT EXISTS stripe_subscriptions (
            id INT NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            stripe_subscription_id VARCHAR(255) NOT NULL,
            stripe_customer_id VARCHAR(255),
            last_invoice_id VARCHAR(255),
            status VARCHAR(30) DEFAULT 'active',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_stripe_subscription (stripe_subscription_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `;
    db.query(sql, callback);
};

const upsertSubscription = (data, callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        const sql = `
            INSERT INTO stripe_subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                stripe_customer_id = VALUES(stripe_customer_id),
                status = VALUES(status)
        `;
        db.query(sql, [data.userId, data.subscriptionId, data.customerId || null, data.status || 'active'], callback);
    });
};

const getBySubscriptionId = (subscriptionId, callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        const sql = 'SELECT * FROM stripe_subscriptions WHERE stripe_subscription_id = ? LIMIT 1';
        db.query(sql, [subscriptionId], callback);
    });
};

const updateLastInvoice = (subscriptionId, invoiceId, status, callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        const sql = 'UPDATE stripe_subscriptions SET last_invoice_id = ?, status = ? WHERE stripe_subscription_id = ?';
        db.query(sql, [invoiceId, status || 'active', subscriptionId], callback);
    });
};

const updateStatus = (subscriptionId, status, callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        const sql = 'UPDATE stripe_subscriptions SET status = ? WHERE stripe_subscription_id = ?';
        db.query(sql, [status || 'active', subscriptionId], callback);
    });
};

const getByUserId = (userId, callback) => {
    ensureTable((err) => {
        if (err) return callback(err);
        const sql = 'SELECT * FROM stripe_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1';
        db.query(sql, [userId], callback);
    });
};

module.exports = {
    upsertSubscription,
    getBySubscriptionId,
    updateLastInvoice,
    updateStatus,
    getByUserId
};
