const OrderModel = require('../models/orderModel');
const ProductModel = require('../models/productModel');
const CartModel = require('../models/cartModel');
const PayPalService = require('../services/paypal');
const NetsService = require('../services/nets');
const Stripe = require('stripe');

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
                req.flash('success', 'Order placed successfully.');
                return res.redirect(`/orders/${orderId}/invoice`);
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

        res.render('invoice', {
            order,
            user,
            cart: req.session.cart || []
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
                    return res.json({ status: 'success', invoiceUrl: `/orders/${orderId}/invoice` });
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
    handleStripeCancel
};
