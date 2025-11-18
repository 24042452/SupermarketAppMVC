const OrderModel = require('../models/orderModel');
const ProductModel = require('../models/productModel');

// Checkout: Convert cart session into real order
const checkout = (req, res) => {
    const cart = req.session.cart;
    const user = req.session.user;

    if (!user || !cart || cart.length === 0) {
        return res.redirect('/shopping');
    }

    let total = 0;

    for (let i = 0; i < cart.length; i++) {
        const line = cart[i];
        total = total + (line.price * line.quantity);
    }

    OrderModel.createOrder(user.id, total, (err, result) => {
        if (err) throw err;

        const orderId = result.insertId;

        let index = 0;

        function insertNext() {
            if (index === cart.length) {
                req.session.cart = [];
                return res.redirect('/orders');
            }

            const item = cart[index];

            OrderModel.addOrderItem(
                orderId,
                item.productId,
                item.quantity,
                item.price,
                (err2) => {
                    if (err2) throw err2;

                    index = index + 1;
                    insertNext();
                }
            );
        }

        insertNext();
    });
};

// Show all orders for logged-in user
const showOrders = (req, res) => {
    const user = req.session.user;
    if (!user) return res.redirect('/login');

    OrderModel.getOrdersByUser(user.id, (err, results) => {
        if (err) throw err;

        res.render('orderHistory', {
            orders: results,
            user: user
        });
    });
};

// Show single order with all item details
const showOrderDetails = (req, res) => {
    const orderId = req.params.id;
    const user = req.session.user;

    OrderModel.getOrderDetails(orderId, (err, results) => {
        if (err) throw err;

        res.render('orderDetails', {
            order: results,
            user: user
        });
    });
};

// View cart page
const viewCart = (req, res) => {
    const cart = req.session.cart || [];
    const user = req.session.user || null;

    res.render('cart', {
        cart: cart,
        total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
        user: user
    });
};

// Add product to cart
const addToCart = (req, res) => {
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;
    const user = req.session.user;

    if (!req.session.cart) {
        req.session.cart = [];
    }

    const cart = req.session.cart;

    const ProductModel = require('../models/productModel');

    ProductModel.getProductById(productId, (err, results) => {
        if (err) throw err;

        if (!results || results.length === 0) {
            return res.redirect('/shopping');
        }

        const product = results[0];

        // Check if item already exists in cart
        const existingItem = cart.find(item => item.productId === productId);

        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            cart.push({
                productId: product.id,
                productName: product.productName,
                price: product.price,
                quantity: quantity
            });
        }

        res.redirect('/shopping'); // redirect back to shopping page
    });
};

module.exports = {
    checkout,
    showOrders,
    showOrderDetails,
    viewCart,
    addToCart
};
