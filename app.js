const express = require('express');
require('dotenv').config();
const multer = require('multer');
const session = require('express-session');
const flash = require('connect-flash');
const app = express();

// File upload setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/images'),
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage: storage });

// Controllers
const ProductController = require('./controllers/productController');
const UserController = require('./controllers/userController');
const orderController = require('./controllers/orderController');
const AdminController = require('./controllers/adminController');
const NetsController = require('./services/nets');
const paypalController = require('./controllers/paypalController');
const netsController = require('./controllers/netsController');
const stripeController = require('./controllers/stripeController');

// Middleware
const { checkAuthenticated, checkAdmin } = require('./middlewares/middleware');

// View engine
app.set('view engine', 'ejs');

// Stripe webhook needs raw body
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), stripeController.handleStripeWebhook);

// Static files & form parsing
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Session & flash
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

// ===========================
//          ROUTES
// ===========================

// Home + Products
app.get('/', ProductController.showAllProducts);
app.get('/product/:id', ProductController.showProductById);
app.post('/product/:id/review', checkAuthenticated, ProductController.addReview);
app.post('/reviews/:id/delete', checkAuthenticated, checkAdmin, ProductController.deleteReview);
app.post('/reviews/:id/reply', checkAuthenticated, checkAdmin, ProductController.replyReview);

// ===========================
//        ADMIN ROUTES
// ===========================
app.get('/admin', checkAuthenticated, checkAdmin, AdminController.showDashboard);
app.get('/admin/users', checkAuthenticated, checkAdmin, AdminController.manageUsers);
app.post('/admin/users', checkAuthenticated, checkAdmin, AdminController.createUser);
app.post('/admin/users/:id', checkAuthenticated, checkAdmin, AdminController.updateUser);
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, AdminController.deleteUser);
app.get('/admin/orders', checkAuthenticated, checkAdmin, AdminController.manageOrders);
app.get('/admin/orders/:id', checkAuthenticated, checkAdmin, AdminController.showOrderDetail);
app.get('/admin/orders/:id/invoice', checkAuthenticated, checkAdmin, orderController.showInvoice);
app.post('/admin/orders/:id/status', checkAuthenticated, checkAdmin, AdminController.updateOrderStatus);
app.get('/admin/refunds', checkAuthenticated, checkAdmin, AdminController.manageRefunds);
app.post('/admin/refunds/:id/approve', checkAuthenticated, checkAdmin, AdminController.approveRefund);
app.post('/admin/refunds/:id/deny', checkAuthenticated, checkAdmin, AdminController.denyRefund);

app.get('/inventory', checkAuthenticated, checkAdmin, ProductController.showAllProducts);
app.post('/inventory/:id/stock', checkAuthenticated, checkAdmin, ProductController.updateStock);

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.addProduct);

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, ProductController.editProductForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.updateProduct);

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.deleteProduct);

// ===========================
//       AUTH ROUTES
// ===========================
app.get('/register', (req, res) => {
    res.render('register', {
        user: req.session.user || null,
        cart: req.session.cart || [],
        messages: req.flash('error'),
        formData: req.flash('formData')[0]
    });
});
app.post('/register', UserController.registerUser);

app.get('/login', (req, res) => {
    res.render('login', {
        user: req.session.user || null,
        cart: req.session.cart || [],
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});
app.post('/login', UserController.loginUser);

app.get('/logout', UserController.logoutUser);

// ===========================
//          CART ROUTES
// ===========================
app.get('/cart', orderController.viewCart);
app.post('/add-to-cart/:id', orderController.addToCart);
app.post('/cart/update/:id', orderController.updateCartItem);

// Remove a single item
app.post('/cart/remove/:id', orderController.removeCartItem);

// Clear entire cart
app.post('/cart/clear', orderController.clearCart);

// ===========================
//        CHECKOUT ROUTES
// ===========================
app.get('/checkout', orderController.showCheckout); // Display checkout page
app.post('/checkout', orderController.processCheckout); // Process checkout POST
app.post('/paypal/create-order', paypalController.createPaypalOrder);
app.post('/paypal/capture-order', paypalController.capturePaypalOrder);
app.get('/paypal/success', paypalController.showPaypalSuccess);
app.post('/nets-qr/request', NetsController.generateQrCode);
app.post('/nets-qr/request-json', NetsController.generateQrCodeJson);
app.post('/nets-qr/confirm', netsController.confirmNetsPayment);
app.get('/nets-qr/pay', netsController.showNetsQrPay);
app.get('/nets-qr/fail', (req, res) => {
    res.render('netsQrFail', {
        title: 'Error',
        responseCode: 'N.A.',
        instructions: '',
        errorMsg: 'Transaction failed. Please try again.'
    });
});
app.post('/stripe/create-session', stripeController.createStripeCheckoutSession);
app.get('/stripe/success', stripeController.handleStripeSuccess);
app.get('/stripe/cancel', stripeController.handleStripeCancel);
app.post('/stripe/subscription/create', stripeController.createStripeSubscriptionSession);
app.get('/stripe/subscription/success', stripeController.handleStripeSubscriptionSuccess);
app.get('/stripe/subscription/cancel', stripeController.handleStripeSubscriptionCancel);
app.get('/subscription', stripeController.showSubscription);
app.post('/subscription/cancel', stripeController.cancelSubscription);

// ===========================
//       ORDER HISTORY
// ===========================
app.get('/orders', orderController.showOrders);
app.get('/orders/:id', orderController.showOrderDetails);
app.get('/orders/:id/invoice', orderController.showInvoice);
app.post('/orders/:id/refund', checkAuthenticated, orderController.requestRefund);

// ===========================
//          SERVER
// ===========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
