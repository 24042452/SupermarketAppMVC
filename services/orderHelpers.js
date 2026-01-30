const OrderModel = require('../models/orderModel');
const ProductModel = require('../models/productModel');

const normalizeCartItems = (cart = []) => cart.map(item => ({
    productId: item.productId || item.id,
    productName: item.productName,
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 0,
    image: item.image
}));

const calculateTotals = (items) => {
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shippingThreshold = 50;
    const shippingFee = subtotal >= shippingThreshold ? 0 : 4.99;
    const total = subtotal + shippingFee;
    return {
        subtotal,
        shippingFee,
        total
    };
};

const validateStock = (items, onSuccess, onInsufficient, onError) => {
    let index = 0;

    const next = () => {
        if (index >= items.length) return onSuccess();

        const current = items[index];
        ProductModel.getProductById(current.productId, (err, results) => {
            if (err) return onError(err);
            const product = results && results[0];

            if (!product || product.quantity < current.quantity) {
                return onInsufficient(current, product ? product.quantity : 0);
            }

            index += 1;
            next();
        });
    };

    next();
};

const createOrderFromCart = (user, cart, onSuccess, onInsufficient, onError) => {
    if (!user) return onError(new Error('Unauthorized'));
    if (!cart || cart.length === 0) return onError(new Error('Cart is empty'));

    const items = normalizeCartItems(cart);
    const totals = calculateTotals(items);

    validateStock(
        items,
        () => {
            OrderModel.createOrder(user.id, totals.total, (err, result) => {
                if (err) return onError(err);

                const orderId = result.insertId;

                const saveItem = (index) => {
                    if (index === items.length) {
                        return onSuccess(orderId);
                    }

                    const item = items[index];

                    OrderModel.addOrderItem(orderId, item.productId, item.quantity, item.price, (err2) => {
                        if (err2) return onError(err2);

                        ProductModel.decreaseStock(item.productId, item.quantity, (err3, result3) => {
                            if (err3) return onError(err3);

                            if (result3 && result3.affectedRows === 0) {
                                return onInsufficient(item, 0);
                            }

                            saveItem(index + 1);
                        });
                    });
                };

                saveItem(0);
            });
        },
        onInsufficient,
        onError
    );
};

module.exports = {
    normalizeCartItems,
    calculateTotals,
    validateStock,
    createOrderFromCart
};
