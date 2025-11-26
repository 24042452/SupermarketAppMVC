const ProductModel = require('../models/productModel');
const UserModel = require('../models/userModel');
const OrderModel = require('../models/orderModel');

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
            req.flash('error', 'You cannot delete your own account.');
            return res.redirect('/admin/users');
        }

        if (target.role === 'admin') {
            req.flash('error', 'You cannot delete other admin users.');
            return res.redirect('/admin/users');
        }

        UserModel.deleteUser(userId, (deleteErr) => {
            if (deleteErr) return res.status(500).send('Error deleting user');
            req.flash('success', 'User deleted.');
            res.redirect('/admin/users');
        });
    });
};

// Create user (admin only; can create admin accounts)
const createUser = (req, res) => {
    const { username, email, password, address, contact, role } = req.body;
    const allowedRoles = ['user', 'admin'];

    if (!username || !email || !password || !address || !contact) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/admin/users');
    }

    const finalRole = allowedRoles.includes(role) ? role : 'user';

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
    const allowedRoles = ['user', 'admin'];

    if (!username || !email || !address || !contact) {
        req.flash('error', 'Username, email, contact, and address are required.');
        return res.redirect('/admin/users');
    }

    const finalRole = allowedRoles.includes(role) ? role : 'user';

    UserModel.getUserById(userId, (err, rows) => {
        if (err) return res.status(500).send('Error loading user');

        const existing = (rows && rows[0]) || null;
        if (!existing) {
            req.flash('error', 'User not found.');
            return res.redirect('/admin/users');
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

module.exports = {
    showDashboard,
    manageUsers,
    deleteUser,
    manageOrders,
    updateOrderStatus,
    createUser,
    updateUser,
    showOrderDetail
};
