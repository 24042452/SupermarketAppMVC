const express = require('express');
const multer = require('multer');
const session = require('express-session');
const flash = require('connect-flash');
const app = express();

// File upload setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Controllers
const ProductController = require('./controllers/productController');
const UserController = require('./controllers/userController');

// Set up view engine
app.set('view engine', 'ejs');

// Enable static files
app.use(express.static('public'));

// Enable form processing
app.use(express.urlencoded({ extended: false }));

// Session & flash middleware
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 1 week
}));
app.use(flash());

// Middleware for authentication
const checkAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login');
};

// Middleware for admin-only routes
const checkAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.redirect('/');
};

// Routes
app.get('/', ProductController.showAllProducts);
app.get('/product/:id', ProductController.showProductById);

app.get('/inventory', checkAuthenticated, checkAdmin, ProductController.showAllProducts);
app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.addProduct);

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, ProductController.editProductForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.updateProduct);
app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.deleteProduct);

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});
app.post('/register', UserController.registerUser);

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});
app.post('/login', UserController.loginUser);

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const orderController = require('./controllers/orderController');

// View cart
app.get('/cart', orderController.viewCart);

// Add to cart
app.post('/add-to-cart/:id', (req, res) => {
    const productId = req.params.id;
    const quantity = parseInt(req.body.quantity) || 1;

    if (!req.session.cart) {
        req.session.cart = [];
    }

    const existingItemIndex = req.session.cart.findIndex(item => item.productId == productId);
    if (existingItemIndex > -1) {
        req.session.cart[existingItemIndex].quantity += quantity;
    } else {
        // You need product details to push into cart
        const ProductModel = require('./models/productModel');
        ProductModel.getProductById(productId, (err, results) => {
            if (err || results.length === 0) return res.redirect('/shopping');
            const product = results[0];
            req.session.cart.push({
                productId: product.id,
                productName: product.productName,
                price: product.price,
                quantity: quantity
            });
            return res.redirect('/');
        });
        return;
    }

    res.redirect('/shopping');
});


// Checkout
app.post('/checkout', orderController.checkout);

// Orders
app.get('/orders', orderController.showOrders);
app.get('/orders/:id', orderController.showOrderDetails);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
