const db = require('../db');

// Get all products
const getAllProducts = (callback) => {
    const sql = 'SELECT * FROM products';
    db.query(sql, callback);
};

// Get one product by ID
const getProductById = (id, callback) => {
    const sql = 'SELECT * FROM products WHERE id = ?';
    db.query(sql, [id], callback);
};

// Add new product (falls back if category column is missing)
const addProduct = (name, quantity, price, image, category, callback) => {
    const sqlWithCategory = 'INSERT INTO products (productName, quantity, price, image, category) VALUES (?, ?, ?, ?, ?)';
    db.query(sqlWithCategory, [name, quantity, price, image, category], (err, result) => {
        if (err && err.code === 'ER_BAD_FIELD_ERROR') {
            const sqlFallback = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
            return db.query(sqlFallback, [name, quantity, price, image], callback);
        }
        return callback(err, result);
    });
};

// Update product
const updateProduct = (id, name, quantity, price, image, category, callback) => {
    const sqlWithCategory = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ?, category = ? WHERE id = ?';
    db.query(sqlWithCategory, [name, quantity, price, image, category, id], (err, result) => {
        if (err && err.code === 'ER_BAD_FIELD_ERROR') {
            const sqlFallback = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ? WHERE id = ?';
            return db.query(sqlFallback, [name, quantity, price, image, id], callback);
        }
        return callback(err, result);
    });
};

// Delete product
const deleteProduct = (id, callback) => {
    const sql = 'DELETE FROM products WHERE id = ?';
    db.query(sql, [id], callback);
};

// Update only product quantity
const updateProductQuantity = (id, quantity, callback) => {
    const sql = 'UPDATE products SET quantity = ? WHERE id = ?';
    db.query(sql, [quantity, id], callback);
};

// Decrease stock after purchase (guard against negative stock)
const decreaseStock = (id, qty, callback) => {
    const sql = 'UPDATE products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?';
    db.query(sql, [qty, id, qty], callback);
};

module.exports = {
    getAllProducts,
    getProductById,
    addProduct,
    updateProduct,
    deleteProduct,
    updateProductQuantity,
    decreaseStock
};
