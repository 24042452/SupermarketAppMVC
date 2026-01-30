const OrderModel = require('../models/orderModel');
const ProductModel = require('../models/productModel');
const CartModel = require('../models/cartModel');
const { normalizeCartItems, calculateTotals, validateStock, createOrderFromCart } = require('../services/orderHelpers');
const RefundModel = require('../models/refundModel');

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

        if (available <= 0) {
            req.flash('error', `${product.productName} is out of stock right now.`);
            return res.redirect('/cart');
        }

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

        // Persist cart for logged-in users
        if (req.session.user) {
            CartModel.upsertCartItem(req.session.user.id, productId, existingItem ? existingItem.quantity : qtyToAdd, (errSave) => {
                if (errSave) console.error('Error saving cart item:', errSave);
                return res.redirect('/cart');
            });
        } else {
            res.redirect('/cart');
        }

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

            if (req.session.user) {
                CartModel.deleteCartItem(req.session.user.id, productId, (errDel) => {
                    if (errDel) console.error('Error deleting cart item:', errDel);
                    return res.redirect('/cart');
                });
            } else {
                return res.redirect('/cart');
            }
        }

        if (product.quantity < newQty) {
            item.quantity = product.quantity;
            req.flash('error', `Only ${product.quantity} left for ${product.productName}. Quantity adjusted.`);
        } else {
            item.quantity = newQty;
            req.flash('success', 'Cart updated.');
        }

        if (req.session.user) {
            if (product.quantity < newQty) {
                CartModel.upsertCartItem(req.session.user.id, productId, product.quantity, (errSave) => {
                    if (errSave) console.error('Error saving cart item:', errSave);
                    return res.redirect('/cart');
                });
            } else if (newQty <= 0) {
                CartModel.deleteCartItem(req.session.user.id, productId, (errDel) => {
                    if (errDel) console.error('Error deleting cart item:', errDel);
                    return res.redirect('/cart');
                });
            } else {
                CartModel.upsertCartItem(req.session.user.id, productId, newQty, (errSave) => {
                    if (errSave) console.error('Error saving cart item:', errSave);
                    return res.redirect('/cart');
                });
            }
        } else {
            res.redirect('/cart');
        }
    });
};

