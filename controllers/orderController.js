const OrderModel = require('../models/orderModel');
const ProductModel = require('../models/productModel');
const CartModel = require('../models/cartModel');
const PayPalService = require('../services/paypal');
const NetsService = require('../services/nets');
const Stripe = require('stripe');
const StripeSubscriptionModel = require('../models/stripeSubscriptionModel');
const RefundModel = require('../models/refundModel');

const getStripeClient = () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    return new Stripe(key);
};

const normalizeCartItems = (cart = []) => cart.map(item => ({
    productId: item.productId || item.id,
    productName: item.productName,
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 0,
    image: item.image
}));

const calculateTotals = (items) => {
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shippingThreshold = 50;
    const shippingFee = subtotal >= shippingThreshold ? 0 : 4.99;
    const total = subtotal + shippingFee;
    return {
        subtotal,
        shippingFee,
        total
    };
};

const createOrderFromCart = (user, cart, onSuccess, onInsufficient, onError) => {
    if (!user) return onError(new Error('Unauthorized'));
    if (!cart || cart.length === 0) return onError(new Error('Cart is empty'));

    const items = normalizeCartItems(cart);
    const totals = calculateTotals(items);

    validateStock(
        items,
        () => {
            OrderModel.createOrder(user.id, totals.total, (err, result) => {
                if (err) return onError(err);

                const orderId = result.insertId;

                const saveItem = (index) => {
                    if (index === items.length) {
                        return onSuccess(orderId);
                    }

                    const item = items[index];

                    OrderModel.addOrderItem(orderId, item.productId, item.quantity, item.price, (err2) => {
                        if (err2) return onError(err2);

                        ProductModel.decreaseStock(item.productId, item.quantity, (err3, result3) => {
                            if (err3) return onError(err3);

                            if (result3 && result3.affectedRows === 0) {
                                return onInsufficient(item, 0);
                            }

                            saveItem(index + 1);
                        });
                    });
                };

                saveItem(0);
            });
        },
        onInsufficient,
        onError
    );
};

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

const createPaypalOrder = async (req, res) => {
    const user = req.session.user;
    const cart = req.session.cart || [];

    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!cart.length) return res.status(400).json({ error: 'Cart is empty' });

    try {
        const items = normalizeCartItems(cart);
        const totals = calculateTotals(items);
        const amount = totals.total.toFixed(2);
        const order = await PayPalService.createOrder(amount);
        return res.json(order);
    } catch (err) {
        console.error('Error creating PayPal order:', err);
        return res.status(500).json({ error: 'Failed to create PayPal order' });
    }
};

