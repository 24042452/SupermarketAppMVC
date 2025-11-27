const db = require('../db');

// Fetch cart items for a user with product details
const getCartItemsWithProduct = (userId, callback) => {
    const sql = `
        SELECT ci.product_id AS productId,
               ci.quantity,
               p.productName,
               p.price,
               p.image
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        WHERE ci.user_id = ? AND COALESCE(p.is_deleted, 0) = 0
    `;
    db.query(sql, [userId], (err, rows) => {
        if (err && err.code === 'ER_BAD_FIELD_ERROR') {
            return db.query(`
                SELECT ci.product_id AS productId,
                       ci.quantity,
                       p.productName,
                       p.price,
                       p.image
                FROM cart_items ci
                JOIN products p ON ci.product_id = p.id
                WHERE ci.user_id = ?
            `, [userId], callback);
        }
        callback(err, rows);
    });
};

// Upsert a cart item quantity
const upsertCartItem = (userId, productId, quantity, callback) => {
    const sql = `
        INSERT INTO cart_items (user_id, product_id, quantity)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
    `;
    db.query(sql, [userId, productId, quantity], callback);
};

// Remove single item
const deleteCartItem = (userId, productId, callback) => {
    const sql = 'DELETE FROM cart_items WHERE user_id = ? AND product_id = ?';
    db.query(sql, [userId, productId], callback);
};

// Clear all items
const clearCart = (userId, callback) => {
    const sql = 'DELETE FROM cart_items WHERE user_id = ?';
    db.query(sql, [userId], callback);
};

module.exports = {
    getCartItemsWithProduct,
    upsertCartItem,
    deleteCartItem,
    clearCart
};
