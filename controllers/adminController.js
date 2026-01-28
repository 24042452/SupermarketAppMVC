const ProductModel = require('../models/productModel');
const UserModel = require('../models/userModel');
const OrderModel = require('../models/orderModel');
const RefundModel = require('../models/refundModel');
const PayPalService = require('../services/paypal');
const Stripe = require('stripe');

const getStripeClient = () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    return new Stripe(key);
};

// Admin dashboard with quick stats and latest orders
const showDashboard = (req, res) => {
    ProductModel.getAllProducts((productErr, products) => {
        if (productErr) return res.status(500).send('Error loading products');

        UserModel.getAllUsers((userErr, users) => {
            if (userErr) return res.status(500).send('Error loading users');

            OrderModel.getAllOrders((orderErr, orders) => {
                if (orderErr) return res.status(500).send('Error loading orders');

                const statusCounts = orders.reduce((acc, order) => {
                    const key = (order.status || 'pending').toLowerCase();
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, { pending: 0, delivery: 0, delivered: 0 });

                res.render('adminDashboard', {
                    user: req.session.user,
                    counts: {
                        products: products.length,
                        users: users.length,
                        orders: orders.length,
                        pending: statusCounts.pending || 0,
                        delivery: statusCounts.delivery || 0,
                        delivered: statusCounts.delivered || 0
                    },
                    recentOrders: orders.slice(0, 5)
                });
            });
        });
    });
};

// Manage users list
const manageUsers = (req, res) => {
    UserModel.getAllUsers((err, users) => {
        if (err) return res.status(500).send('Error loading users');
        res.render('adminUsers', { 
            user: req.session.user, 
            users,
            messages: req.flash('error'),
            success: req.flash('success')
        });
    });
};

// Delete a user (prevent deleting current session)
const deleteUser = (req, res) => {
    const userId = parseInt(req.params.id, 10);

    UserModel.getUserById(userId, (err, rows) => {
        if (err) return res.status(500).send('Error loading user');

        const target = (rows && rows[0]) || null;
        if (!target) {
            req.flash('error', 'User not found.');
            return res.redirect('/admin/users');
        }

        if (req.session.user && req.session.user.id === userId) {
            const selfRole = req.session.user.role || 'user';
            if (selfRole === 'admin' || selfRole === 'superadmin') {
                req.flash('error', 'Admins and superadmins cannot delete their own account.');
            } else {
                req.flash('error', 'You cannot delete your own account.');
            }
            return res.redirect('/admin/users');
        }

        const actorRole = (req.session.user && req.session.user.role) || 'user';
        const actorIsSuperadmin = actorRole === 'superadmin';
        const actorIsAdmin = actorRole === 'admin';

        if (target.role === 'superadmin') {
            req.flash('error', 'Superadmin accounts cannot be deleted.');
            return res.redirect('/admin/users');
        }

        if (!actorIsSuperadmin && !(actorIsAdmin && target.role === 'user')) {
            req.flash('error', 'You do not have permission to delete this user.');
            return res.redirect('/admin/users');
        }

        OrderModel.getOrdersByUser(userId, (orderErr, orders) => {
            if (orderErr) {
                console.error('Error checking user orders before delete:', orderErr);
                return res.status(500).send('Error deleting user');
            }

            const hasOrders = Array.isArray(orders) && orders.length > 0;

            if (!hasOrders) {
                UserModel.deleteUser(userId, (deleteErr) => {
                    if (deleteErr) return res.status(500).send('Error deleting user');
                    req.flash('success', 'User deleted.');
                    res.redirect('/admin/users');
                });
            } else {
                UserModel.anonymizeUser(userId, target, (anonErr) => {
                    if (anonErr) {
                        console.error('Error anonymizing user:', anonErr);
                        return res.status(500).send('Error deleting user');
                    }
                    req.flash('success', 'User removed but order history and details kept.');
                    res.redirect('/admin/users');
                });
            }
        });
    });
};

// Create user (admin only; can create admin accounts)
const createUser = (req, res) => {
    const { username, email, password, address, contact, role } = req.body;
    const allowedRoles = ['user', 'admin', 'superadmin'];

    if (!username || !email || !password || !address || !contact) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/admin/users');
    }

    const finalRole = allowedRoles.includes(role) ? role : 'user';

    if (finalRole === 'superadmin' && (!req.session.user || req.session.user.role !== 'superadmin')) {
        req.flash('error', 'Only a superadmin can create another superadmin.');
        return res.redirect('/admin/users');
    }

    UserModel.addUser(username, email, password, address, contact, finalRole, (err) => {
        if (err) {
            console.error('Error creating user:', err);
            req.flash('error', 'Could not create user (email may already exist).');
            return res.redirect('/admin/users');
        }
        req.flash('success', `User created as ${finalRole}.`);
        res.redirect('/admin/users');
    });
};