const capturePaypalOrder = async (req, res) => {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

    try {
        const capture = await PayPalService.captureOrder(orderId);
        const captureId = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
        const amount = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value;
        if (captureId) {
            req.session.paypalPayment = {
                captureId,
                amount: Number(amount || 0) || null
            };
        }
        return res.json(capture);
    } catch (err) {
        console.error('Error capturing PayPal order:', err);
        return res.status(500).json({ error: 'Failed to capture PayPal order' });
    }
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

const confirmNetsPayment = async (req, res) => {
    const user = req.session.user;
    const cart = req.session.cart || [];
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!cart.length) return res.status(400).json({ error: 'Cart is empty' });

    const netsItems = normalizeCartItems(cart);
    const netsTotals = calculateTotals(netsItems);
    const sessionPayment = req.session.netsPayment || {};
    const txnRetrievalRef = req.body?.txnRetrievalRef || sessionPayment.txnRetrievalRef;
    const courseInitId = req.body?.courseInitId || sessionPayment.courseInitId;

    if (!txnRetrievalRef) return res.status(400).json({ error: 'Missing transaction reference' });
    if (sessionPayment.orderId) {
        return res.json({ status: 'success', invoiceUrl: `/orders/${sessionPayment.orderId}/invoice` });
    }

    try {
        const statusResult = await NetsService.fetchPaymentStatus({ txnRetrievalRef, courseInitId });

        if (statusResult.isFailure) {
            return res.json({
                status: 'failed',
                message: statusResult.status.message || 'Payment failed. Please try again.'
            });
        }

        if (!statusResult.isSuccess) {
            return res.json({ status: 'pending' });
        }

        createOrderFromCart(
            user,
            cart,
            (orderId) => {
                req.session.cart = [];
                CartModel.clearCart(user.id, (errClear) => {
                    if (errClear) console.error('Error clearing saved cart:', errClear);
                    req.session.netsPayment = {
                        ...sessionPayment,
                        txnRetrievalRef,
                        courseInitId,
                        orderId,
                        status: 'paid',
                        paidAt: Date.now()
                    };
                    OrderModel.updatePaymentInfo(orderId, {
                        provider: 'netsqr',
                        paymentId: txnRetrievalRef || null,
                        amount: netsTotals.total
                    }, (errPay) => {
                        if (errPay) console.error('Error saving NETS payment info:', errPay);
                        return res.json({ status: 'success', invoiceUrl: `/orders/${orderId}/invoice` });
                    });
                });
            },
            (item, available) => {
                return res.json({
                    status: 'failed',
                    message: `Not enough stock for ${item.productName || 'item'} (available: ${available}).`
                });
            },
            (err) => {
                console.error('Error creating order after NETS payment:', err);
                return res.status(500).json({ error: 'Failed to create order after payment' });
            }
        );
    } catch (err) {
        console.error('Error confirming NETS payment:', err);
        return res.status(500).json({ error: 'Failed to confirm NETS payment' });
    }
};

const createStripeCheckoutSession = async (req, res) => {
    const user = req.session.user;
    const cart = req.session.cart || [];

    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!cart.length) return res.status(400).json({ error: 'Cart is empty' });

    const stripe = getStripeClient();
    if (!stripe) return res.status(500).json({ error: 'Stripe is not configured' });

    try {
        const items = normalizeCartItems(cart);
        const totals = calculateTotals(items);
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        const lineItems = items.map((item) => ({
            price_data: {
                currency: 'sgd',
                product_data: { name: item.productName || 'Item' },
                unit_amount: Math.round(item.price * 100),
            },
            quantity: item.quantity
        }));

        if (totals.shippingFee > 0) {
            lineItems.push({
                price_data: {
                    currency: 'sgd',
                    product_data: { name: 'Delivery' },
                    unit_amount: Math.round(totals.shippingFee * 100),
                },
                quantity: 1
            });
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: lineItems,
            customer_email: user.email || undefined,
            success_url: `${baseUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/stripe/cancel`,
        });

        req.session.stripeCheckout = {
            sessionId: session.id,
            createdAt: Date.now()
        };

        return res.json({ url: session.url });
    } catch (err) {
        console.error('Error creating Stripe session:', err);
        return res.status(500).json({ error: 'Failed to create Stripe session' });
    }
};

const handleStripeSuccess = async (req, res) => {
    const user = req.session.user;
    const cart = req.session.cart || [];
    const sessionId = req.query.session_id;

    if (!user) return res.redirect('/login');
    if (!sessionId) return res.redirect('/checkout');

    const stripe = getStripeClient();
    if (!stripe) return res.redirect('/checkout');

    const existing = req.session.stripeCheckout;
    if (existing && existing.sessionId === sessionId && existing.orderId) {
        return res.render('stripeSuccess', {
            user,
            cart: req.session.cart || [],
            orderId: existing.orderId,
            invoiceUrl: `/orders/${existing.orderId}/invoice`
        });
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session || session.payment_status !== 'paid') {
            req.flash('error', 'Stripe payment not completed.');
            return res.redirect('/checkout');
        }

        if (!cart.length) {
            req.flash('error', 'Cart is empty.');
            return res.redirect('/checkout');
        }

        createOrderFromCart(
            user,
            cart,
            (orderId) => {
                req.session.cart = [];
                CartModel.clearCart(user.id, (errClear) => {
                    if (errClear) console.error('Error clearing saved cart:', errClear);
                    OrderModel.updatePaymentInfo(orderId, {
                        provider: 'stripe',
                        paymentId: session.payment_intent || session.id,
                        amount: session.amount_total ? session.amount_total / 100 : null
                    }, (errPay) => {
                        if (errPay) console.error('Error saving Stripe payment info:', errPay);
                    });
                    req.session.stripeCheckout = {
                        sessionId,
                        orderId,
                        status: 'paid',
                        paidAt: Date.now()
                    };
                    return res.render('stripeSuccess', {
                        user,
                        cart: req.session.cart || [],
                        orderId,
                        invoiceUrl: `/orders/${orderId}/invoice`
                    });
                });
            },
            (item, available) => {
                req.flash('error', `Not enough stock for ${item.productName || 'item'} (available: ${available}).`);
                return res.redirect('/cart');
            },
            (err) => {
                console.error('Error creating order after Stripe payment:', err);
                return res.status(500).send('Error processing order');
            }
        );
    } catch (err) {
        console.error('Error handling Stripe success:', err);
        return res.redirect('/checkout');
    }
};