// Show checkout page (GET)
const showCheckout = (req, res) => {
    const user = req.session.user;
    const cart = req.session.cart || [];

    if (!user) return res.redirect('/login');
    if (!cart.length) return res.redirect('/cart');

    const items = normalizeCartItems(cart);
    const totals = calculateTotals(items);

    validateStock(
        items,
        () => {
            res.render('checkout', {
                user: user,
                cart: cart,
                total: totals.total,
                subtotal: totals.subtotal,
                shippingFee: totals.shippingFee,
                paypalClientId: process.env.PAYPAL_CLIENT_ID || ''
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
    const paymentMethod = req.body && req.body.paymentMethod ? req.body.paymentMethod : '';
    const isPaypal = paymentMethod === 'PayPal';
    const normalizedItems = normalizeCartItems(cart || []);
    const totals = calculateTotals(normalizedItems);
    const paymentProvider = paymentMethod ? paymentMethod.toLowerCase() : '';

    if (!user) return res.redirect('/login');
    if (!cart || cart.length === 0) return res.redirect('/cart');
    if (req.body && req.body.paymentMethod === 'NETSQR') {
        return res.redirect('/nets-qr/pay');
    }
    if (req.body && req.body.paymentMethod === 'Stripe') {
        req.flash('error', 'Please complete Stripe Checkout to place your order.');
        return res.redirect('/checkout');
    }

    createOrderFromCart(
        user,
        cart,
        (orderId) => {
            req.session.cart = [];
            // Clear persisted cart for this user
            CartModel.clearCart(user.id, (errClear) => {
                if (errClear) console.error('Error clearing saved cart:', errClear);
                const paypalPayment = req.session.paypalPayment;
                if (paypalPayment && paypalPayment.captureId) {
                    OrderModel.updatePaymentInfo(orderId, {
                        provider: 'paypal',
                        paymentId: paypalPayment.captureId,
                        amount: paypalPayment.amount || null
                    }, (errPay) => {
                        if (errPay) console.error('Error saving PayPal payment info:', errPay);
                        req.session.paypalPayment = null;
                        req.flash('success', 'Order placed successfully.');
                        if (isPaypal) {
                            return res.redirect(`/paypal/success?orderId=${orderId}`);
                        }
                        return res.redirect(`/orders/${orderId}/invoice`);
                    });
                    return;
                }
                const finalizeRedirect = () => {
                    req.flash('success', 'Order placed successfully.');
                    if (isPaypal) {
                        return res.redirect(`/paypal/success?orderId=${orderId}`);
                    }
                    return res.redirect(`/orders/${orderId}/invoice`);
                };

                if (paymentProvider && paymentProvider !== 'paypal' && paymentProvider !== 'stripe') {
                    OrderModel.updatePaymentInfo(orderId, {
                        provider: paymentProvider,
                        paymentId: null,
                        amount: totals.total
                    }, (errPay) => {
                        if (errPay) console.error('Error saving payment method:', errPay);
                        return finalizeRedirect();
                    });
                    return;
                }

                return finalizeRedirect();
            });
        },
        (item, available) => {
            req.flash('error', `Not enough stock for ${item.productName || 'item'} (available: ${available}).`);
            res.redirect('/cart');
        },
        (err) => {
            console.error('Error processing order:', err);
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
                const normalizedItems = (items || []).map(item => ({
                    productId: item.productId || item.product_id,
                    productName: item.productName,
                    price: Number(item.price_each || item.price) || 0,
                    quantity: Number(item.quantity) || 0,
                    image: item.image
                }));
                const totals = calculateTotals(normalizedItems);
                orders[i].subtotal = totals.subtotal;
                orders[i].shippingFee = totals.shippingFee;
                orders[i].grandTotal = totals.total;

                RefundModel.getByOrderId(orderId, (refundErr, refunds) => {
                    if (refundErr) console.error('Error loading refund requests:', refundErr);
                    const latestRefund = refunds && refunds.length ? refunds[0] : null;
                    orders[i].refundRequest = latestRefund;
                    i++;
                    loadNext();
                });
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
            payment_provider: rows[0].payment_provider,
            payment_id: rows[0].payment_id,
            refund_status: rows[0].refund_status,
            refunded_amount: rows[0].refunded_amount,
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

        const normalizedItems = order.items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            price: Number(item.price) || 0,
            quantity: Number(item.quantity) || 0,
            image: item.image
        }));
        const totals = calculateTotals(normalizedItems);
        order.subtotal = totals.subtotal;
        order.shippingFee = totals.shippingFee;
        order.grandTotal = totals.total;

        RefundModel.getByOrderId(orderId, (refundErr, refunds) => {
            if (refundErr) console.error('Error loading refund requests:', refundErr);
            const latestRefund = refunds && refunds.length ? refunds[0] : null;
            res.render('orderDetails', {
                order: order,
                user: user,
                cart: req.session.cart || [],
                refundRequest: latestRefund
            });
        });
    });
};

// On-screen invoice for a single order
const showInvoice = (req, res) => {
    const orderId = req.params.id;
    const user = req.session.user;

    if (!user) return res.redirect('/login');

    const fallback = user && (user.role === 'admin' || user.role === 'superadmin') ? '/admin/orders' : '/orders';

    OrderModel.getOrderDetails(orderId, (err, rows) => {
        if (err) throw err;

        if (!rows || rows.length === 0) {
            req.flash('error', 'Invoice not found.');
            return res.redirect(fallback);
        }

        // Optional ownership check: ensure the order belongs to this user (skip for admin)
        if (rows[0].userId && user.role !== 'admin' && rows[0].userId !== user.id) {
            req.flash('error', 'You cannot view this invoice.');
            return res.redirect(fallback);
        }

        const order = {
            id: rows[0].orderId,
            total: rows[0].total,
            order_date: rows[0].order_date,
            status: rows[0].status,
            payment_provider: rows[0].payment_provider,
            payment_id: rows[0].payment_id,
            refund_status: rows[0].refund_status,
            refunded_amount: rows[0].refunded_amount,
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

        const normalizedItems = order.items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            price: Number(item.price) || 0,
            quantity: Number(item.quantity) || 0,
            image: item.image
        }));
        const totals = calculateTotals(normalizedItems);
        order.subtotal = totals.subtotal;
        order.shippingFee = totals.shippingFee;
        order.grandTotal = totals.total;

        RefundModel.getByOrderId(orderId, (refundErr, refunds) => {
            if (refundErr) console.error('Error loading refund requests:', refundErr);
            const latestRefund = refunds && refunds.length ? refunds[0] : null;
            res.render('invoice', {
                order,
                user,
                cart: req.session.cart || [],
                refundRequest: latestRefund
            });
        });
    });
};

