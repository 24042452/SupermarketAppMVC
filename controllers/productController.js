const ProductModel = require('../models/productModel');

// Derive a simple category from product data or name keywords
const getCategory = (product) => {
    const fromField = (product.category || '').toLowerCase();
    if (fromField) return fromField;

    const name = (product.productName || '').toLowerCase();
    if (name.match(/banana|apple/)) return 'fruits';
    if (name.match(/tomato|broccoli/)) return 'vegetable';
    if (name.includes('bread')) return 'baked';
    if (name.includes('milk')) return 'beverage';
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

        // If search term exists → filter by product name
        if (search && search.trim() !== "") {
            const term = search.toLowerCase();
            filteredProducts = results.filter(p =>
                p.productName.toLowerCase().includes(term)
            );
        }

        // Filter by category derived from product name/field
        if (categoryFilter) {
            filteredProducts = filteredProducts.filter(p => getCategory(p) === categoryFilter);
        }

        // Sort results
        if (sort === 'price-asc') {
            filteredProducts = filteredProducts.slice().sort((a, b) => a.price - b.price);
        } else if (sort === 'price-desc') {
            filteredProducts = filteredProducts.slice().sort((a, b) => b.price - a.price);
        } else if (sort === 'name-asc') {
            filteredProducts = filteredProducts.slice().sort((a, b) => a.productName.localeCompare(b.productName));
        } else if (sort === 'name-desc') {
            filteredProducts = filteredProducts.slice().sort((a, b) => b.productName.localeCompare(a.productName));
        }

        // Admin sees inventory page
        if (req.session && req.session.user && req.session.user.role === 'admin') {
            return res.render('inventory', { 
                products: filteredProducts, 
                user: req.session.user,
                search: search || "",
                sort,
                category: categoryFilter
            });
        }

        // Regular user shopping page
        res.render('shopping', { 
            products: filteredProducts,
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
            res.render('product', { 
                product: results[0], 
                user: req.session ? req.session.user : null 
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
    const { productName, quantity, price } = req.body;
    const image = req.file ? req.file.filename : null;

    ProductModel.addProduct(productName, quantity, price, image, (err) => {
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
    const { productName, quantity, price, currentImage } = req.body;
    const image = req.file ? req.file.filename : currentImage;

    ProductModel.updateProduct(id, productName, quantity, price, image, (err) => {
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

module.exports = {
    showAllProducts,
    showProductById,
    addProductForm,
    addProduct,
    editProductForm,
    updateProduct,
    deleteProduct
};