const handleStripeCancel = (req, res) => {
    req.flash('error', 'Stripe payment was cancelled.');
    return res.redirect('/checkout');
};

const showPaypalSuccess = (req, res) => {
    const user = req.session.user;
    const orderId = req.query.orderId;

    if (!user) return res.redirect('/login');
    if (!orderId) return res.redirect('/orders');

    OrderModel.getOrderDetails(orderId, (err, rows) => {
        if (err) {
            console.error('Error loading PayPal success order:', err);
            req.flash('error', 'Order not found.');
            return res.redirect('/orders');
        }

        if (!rows || rows.length === 0) {
            req.flash('error', 'Order not found.');
            return res.redirect('/orders');
        }

        if (rows[0].userId && user.role !== 'admin' && user.role !== 'superadmin' && rows[0].userId !== user.id) {
            req.flash('error', 'You cannot view this order.');
            return res.redirect('/orders');
        }

        const resolvedOrderId = rows[0].orderId || orderId;
        return res.render('paypalSuccess', {
            user,
            cart: req.session.cart || [],
            orderId: resolvedOrderId,
            invoiceUrl: `/orders/${resolvedOrderId}/invoice`
        });
    });
};

const showNetsQrPay = async (req, res) => {
    const user = req.session.user;
    const cart = req.session.cart || [];

    if (!user) return res.redirect('/login');
    if (!cart.length) return res.redirect('/cart');

    const items = normalizeCartItems(cart);
    const totals = calculateTotals(items);
    const cartTotal = totals.total.toFixed(2);

    try {
        const responseData = await NetsService.createQrForTotal(cartTotal);
        const qrData = responseData?.result?.data || {};

        if (
            qrData.response_code === "00" &&
            qrData.txn_status === 1 &&
            qrData.qr_code
        ) {
            const txnRetrievalRef = qrData.txn_retrieval_ref;
            const courseInitId = NetsService.getCourseInitIdParam();
            const webhookUrl = NetsService.buildWebhookUrl(txnRetrievalRef, courseInitId);

            req.session.netsPayment = {
                txnRetrievalRef,
                courseInitId,
                total: cartTotal,
                startedAt: Date.now(),
            };

            return res.render("netsQrPay", {
                total: cartTotal,
                title: "Scan to Pay",
                qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
                txnRetrievalRef,
                courseInitId,
                timer: 300,
                webhookUrl,
                user,
                cart
            });
        }

        let errorMsg = "An error occurred while generating the QR code.";
        if (qrData.network_status !== 0) {
            errorMsg = qrData.error_message || "Transaction failed. Please try again.";
        }
        return res.render("netsQrFail", {
            title: "Error",
            responseCode: qrData.response_code || "N.A.",
            instructions: qrData.instruction || "",
            errorMsg: errorMsg,
        });
    } catch (error) {
        console.error("Error in showNetsQrPay:", error.message);
        return res.redirect("/nets-qr/fail");
    }
};

