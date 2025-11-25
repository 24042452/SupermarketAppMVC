const ProductModel = require('../models/productModel');

// Show all products (shopping page or admin inventory)
const showAllProducts = (req, res) => {
    const search = req.query.search;  // get ?search= keyword

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

        // Admin sees inventory page
        if (req.session && req.session.user && req.session.user.role === 'admin') {
            return res.render('inventory', { 
                products: filteredProducts, 
                user: req.session.user,
                search: search || ""
            });
        }

        // Regular user shopping page
        res.render('shopping', { 
            products: filteredProducts,
            user: req.session.user || null,
            cart: req.session.cart || [],
            search: search || ""
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
