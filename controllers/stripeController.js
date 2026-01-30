const CartModel = require('../models/cartModel');
const OrderModel = require('../models/orderModel');
const ProductModel = require('../models/productModel');
const StripeSubscriptionModel = require('../models/stripeSubscriptionModel');
const { normalizeCartItems, calculateTotals, validateStock, createOrderFromCart } = require('../services/orderHelpers');
const Stripe = require('stripe');

const getStripeClient = () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    return new Stripe(key);
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
        console.error('Error creating Stripe Checkout session:', err);
        return res.status(500).json({ error: 'Failed to create Stripe Checkout session' });
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

module.exports = {
    createStripeCheckoutSession,
    handleStripeSuccess,
    handleStripeCancel,
    createStripeSubscriptionSession,
    handleStripeSubscriptionSuccess,
    handleStripeSubscriptionCancel,
    handleStripeWebhook,
    showSubscription,
    cancelSubscription
};