const createStripeSubscriptionSession = async (req, res) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const stripe = getStripeClient();
    if (!stripe) return res.status(500).json({ error: 'Stripe is not configured' });

    try {
        ProductModel.getAllProducts(async (err, products) => {
            if (err) {
                console.error('Error loading products for subscription:', err);
                return res.status(500).json({ error: 'Failed to load products' });
            }

            const safeProducts = Array.isArray(products) ? products : [];
            if (!safeProducts.length) return res.status(400).json({ error: 'No products available' });

            const items = safeProducts.map((product) => ({
                productId: product.id,
                productName: product.productName,
                price: Number(product.price) || 0,
                quantity: 2,
                image: product.image
            }));
            const totals = calculateTotals(items);
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            const lineItems = items.map((item) => ({
                price_data: {
                    currency: 'sgd',
                    product_data: {
                        name: `${item.productName} (x${item.quantity})`
                    },
                    unit_amount: Math.max(1, Math.round(item.price * 100)),
                    recurring: { interval: 'week', interval_count: 2 }
                },
                quantity: item.quantity
            }));

            if (totals.shippingFee > 0) {
                lineItems.push({
                    price_data: {
                        currency: 'sgd',
                        product_data: { name: 'Delivery (Biweekly)' },
                        unit_amount: Math.round(totals.shippingFee * 100),
                        recurring: { interval: 'week', interval_count: 2 }
                    },
                    quantity: 1
                });
            }

            const session = await stripe.checkout.sessions.create({
                mode: 'subscription',
                line_items: lineItems,
                customer_email: user.email || undefined,
                success_url: `${baseUrl}/stripe/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${baseUrl}/stripe/subscription/cancel`,
                metadata: {
                    userId: String(user.id || ''),
                    subscriptionType: 'biweekly_all_products_qty2'
                }
            });

            req.session.stripeSubscription = {
                sessionId: session.id,
                createdAt: Date.now()
            };

            return res.json({ url: session.url });
        });
    } catch (err) {
        console.error('Error creating Stripe subscription session:', err);
        return res.status(500).json({ error: 'Failed to create subscription session' });
    }
};

const createOrderFromSubscription = (userId, onSuccess, onError) => {
    ProductModel.getAllProducts((err, products) => {
        if (err) return onError(err);
        const items = (products || []).map(product => ({
            productId: product.id,
            productName: product.productName,
            price: Number(product.price) || 0,
            quantity: 2,
            image: product.image
        }));
        if (!items.length) return onError(new Error('No products available'));

        const totals = calculateTotals(items);

        validateStock(
            items,
            () => {
                OrderModel.createOrder(userId, totals.total, (errCreate, result) => {
                    if (errCreate) return onError(errCreate);
                    const orderId = result.insertId;

                    const saveItem = (index) => {
                        if (index >= items.length) return onSuccess(orderId);

                        const item = items[index];
                        OrderModel.addOrderItem(orderId, item.productId, item.quantity, item.price, (errItem) => {
                            if (errItem) return onError(errItem);
                            ProductModel.decreaseStock(item.productId, item.quantity, (errStock, resultStock) => {
                                if (errStock) return onError(errStock);
                                if (resultStock && resultStock.affectedRows === 0) {
                                    return onError(new Error('Stock changed for subscription item'));
                                }
                                saveItem(index + 1);
                            });
                        });
                    };

                    saveItem(0);
                });
            },
            (item, available) => {
                onError(new Error(`Not enough stock for ${item.productName || 'item'} (available: ${available}).`));
            },
            onError
        );
    });
};

