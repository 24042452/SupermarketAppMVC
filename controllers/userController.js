const UserModel = require('../models/userModel');
const CartModel = require('../models/cartModel');

const mergeCarts = (savedCart = [], guestCart = []) => {
    const map = new Map();

    savedCart.forEach(item => {
        map.set(item.productId, { ...item });
    });

    guestCart.forEach(item => {
        const key = item.productId || item.id;
        if (!key) return;
        if (map.has(key)) {
            const existing = map.get(key);
            existing.quantity += Number(item.quantity) || 0;
        } else {
            map.set(key, {
                productId: key,
                productName: item.productName,
                price: Number(item.price) || 0,
                quantity: Number(item.quantity) || 0,
                image: item.image
            });
        }
    });

    return Array.from(map.values());
};

const persistCart = (userId, cart = [], callback) => {
    if (!userId) return callback();

    // Clear then re-save to reflect current session cart
    CartModel.clearCart(userId, (clearErr) => {
        if (clearErr) {
            console.error('Error clearing cart before logout:', clearErr);
            // Continue attempting to save items even if clear fails
        }

        const items = cart.filter(item => (item.productId || item.id) && Number(item.quantity) > 0);

        const saveNext = (index) => {
            if (index >= items.length) return callback();

            const current = items[index];
            const productId = current.productId || current.id;
            const quantity = Number(current.quantity) || 0;

            CartModel.upsertCartItem(userId, productId, quantity, (err) => {
                if (err) {
                    console.error('Error saving cart item on logout:', err);
                    // Continue to attempt remaining items
                }
                saveNext(index + 1);
            });
        };

        saveNext(0);
    });
};

// Register user
const registerUser = (req, res) => {
    const { username, email, password, address, contact } = req.body;

    if (!username || !email || !password || !address || !contact) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    UserModel.addUser(username, email, password, address, contact, 'user', (err) => {
        if (err) return res.status(500).send('Error registering user');
        req.flash('success', 'Registration successful! Please login.');
        res.redirect('/login');
    });
};

// Login user
const loginUser = (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    // Find user by email
    UserModel.getAllUsers((err, users) => {
        if (err) return res.status(500).send('Error logging in');

        const user = users.find(u => u.email === email && u.password === password);

        if (!user) {
            req.flash('error', 'Invalid email or password');
            return res.redirect('/login');
        }

        req.session.user = user;

        // Load saved cart and merge with any guest cart before login
        CartModel.getCartItemsWithProduct(user.id, (cartErr, rows) => {
            if (cartErr) {
                console.error('Error loading saved cart:', cartErr);
                // Continue login even if cart retrieval fails
                return (user.role === 'admin' || user.role === 'superadmin') ? res.redirect('/admin') : res.redirect('/');
            }

            const savedCart = (rows || []).map(row => ({
                productId: row.productId,
                productName: row.productName,
                price: Number(row.price) || 0,
                quantity: Number(row.quantity) || 0,
                image: row.image
            }));

            const guestCart = req.session.cart || [];
            req.session.cart = mergeCarts(savedCart, guestCart);

            if (user.role === 'admin' || user.role === 'superadmin') {
                res.redirect('/admin');
            } else {
                res.redirect('/');
            }
        });
    });
};

// Logout and persist current cart
const logoutUser = (req, res) => {
    const user = req.session.user;
    const cart = req.session.cart || [];

    if (user) {
        persistCart(user.id, cart, () => {
            req.session.destroy();
            res.redirect('/');
        });
    } else {
        req.session.destroy();
        res.redirect('/');
    }
};

module.exports = { registerUser, loginUser, logoutUser };
