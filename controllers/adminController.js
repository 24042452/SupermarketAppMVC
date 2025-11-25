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
                    const key = order.status || 'pending';
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
        res.render('adminUsers', { user: req.session.user, users });
    });
};

// Delete a user (prevent deleting current session)
const deleteUser = (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (req.session.user && req.session.user.id === userId) {
        return res.redirect('/admin/users');
    }

    UserModel.deleteUser(userId, (err) => {
        if (err) return res.status(500).send('Error deleting user');
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
    const { status } = req.body;
    const allowed = ['pending', 'delivery', 'delivered'];

    if (!allowed.includes(status)) {
        return res.redirect('/admin/orders');
    }

    OrderModel.updateOrderStatus(orderId, status, (err) => {
        if (err) return res.status(500).send('Error updating order status');
        res.redirect('/admin/orders');
    });
};

module.exports = {
    showDashboard,
    manageUsers,
    deleteUser,
    manageOrders,
    updateOrderStatus
};
