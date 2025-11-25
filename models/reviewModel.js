const db = require('../db');

const getReviewsByProduct = (productId, callback) => {
    const sql = `
        SELECT r.*, u.username
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.product_id = ?
        ORDER BY r.created_at DESC
    `;
    db.query(sql, [productId], callback);
};

const addReview = (productId, userId, rating, comment, callback) => {
    const sql = `
        INSERT INTO reviews (product_id, user_id, rating, comment)
        VALUES (?, ?, ?, ?)
    `;
    db.query(sql, [productId, userId, rating, comment], callback);
};

const deleteReview = (id, callback) => {
    const sql = 'DELETE FROM reviews WHERE id = ?';
    db.query(sql, [id], callback);
};

const replyToReview = (id, reply, callback) => {
    const sql = 'UPDATE reviews SET reply = ? WHERE id = ?';
    db.query(sql, [reply, id], callback);
};

module.exports = {
    getReviewsByProduct,
    addReview,
    deleteReview,
    replyToReview
};
