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

// Add new product
const addProduct = (name, quantity, price, image, callback) => {
    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    db.query(sql, [name, quantity, price, image], callback);
};

// Update product
const updateProduct = (id, name, quantity, price, image, callback) => {
    const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ? WHERE id = ?';
    db.query(sql, [name, quantity, price, image, id], callback);
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
