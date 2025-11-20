const express = require('express');
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

// Middleware
const { checkAuthenticated, checkAdmin } = require('./middlewares/middleware');

// View engine
app.set('view engine', 'ejs');

// Static files & form parsing
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));

// Session & flash
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

// --- ROUTES ---

// Home & product details
app.get('/', ProductController.showAllProducts);
app.get('/product/:id', ProductController.showProductById);

// Admin-only routes
app.get('/inventory', checkAuthenticated, checkAdmin, ProductController.showAllProducts);
app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.addProduct);
app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, ProductController.editProductForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.updateProduct);
app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.deleteProduct);

// User auth
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

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- CART ROUTES ---
app.get('/cart', orderController.viewCart);

// Add to cart (redirect stays same)
app.post('/add-to-cart/:id', (req, res) => {
    const productId = req.params.id;
    const quantity = parseInt(req.body.quantity) || 1;

    if (!req.session.cart) req.session.cart = [];

    const existingIndex = req.session.cart.findIndex(item => item.productId == productId);
    if (existingIndex > -1) {
        req.session.cart[existingIndex].quantity += quantity;
    } else {
        const ProductModel = require('./models/productModel');
        ProductModel.getProductById(productId, (err, results) => {
            if (err || results.length === 0) return res.redirect('back');
            const product = results[0];
            req.session.cart.push({
                productId: product.id,
                productName: product.productName,
                productImage: product.image || 'placeholder.png',
                price: product.price,
                quantity: quantity
            });
            return res.redirect('back');
        });
        return;
    }
    res.redirect('back');
});

// Remove single cart item
app.post('/cart/remove/:id', (req, res) => {
    const productId = req.params.id;
    if (req.session.cart) {
        req.session.cart = req.session.cart.filter(item => item.productId != productId);
    }
    res.redirect('/cart');
});

// Clear entire cart
app.post('/cart/clear', (req, res) => {
    req.session.cart = [];
    res.redirect('/cart');
});

// Checkout
app.post('/checkout', orderController.checkout);

// Orders
app.get('/orders', orderController.showOrders);
app.get('/orders/:id', orderController.showOrderDetails);

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
