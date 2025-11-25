const OrderModel = require('../models/orderModel');
const ProductModel = require('../models/productModel');

const normalizeCartItems = (cart = []) => cart.map(item => ({
    productId: item.productId || item.id,
    productName: item.productName,
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 0,
    image: item.image
}));

const validateStock = (items, onSuccess, onInsufficient, onError) => {
    let index = 0;

    const next = () => {
        if (index >= items.length) return onSuccess();

        const current = items[index];
        ProductModel.getProductById(current.productId, (err, results) => {
            if (err) return onError(err);
            const product = results && results[0];

            if (!product || product.quantity < current.quantity) {
                return onInsufficient(current, product ? product.quantity : 0);
            }

            index += 1;
            next();
        });
    };

    next();
};

// View cart page
const viewCart = (req, res) => {
    const cart = req.session.cart || [];
    const user = req.session.user || null;

    res.render('cart', {
        cart: cart,
        total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
        user: user,
        messages: req.flash('error'),
        success: req.flash('success')
    });
};

// Add product to cart with stock check
const addToCart = (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const quantity = Math.max(parseInt(req.body.quantity, 10) || 1, 1);

    if (!req.session.cart) req.session.cart = [];
    const cart = req.session.cart;

    ProductModel.getProductById(productId, (err, results) => {
        if (err) {
            console.error('Error retrieving product for cart:', err);
            return res.status(500).send('Error adding to cart');
        }

        if (!results || results.length === 0) return res.redirect('/');

        const product = results[0];
        const existingItem = cart.find(item => (item.productId || item.id) === productId);
        const existingQty = existingItem ? existingItem.quantity : 0;
        const available = product.quantity;

        if (existingQty >= available) {
            req.flash('error', `Only ${available} left for ${product.productName}.`);
            return res.redirect('/cart');
        }

        const qtyToAdd = Math.min(quantity, available - existingQty);

        if (existingItem) {
            existingItem.quantity += qtyToAdd;
        } else {
            cart.push({
                id: product.id,
                productId: product.id,
                productName: product.productName,
                price: Number(product.price) || 0,
                quantity: qtyToAdd,
                image: product.image
            });
        }

        if (qtyToAdd < quantity) {
            req.flash('error', `Quantity adjusted to available stock (${available}) for ${product.productName}.`);
        } else {
            req.flash('success', 'Item added to cart.');
        }

        res.redirect('/cart');
    });
};

// Update cart quantity
const updateCartItem = (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const newQty = parseInt(req.body.quantity, 10);

    if (!req.session.cart) req.session.cart = [];
    const cart = req.session.cart;
    const item = cart.find(i => (i.productId || i.id) === productId);

    if (!item) return res.redirect('/cart');

    if (Number.isNaN(newQty) || newQty <= 0) {
        req.session.cart = cart.filter(i => (i.productId || i.id) !== productId);
        req.flash('success', 'Item removed from cart.');
        return res.redirect('/cart');
    }

    ProductModel.getProductById(productId, (err, results) => {
        if (err) {
            console.error('Error checking stock:', err);
            return res.status(500).send('Error updating cart');
        }

        const product = results && results[0];
        if (!product) return res.redirect('/cart');

        if (product.quantity <= 0) {
            req.session.cart = cart.filter(i => (i.productId || i.id) !== productId);
            req.flash('error', `${item.productName || 'Item'} is out of stock and was removed from your cart.`);
            return res.redirect('/cart');
        }

        if (product.quantity < newQty) {
            item.quantity = product.quantity;
            req.flash('error', `Only ${product.quantity} left for ${product.productName}. Quantity adjusted.`);
        } else {
            item.quantity = newQty;
            req.flash('success', 'Cart updated.');
        }

        res.redirect('/cart');
    });
};

// Show checkout page (GET)
const showCheckout = (req, res) => {
    const user = req.session.user;
    const cart = req.session.cart || [];

    if (!user) return res.redirect('/login');
    if (!cart.length) return res.redirect('/cart');

    const items = normalizeCartItems(cart);
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    validateStock(
        items,
        () => {
            res.render('checkout', {
                user: user,
                cart: cart,
                total: total
            });
        },
        (item, available) => {
            req.flash('error', `Not enough stock for ${item.productName || 'item'} (available: ${available}).`);
            res.redirect('/cart');
        },
        (err) => {
            console.error('Error validating stock:', err);
            res.status(500).send('Error loading checkout');
        }
    );
};

// Process checkout (POST)
const processCheckout = (req, res) => {
    const cart = req.session.cart;
    const user = req.session.user;

    if (!user) return res.redirect('/login');
    if (!cart || cart.length === 0) return res.redirect('/cart');

    const items = normalizeCartItems(cart);
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    validateStock(
        items,
        () => {
            OrderModel.createOrder(user.id, total, (err, result) => {
                if (err) {
                    console.error('Error creating order:', err);
                    return res.status(500).send('Error creating order');
                }

                const orderId = result.insertId;

                const saveItem = (index) => {
                    if (index === items.length) {
                        req.session.cart = [];
                        req.flash('success', 'Order placed successfully.');
                        return res.redirect(`/orders/${orderId}/invoice`);
                    }

                    const item = items[index];

                    OrderModel.addOrderItem(orderId, item.productId, item.quantity, item.price, (err2) => {
                        if (err2) {
                            console.error('Error adding order item:', err2);
                            return res.status(500).send('Error saving order items');
                        }

                        ProductModel.decreaseStock(item.productId, item.quantity, (err3, result3) => {
                            if (err3) {
                                console.error('Error updating stock:', err3);
                                return res.status(500).send('Error updating stock');
                            }

                            if (result3 && result3.affectedRows === 0) {
                                req.flash('error', `Stock changed for ${item.productName}. Please try again.`);
                                return res.redirect('/cart');
                            }

                            saveItem(index + 1);
                        });
                    });
                };

                saveItem(0);
            });
        },
        (item, available) => {
            req.flash('error', `Not enough stock for ${item.productName || 'item'} (available: ${available}).`);
            res.redirect('/cart');
        },
        (err) => {
            console.error('Error validating stock:', err);
            res.status(500).send('Error processing order');
        }
    );
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
                    cart: req.session.cart || [],
                    messages: req.flash('error'),
                    success: req.flash('success')
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

// On-screen invoice for a single order
const showInvoice = (req, res) => {
    const orderId = req.params.id;
    const user = req.session.user;

    if (!user) return res.redirect('/login');

    OrderModel.getOrderDetails(orderId, (err, rows) => {
        if (err) throw err;

        if (!rows || rows.length === 0) {
            req.flash('error', 'Invoice not found.');
            return res.redirect('/orders');
        }

        // Optional ownership check: ensure the order belongs to this user (skip for admin)
        if (rows[0].userId && user.role !== 'admin' && rows[0].userId !== user.id) {
            req.flash('error', 'You cannot view this invoice.');
            return res.redirect('/orders');
        }

        const order = {
            id: rows[0].orderId,
            total: rows[0].total,
            order_date: rows[0].order_date,
            status: rows[0].status,
            items: []
        };

        rows.forEach((row) => {
            order.items.push({
                productId: row.product_id,
                productName: row.productName,
                quantity: row.quantity,
                price: row.price_each,
                image: row.image
            });
        });

        res.render('invoice', {
            order,
            user,
            cart: req.session.cart || []
        });
    });
};

module.exports = {
    viewCart,
    addToCart,
    updateCartItem,
    showCheckout,
    processCheckout,
    showOrders,
    showOrderDetails,
    showInvoice
};