const handleStripeWebhook = async (req, res) => {
    const stripe = getStripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) return res.status(400).send('Stripe not configured');

    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
        console.error('Stripe webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            if (session.mode === 'subscription' && session.subscription && session.metadata?.userId) {
                StripeSubscriptionModel.upsertSubscription({
                    userId: Number(session.metadata.userId),
                    subscriptionId: session.subscription,
                    customerId: session.customer,
                    status: 'active'
                }, (err) => {
                    if (err) console.error('Stripe subscription upsert error:', err);
                });
            }
        }

        if (event.type === 'invoice.payment_succeeded') {
            const invoice = event.data.object;
            const subscriptionId = invoice.subscription;
            if (!subscriptionId) {
                return res.json({ received: true });
            }

            StripeSubscriptionModel.getBySubscriptionId(subscriptionId, (err, rows) => {
                if (err) {
                    console.error('Stripe subscription lookup error:', err);
                    return res.json({ received: true });
                }
                const record = rows && rows[0];
                if (!record || !record.user_id) {
                    console.error('Stripe subscription missing user mapping');
                    return res.json({ received: true });
                }
                if (record.last_invoice_id && record.last_invoice_id === invoice.id) {
                    return res.json({ received: true });
                }

                createOrderFromSubscription(record.user_id,
                    (orderId) => {
                        OrderModel.updatePaymentInfo(orderId, {
                            provider: 'stripe',
                            paymentId: invoice.payment_intent || invoice.id,
                            amount: invoice.amount_paid ? invoice.amount_paid / 100 : null
                        }, (errPay) => {
                            if (errPay) console.error('Error saving subscription payment info:', errPay);
                        });
                        StripeSubscriptionModel.updateLastInvoice(subscriptionId, invoice.id, 'active', (errUpdate) => {
                            if (errUpdate) console.error('Stripe subscription update error:', errUpdate);
                            console.log(`Subscription order created: ${orderId}`);
                        });
                    },
                    (errCreate) => {
                        console.error('Subscription order creation failed:', errCreate.message || errCreate);
                    }
                );

                return res.json({ received: true });
            });

            return;
        }

        if (event.type === 'invoice.payment_failed') {
            const invoice = event.data.object;
            const subscriptionId = invoice.subscription;
            if (subscriptionId) {
                StripeSubscriptionModel.updateLastInvoice(subscriptionId, invoice.id || null, 'past_due', (errUpdate) => {
                    if (errUpdate) console.error('Stripe subscription update error:', errUpdate);
                });
            }
        }

        return res.json({ received: true });
    } catch (err) {
        console.error('Stripe webhook handler error:', err);
        return res.status(500).send('Webhook handler error');
    }
};

const handleStripeSubscriptionSuccess = async (req, res) => {
    const user = req.session.user;
    const sessionId = req.query.session_id;

    if (!user) return res.redirect('/login');
    if (!sessionId) return res.redirect('/checkout');

    const stripe = getStripeClient();
    if (!stripe) return res.redirect('/checkout');

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session || session.payment_status !== 'paid') {
            req.flash('error', 'Stripe subscription payment not completed.');
            return res.redirect('/checkout');
        }

        return res.render('stripeSubscriptionSuccess', {
            user,
            cart: req.session.cart || [],
            subscriptionId: session.subscription,
            manageUrl: session.customer_details?.email ? 'https://dashboard.stripe.com/test/subscriptions' : ''
        });
    } catch (err) {
        console.error('Error handling Stripe subscription success:', err);
        return res.redirect('/checkout');
    }
};

const handleStripeSubscriptionCancel = (req, res) => {
    req.flash('error', 'Stripe subscription checkout was cancelled.');
    return res.redirect('/checkout');
};