// Remove a single item from cart (and persisted cart if logged in)
const removeCartItem = (req, res) => {
    const productId = parseInt(req.params.id, 10);
    if (req.session.cart) {
        req.session.cart = req.session.cart.filter(item => (item.id || item.productId) != productId);
    }

    if (req.session.user) {
        CartModel.deleteCartItem(req.session.user.id, productId, (errDel) => {
            if (errDel) console.error('Error deleting cart item:', errDel);
            return res.redirect('/cart');
        });
    } else {
        res.redirect('/cart');
    }
};

// Clear cart (session + persisted)
const clearCart = (req, res) => {
    req.session.cart = [];

    if (req.session.user) {
        CartModel.clearCart(req.session.user.id, (errClear) => {
            if (errClear) console.error('Error clearing saved cart:', errClear);
            return res.redirect('/cart');
        });
    } else {
        res.redirect('/cart');
    }
};

const requestRefund = (req, res) => {
    const user = req.session.user;
    const orderId = req.params.id;
    let amount = 0;

    if (!user) return res.redirect('/login');
    if (!orderId) return res.redirect('/orders');
    OrderModel.getOrderDetails(orderId, (err, rows) => {
        if (err || !rows || rows.length === 0) {
            req.flash('error', 'Order not found.');
            return res.redirect('/orders');
        }

        if (rows[0].userId !== user.id) {
            req.flash('error', 'You cannot refund this order.');
            return res.redirect('/orders');
        }

        const orderTotal = Number(rows[0].total || 0);
        amount = orderTotal;
        if (!amount || amount <= 0) {
            req.flash('error', 'Refund amount must be greater than 0.');
            return res.redirect(`/orders/${orderId}`);
        }

        const paymentProvider = rows[0].payment_provider || null;
        const paymentId = rows[0].payment_id || null;
        if (!paymentProvider || !paymentId) {
            req.flash('error', 'This order cannot be refunded (missing payment info).');
            return res.redirect(`/orders/${orderId}`);
        }

        RefundModel.getByOrderId(orderId, (refundErr, refunds) => {
            if (refundErr) console.error('Error checking existing refunds:', refundErr);
            const existingPending = refunds && refunds.find(r => r.status === 'pending');
            if (existingPending) {
                req.flash('error', 'A refund request is already pending for this order.');
                return res.redirect(`/orders/${orderId}`);
            }

            RefundModel.createRequest({
                orderId: Number(orderId),
                userId: user.id,
                provider: paymentProvider,
                paymentId,
                amount
            }, (errCreate) => {
                if (errCreate) {
                    console.error('Error creating refund request:', errCreate);
                    req.flash('error', 'Failed to submit refund request.');
                    return res.redirect(`/orders/${orderId}`);
                }

                req.flash('success', 'Refund request submitted.');
                return res.redirect(`/orders/${orderId}`);
            });
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
    showInvoice,
    removeCartItem,
    clearCart,
    requestRefund
};







