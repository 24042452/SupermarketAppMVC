const OrderModel = require('../models/orderModel');
const PayPalService = require('../services/paypal');
const { normalizeCartItems, calculateTotals } = require('../services/orderHelpers');

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

module.exports = {
    createPaypalOrder,
    capturePaypalOrder,
    showPaypalSuccess
};
