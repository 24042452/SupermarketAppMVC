const ProductModel = require('../models/productModel');
const ReviewModel = require('../models/reviewModel');

const LOW_STOCK_THRESHOLD = 10;
const CATEGORY_OPTIONS = ['fruits', 'vegetable', 'baked', 'beverage', 'raw'];
const CATEGORY_LABELS = {
    fruits: 'Fruits',
    vegetable: 'Vegetables',
    baked: 'Baked',
    beverage: 'Beverage',
    raw: 'Raw Food'
};
const BANNED_REVIEW_WORDS = ['spam', 'scam', 'fake', 'idiot', 'stupid', 'damn', 'shit', 'fuck', 'bitch', 'bastard'];

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bannedWordRegex = new RegExp(`\\b(${BANNED_REVIEW_WORDS.map(escapeRegExp).join('|')})\\b`, 'i');

// Lightweight guard against profanity and obvious spam in reviews
const isSpamOrVulgar = (text) => {
    const value = (text || '').toLowerCase();
    if (!value) return false;

    if (value.includes('http://') || value.includes('https://') || value.includes('www.')) return true;
    if (bannedWordRegex.test(value)) return true;

    const tokens = value.split(/\W+/).filter(Boolean);
    const uniqueTokens = new Set(tokens);
    return tokens.length >= 10 && uniqueTokens.size <= 3;
};

const normalizeCategory = (raw) => {
    const val = (raw || '').toString().toLowerCase().trim();
    return CATEGORY_OPTIONS.includes(val) ? val : '';
};

// Derive a simple category from product data or name keywords
const getCategory = (product) => {
    const fromField = (product.category || '').toLowerCase();
    if (fromField) return fromField;

    const name = (product.productName || '').toLowerCase();
    if (name.match(/banana|apple/)) return 'fruits';
    if (name.match(/tomato|broccoli/)) return 'vegetable';
    if (name.includes('bread')) return 'baked';
    if (name.includes('milk')) return 'beverage';
    if (name.match(/chicken|beef|pork|fish|salmon|steak|meat/)) return 'raw';
    return '';
};

// Show all products (shopping page or admin inventory)
const showAllProducts = (req, res) => {
    const search = req.query.search;  // get ?search= keyword
    const sort = req.query.sort || '';
    const categoryFilter = (req.query.category || '').toLowerCase();

    ProductModel.getAllProducts((err, results) => {
        if (err) {
            console.error('Error retrieving products:', err);
            return res.status(500).send('Error retrieving products');
        }

        let filteredProducts = results;

        if (search && search.trim() !== "") {
            const term = search.toLowerCase();
            filteredProducts = results.filter(p =>
                (p.productName || '').toLowerCase().includes(term)
            );
        }

        if (categoryFilter) {
            filteredProducts = filteredProducts.filter(p => getCategory(p) === categoryFilter);
        }

        if (sort === 'price-asc') {
            filteredProducts = filteredProducts.slice().sort((a, b) => a.price - b.price);
        } else if (sort === 'price-desc') {
            filteredProducts = filteredProducts.slice().sort((a, b) => b.price - a.price);
        } else if (sort === 'name-asc') {
            filteredProducts = filteredProducts.slice().sort((a, b) => a.productName.localeCompare(b.productName));
        } else if (sort === 'name-desc') {
            filteredProducts = filteredProducts.slice().sort((a, b) => b.productName.localeCompare(a.productName));
        }

        const productsWithStock = filteredProducts.map(p => ({
            ...p,
            price: Number(p.price) || 0,
            quantity: Number(p.quantity) || 0,
            isLowStock: p.quantity <= LOW_STOCK_THRESHOLD
        }));
        const lowStockCount = productsWithStock.filter(p => p.isLowStock).length;

        if (req.session && req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'superadmin')) {
            return res.render('inventory', { 
                products: productsWithStock, 
                user: req.session.user,
                search: search || "",
                sort,
                category: categoryFilter,
                lowStockCount,
                lowStockThreshold: LOW_STOCK_THRESHOLD,
                messages: req.flash('error'),
                success: req.flash('success')
            });
        }

        res.render('shopping', { 
            products: productsWithStock,
            user: req.session.user || null,
            cart: req.session.cart || [],
            search: search || "",
            sort,
            category: categoryFilter
        });
    });
};

// Show single product by ID
const showProductById = (req, res) => {
    const id = req.params.id;
    ProductModel.getProductById(id, (err, results) => {
        if (err) {
            console.error('Error retrieving product:', err);
            return res.status(500).send('Error retrieving product');
        }

        if (results.length > 0) {
            ReviewModel.getReviewsByProduct(id, (reviewErr, reviews) => {
                if (reviewErr) {
                    console.error('Error retrieving reviews:', reviewErr);
                    return res.status(500).send('Error retrieving product');
                }

                const averageRating = reviews.length
                    ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
                    : null;

                ProductModel.getAllProducts((allErr, allProducts) => {
                    if (allErr) {
                        console.error('Error retrieving related products:', allErr);
                    }

                    const product = results[0];
                    const productCategory = getCategory(product);
                    const relatedCategoryLabel = CATEGORY_LABELS[productCategory] || (productCategory || 'Products');
                    const relatedProducts = Array.isArray(allProducts)
                        ? allProducts
                            .filter((p) => p.id !== product.id && getCategory(p) === productCategory)
                            .slice(0, 3)
                        : [];

                    res.render('product', { 
                        product, 
                        user: req.session ? req.session.user : null,
                        cart: req.session ? (req.session.cart || []) : [],
                        reviews,
                        averageRating,
                        relatedProducts,
                        relatedCategoryLabel,
                        messages: req.flash('error'),
                        success: req.flash('success')
                    });
                });
            });
        } else {
            res.status(404).send('Product not found');
        }
    });
};

