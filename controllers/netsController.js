const CartModel = require('../models/cartModel');
const OrderModel = require('../models/orderModel');
const NetsService = require('../services/nets');
const { normalizeCartItems, calculateTotals, createOrderFromCart } = require('../services/orderHelpers');

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

module.exports = {
    showNetsQrPay,
    confirmNetsPayment
};
