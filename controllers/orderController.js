const OrderModel = require('../models/orderModel');
const ProductModel = require('../models/productModel');

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

    if (!req.session.cart) req.session.cart = [];
    const cart = req.session.cart;

    ProductModel.getProductById(productId, (err, results) => {
        if (err) throw err;
        if (!results || results.length === 0) return res.redirect('/');

        const product = results[0];
        const existingItem = cart.find(item => item.productId === productId);

        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            cart.push({
                productId: product.id,
                productName: product.productName,
                price: product.price,
                quantity: quantity,
                image: product.image
            });
        }

        res.redirect('/');
    });
};

// Show checkout page (GET)
const showCheckout = (req, res) => {
    const user = req.session.user;
    const cart = req.session.cart || [];

    if (!user) return res.redirect('/login');
    if (!cart.length) return res.redirect('/cart');

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    res.render('checkout', {
        user: user,
        cart: cart,
        total: total
    });
};

// Process checkout (POST)
const processCheckout = (req, res) => {
    const cart = req.session.cart;
    const user = req.session.user;

    if (!user) return res.redirect('/login');
    if (!cart || cart.length === 0) return res.redirect('/cart');

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

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
            const productId = item.id || item.productId;

            OrderModel.addOrderItem(orderId, productId, item.quantity, item.price, (err2) => {
                if (err2) throw err2;
                index++;
                insertNext();
            });
        }

        insertNext();
    });
};

// View all orders for logged-in user
const showOrders = (req, res) => {
    const user = req.session.user;

    if (!user) return res.redirect('/login');

    OrderModel.getOrdersByUser(user.id, (err, orders) => {
        if (err) throw err;

        let i = 0;

        function loadNext() {
            if (i === orders.length) {
                return res.render('orderHistory', {
                    orders: orders,
                    user: user,
                    cart: req.session.cart || []
                });
            }

            const orderId = orders[i].id;

            OrderModel.getOrderItems(orderId, (err2, items) => {
                if (err2) throw err2;

                // Attach items to the order
                orders[i].items = items || [];

                i++;
                loadNext();
            });
        }

        loadNext();
    });
};


// View single order details
const showOrderDetails = (req, res) => {
    const orderId = req.params.id;
    const user = req.session.user;

    OrderModel.getOrderDetails(orderId, (err, rows) => {
        if (err) throw err;

        if (!rows || rows.length === 0) {
            return res.redirect('/orders');
        }

        const order = {
            id: rows[0].orderId,
            total: rows[0].total,
            order_date: rows[0].order_date,
            status: rows[0].status,
            items: []
        };

        let i = 0;

        while (i < rows.length) {
            order.items.push({
                productId: rows[i].product_id,
                productName: rows[i].productName,
                quantity: rows[i].quantity,
                price: rows[i].price_each,
                image: rows[i].image
            });
            i++;
        }

        res.render('orderDetails', {
            order: order,
            user: user,
            cart: req.session.cart || []
        });
    });
};

module.exports = {
    viewCart,
    addToCart,
    showCheckout,
    processCheckout,
    showOrders,
    showOrderDetails
};