// Show add product form (admin only)
const addProductForm = (req, res) => {
    res.render('addProduct', { user: req.session.user || null });
};

// Add new product
const addProduct = (req, res) => {
    const { productName, name, quantity, price, category } = req.body;
    const finalName = productName || name;
    const image = req.file ? req.file.filename : null;
    const finalCategory = normalizeCategory(category);

    if (!finalName || !quantity || !price) {
        return res.status(400).send('All fields are required');
    }

    ProductModel.addProduct(finalName, quantity, price, image, finalCategory, (err) => {
        if (err) {
            console.error('Error adding product:', err);
            return res.status(500).send('Error adding product');
        }
        res.redirect('/inventory');
    });
};

// Show edit form (admin only)
const editProductForm = (req, res) => {
    const id = req.params.id;
    ProductModel.getProductById(id, (err, results) => {
        if (err) {
            console.error('Error retrieving product:', err);
            return res.status(500).send('Error retrieving product');
        }

        if (results.length > 0) {
            res.render('updateProduct', { 
                product: results[0], 
                user: req.session.user || null 
            });
        } else {
            res.status(404).send('Product not found');
        }
    });
};

// Update product
const updateProduct = (req, res) => {
    const id = req.params.id;
    const { productName, name, quantity, price, currentImage, category } = req.body;
    const finalName = productName || name;
    const image = req.file ? req.file.filename : currentImage;
    const finalCategory = normalizeCategory(category);

    if (!finalName) {
        req.flash('error', 'Product name is required.');
        return res.redirect(`/updateProduct/${id}`);
    }

    ProductModel.updateProduct(id, finalName, quantity, price, image, finalCategory, (err) => {
        if (err) {
            console.error('Error updating product:', err);
            return res.status(500).send('Error updating product');
        }
        res.redirect('/inventory');
    });
};

// Delete product
const deleteProduct = (req, res) => {
    const id = req.params.id;
    ProductModel.deleteProduct(id, (err) => {
        if (err) {
            console.error('Error deleting product:', err);
            return res.status(500).send('Error deleting product');
        }
        res.redirect('/inventory');
    });
};

// Update only stock quantity (inline admin control)
const updateStock = (req, res) => {
    const id = req.params.id;
    const quantity = parseInt(req.body.quantity, 10);

    if (Number.isNaN(quantity) || quantity < 0) {
        req.flash('error', 'Quantity must be zero or more.');
        return res.redirect('/inventory');
    }

    ProductModel.updateProductQuantity(id, quantity, (err) => {
        if (err) {
            console.error('Error updating stock:', err);
            return res.status(500).send('Error updating stock');
        }
        req.flash('success', 'Stock updated');
        res.redirect('/inventory');
    });
};

// Add review for a product
const addReview = (req, res) => {
    const productId = req.params.id;
    const user = req.session && req.session.user;
    const rating = parseInt(req.body.rating, 10);
    const comment = (req.body.comment || '').trim();

    if (!user) return res.redirect('/login');

    if (!rating || rating < 1 || rating > 5) {
        req.flash('error', 'Please provide a rating between 1 and 5.');
        return res.redirect(`/product/${productId}`);
    }

    if (isSpamOrVulgar(comment)) {
        req.flash('error', 'Review rejected: please avoid spam or inappropriate language.');
        return res.redirect(`/product/${productId}`);
    }

    ReviewModel.addReview(productId, user.id, rating, comment, (err) => {
        if (err) {
            console.error('Error saving review:', err);
            req.flash('error', 'Unable to save review right now.');
            return res.redirect(`/product/${productId}`);
        }
        req.flash('success', 'Thanks for your review!');
        res.redirect(`/product/${productId}`);
    });
};

// Delete a review (admin only)
const deleteReview = (req, res) => {
    const reviewId = req.params.id;
    const { productId } = req.body;

    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/');
    }

    ReviewModel.deleteReview(reviewId, (err) => {
        if (err) {
            console.error('Error deleting review:', err);
            req.flash('error', 'Unable to delete review.');
        } else {
            req.flash('success', 'Review deleted.');
        }
        res.redirect(`/product/${productId}`);
    });
};

// Reply to a review (admin only)
const replyReview = (req, res) => {
    const reviewId = req.params.id;
    const { productId, reply } = req.body;

    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/');
    }

    ReviewModel.replyToReview(reviewId, reply || '', (err) => {
        if (err) {
            console.error('Error replying to review:', err);
            req.flash('error', 'Unable to save reply.');
        } else {
            req.flash('success', 'Reply saved.');
        }
        res.redirect(`/product/${productId}`);
    });
};

module.exports = {
    showAllProducts,
    showProductById,
    addProductForm,
    addProduct,
    editProductForm,
    updateProduct,
    deleteProduct,
    updateStock,
    addReview,
    deleteReview,
    replyReview
};