const showSubscription = (req, res) => {
    const user = req.session.user;
    if (!user) return res.redirect('/login');

    StripeSubscriptionModel.getByUserId(user.id, async (err, rows) => {
        if (err) {
            console.error('Error loading subscription:', err);
            return res.status(500).send('Error loading subscription');
        }

        const subscription = rows && rows[0] ? rows[0] : null;
        let subscriptionInfo = null;

        if (subscription && subscription.stripe_subscription_id) {
            const stripe = getStripeClient();
            if (stripe) {
                try {
                    const stripeSub = await stripe.subscriptions.retrieve(
                        subscription.stripe_subscription_id,
                        { expand: ['latest_invoice', 'latest_invoice.lines'] }
                    );
                    const items = stripeSub?.items?.data || [];
                    const amountCents = items.reduce((sum, item) => {
                        const unit = Number(item.price?.unit_amount || 0);
                        const qty = Number(item.quantity || 1);
                        return sum + unit * qty;
                    }, 0);
                    const currency = (stripeSub?.currency || items[0]?.price?.currency || 'sgd').toUpperCase();
                    const fallbackPeriodEnd = stripeSub?.latest_invoice?.lines?.data?.[0]?.period?.end;
                    const nextBillingEpoch = stripeSub?.current_period_end || fallbackPeriodEnd || null;
                    const nextBillingDate = nextBillingEpoch ? new Date(nextBillingEpoch * 1000) : null;
                    const subscriptionName = 'Biweekly Essentials Subscription';
                    const latestInvoice = stripeSub?.latest_invoice || null;
                    const lastInvoiceId = latestInvoice?.id || subscription.last_invoice_id || null;
                    const lastInvoiceDate = latestInvoice?.created ? new Date(latestInvoice.created * 1000) : null;
                    const cancelAtPeriodEnd = Boolean(stripeSub?.cancel_at_period_end);
                    const cancelAtDate = stripeSub?.cancel_at ? new Date(stripeSub.cancel_at * 1000) : null;
                    const status = stripeSub?.status || subscription.status || 'active';

                    subscriptionInfo = {
                        name: subscriptionName,
                        amountCents,
                        currency,
                        nextBillingDate,
                        lastInvoiceId,
                        lastInvoiceDate,
                        cancelAtPeriodEnd,
                        cancelAtDate,
                        status
                    };
                } catch (stripeErr) {
                    console.error('Error retrieving Stripe subscription:', stripeErr);
                }
            }
        }

        res.render('subscription', {
            user,
            cart: req.session.cart || [],
            subscription,
            subscriptionInfo
        });
    });
};

const cancelSubscription = async (req, res) => {
    const user = req.session.user;
    if (!user) return res.redirect('/login');

    StripeSubscriptionModel.getByUserId(user.id, async (err, rows) => {
        if (err) {
            console.error('Error loading subscription for cancel:', err);
            req.flash('error', 'Unable to load subscription.');
            return res.redirect('/subscription');
        }

        const subscription = rows && rows[0] ? rows[0] : null;
        if (!subscription || !subscription.stripe_subscription_id) {
            req.flash('error', 'Subscription not found.');
            return res.redirect('/subscription');
        }

        const stripe = getStripeClient();
        if (!stripe) {
            req.flash('error', 'Stripe is not configured.');
            return res.redirect('/subscription');
        }

        try {
            const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
            if (stripeSub?.status !== 'active') {
                req.flash('error', 'Only active subscriptions can be cancelled.');
                return res.redirect('/subscription');
            }
            if (stripeSub?.cancel_at_period_end) {
                req.flash('success', 'Your subscription is already set to cancel at period end.');
                return res.redirect('/subscription');
            }

            await stripe.subscriptions.update(subscription.stripe_subscription_id, {
                cancel_at_period_end: true
            });

            StripeSubscriptionModel.updateStatus(subscription.stripe_subscription_id, 'cancel_at_period_end', (updateErr) => {
                if (updateErr) console.error('Error updating subscription status:', updateErr);
                req.flash('success', 'Your subscription will cancel at the end of the billing period.');
                return res.redirect('/subscription');
            });
        } catch (cancelErr) {
            console.error('Error cancelling subscription:', cancelErr);
            req.flash('error', 'Failed to cancel subscription.');
            return res.redirect('/subscription');
        }
    });
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
    createPaypalOrder,
    capturePaypalOrder,
    confirmNetsPayment,
    showNetsQrPay,
    createStripeCheckoutSession,
    handleStripeSuccess,
    handleStripeCancel,
    showPaypalSuccess,
    createStripeSubscriptionSession,
    handleStripeSubscriptionSuccess,
    handleStripeSubscriptionCancel,
    handleStripeWebhook,
    showSubscription,
    cancelSubscription,
    requestRefund
};
