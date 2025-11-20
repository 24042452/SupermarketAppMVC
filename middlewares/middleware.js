// Check if user is authenticated
const checkAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) return next();
    res.redirect('/login');
};

const checkAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') return next();
    res.redirect('/');
};

module.exports = {
    checkAuthenticated,
    checkAdmin
};