// Manage orders list with status updates
const manageOrders = (req, res) => {
    OrderModel.getAllOrders((err, orders) => {
        if (err) return res.status(500).send('Error loading orders');
        res.render('adminOrders', {
            user: req.session.user,
            orders,
            statuses: ['pending', 'delivery', 'delivered']
        });
    });
};

// Update order status
const updateOrderStatus = (req, res) => {
    const orderId = req.params.id;
    const { status, redirectTo } = req.body;
    const allowed = ['pending', 'delivery', 'delivered'];

    if (!allowed.includes(status)) {
        return res.redirect('/admin/orders');
    }

    const safeRedirect = (redirectTo && redirectTo.startsWith('/admin/orders')) ? redirectTo : '/admin/orders';

    OrderModel.updateOrderStatus(orderId, status, (err) => {
        if (err) return res.status(500).send('Error updating order status');
        res.redirect(safeRedirect);
    });
};

// Admin: view single order with ability to edit status
const showOrderDetail = (req, res) => {
    const orderId = req.params.id;

    OrderModel.getOrderDetails(orderId, (err, rows) => {
        if (err) return res.status(500).send('Error loading order');
        if (!rows || rows.length === 0) {
            req.flash('error', 'Order not found.');
            return res.redirect('/admin/orders');
        }

        const order = {
            id: rows[0].orderId,
            total: rows[0].total,
            order_date: rows[0].order_date,
            status: rows[0].status,
            userId: rows[0].userId,
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

        // Fetch buyer info for display
        UserModel.getUserById(order.userId, (userErr, userRows) => {
            if (userErr) return res.status(500).send('Error loading user for order');
            const buyer = (userRows && userRows[0]) || {};

            res.render('adminOrderDetails', {
                user: req.session.user,
                order,
                buyer,
                statuses: ['pending', 'delivery', 'delivered'],
                messages: req.flash('error'),
                success: req.flash('success')
            });
        });
    });
};

// Update user details and role
const updateUser = (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const { username, email, password, address, contact, role } = req.body;
    const allowedRoles = ['user', 'admin', 'superadmin'];

    if (!username || !email || !address || !contact) {
        req.flash('error', 'Username, email, contact, and address are required.');
        return res.redirect('/admin/users');
    }

    const actor = req.session.user || {};
    let finalRole = allowedRoles.includes(role) ? role : 'user';

    UserModel.getUserById(userId, (err, rows) => {
        if (err) return res.status(500).send('Error loading user');

        const existing = (rows && rows[0]) || null;
        if (!existing) {
            req.flash('error', 'User not found.');
            return res.redirect('/admin/users');
        }

        if (finalRole === 'superadmin' && actor.role !== 'superadmin') {
            req.flash('error', 'Only a superadmin can assign the superadmin role.');
            return res.redirect('/admin/users');
        }

        if (actor.role === 'admin' && existing.role !== 'user') {
            req.flash('error', 'Admins can only modify users (not admins or superadmins).');
            return res.redirect('/admin/users');
        }

        // Admins cannot change roles; keep the existing role.
        if (actor.role === 'admin') {
            finalRole = existing.role;
        }

        if (existing.role === 'superadmin') {
            if (!req.session.user || req.session.user.role !== 'superadmin') {
                req.flash('error', 'Only a superadmin can modify superadmin accounts.');
                return res.redirect('/admin/users');
            }
            // Superadmin role is immutable, including when editing self
            finalRole = 'superadmin';
        }

        if (req.session.user && req.session.user.id === userId && req.session.user.role === 'superadmin') {
            finalRole = 'superadmin';
        }

        const newPassword = password && password.trim().length > 0 ? password : existing.password;

        UserModel.updateUser(userId, username, email, newPassword, address, contact, finalRole, (updateErr) => {
            if (updateErr) {
                console.error('Error updating user:', updateErr);
                req.flash('error', 'Could not update user.');
                return res.redirect('/admin/users');
            }

            // Keep session user details in sync if they edited themselves
            if (req.session.user && req.session.user.id === userId) {
                req.session.user = {
                    ...req.session.user,
                    username,
                    email,
                    address,
                    contact,
                    role: finalRole,
                    password: newPassword
                };
            }

            req.flash('success', 'User updated.');
            res.redirect('/admin/users');
        });
    });
};

const manageRefunds = (req, res) => {
    RefundModel.getAll((err, refunds) => {
        if (err) return res.status(500).send('Error loading refunds');
        res.render('adminRefunds', {
            user: req.session.user,
            refunds,
            messages: req.flash('error'),
            success: req.flash('success')
        });
    });
};

const approveRefund = (req, res) => {
    const refundId = req.params.id;
    const amount = Number(req.body.amount || 0);
    const adminNote = req.body.adminNote || '';
    const adminId = req.session.user?.id || null;

    if (!amount || amount <= 0) {
        req.flash('error', 'Refund amount must be greater than 0.');
        return res.redirect('/admin/refunds');
    }

    RefundModel.getById(refundId, (err, rows) => {
        if (err || !rows || !rows.length) {
            req.flash('error', 'Refund request not found.');
            return res.redirect('/admin/refunds');
        }

        const refund = rows[0];
        if (refund.status !== 'pending') {
            req.flash('error', 'Refund request already processed.');
            return res.redirect('/admin/refunds');
        }

        OrderModel.getOrderDetails(refund.order_id, async (orderErr, orderRows) => {
            if (orderErr || !orderRows || !orderRows.length) {
                req.flash('error', 'Order not found.');
                return res.redirect('/admin/refunds');
            }

            const orderTotal = Number(orderRows[0].total || 0);
            if (amount > orderTotal) {
                req.flash('error', 'Refund amount cannot exceed order total.');
                return res.redirect('/admin/refunds');
            }

            try {
                if (refund.provider === 'stripe') {
                    const stripe = getStripeClient();
                    if (!stripe) {
                        req.flash('error', 'Stripe is not configured.');
                        return res.redirect('/admin/refunds');
                    }
                    await stripe.refunds.create({
                        payment_intent: refund.payment_id,
                        amount: Math.round(amount * 100)
                    });
                } else if (refund.provider === 'paypal') {
                    const result = await PayPalService.refundCapture(refund.payment_id, amount);
                    if (!result.ok) {
                        console.error('PayPal refund failed:', result.data);
                        req.flash('error', 'PayPal refund failed.');
                        return res.redirect('/admin/refunds');
                    }
                } else {
                    req.flash('error', 'Unsupported payment provider.');
                    return res.redirect('/admin/refunds');
                }

                RefundModel.updateStatus(refund.id, 'approved', adminId, adminNote, amount, (updateErr) => {
                    if (updateErr) console.error('Refund update error:', updateErr);
                    const refundStatus = amount < orderTotal ? 'partial' : 'refunded';
                    OrderModel.updateRefundStatus(refund.order_id, refundStatus, amount, (orderUpdateErr) => {
                        if (orderUpdateErr) console.error('Order refund status update error:', orderUpdateErr);
                        req.flash('success', 'Refund approved and processed.');
                        return res.redirect('/admin/refunds');
                    });
                });
            } catch (refundErr) {
                console.error('Refund processing error:', refundErr);
                req.flash('error', 'Refund processing failed.');
                return res.redirect('/admin/refunds');
            }
        });
    });
};

const denyRefund = (req, res) => {
    const refundId = req.params.id;
    const adminNote = req.body.adminNote || '';
    const adminId = req.session.user?.id || null;

    RefundModel.getById(refundId, (err, rows) => {
        if (err || !rows || !rows.length) {
            req.flash('error', 'Refund request not found.');
            return res.redirect('/admin/refunds');
        }

        const refund = rows[0];
        if (refund.status !== 'pending') {
            req.flash('error', 'Refund request already processed.');
            return res.redirect('/admin/refunds');
        }

        RefundModel.updateStatus(refund.id, 'denied', adminId, adminNote, refund.amount, (updateErr) => {
            if (updateErr) console.error('Refund update error:', updateErr);
            OrderModel.updateRefundStatus(refund.order_id, 'denied', 0, (orderUpdateErr) => {
                if (orderUpdateErr) console.error('Order refund status update error:', orderUpdateErr);
                req.flash('success', 'Refund denied.');
                return res.redirect('/admin/refunds');
            });
        });
    });
};

module.exports = {
    showDashboard,
    manageUsers,
    deleteUser,
    manageOrders,
    updateOrderStatus,
    createUser,
    updateUser,
    showOrderDetail,
    manageRefunds,
    approveRefund,
    denyRefund
};
