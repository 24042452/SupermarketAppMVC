// Check if user is authenticated
const checkAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) return next();
    res.redirect('/login');
};

const checkAdmin = (req, res, next) => {
    const role = req.session && req.session.user && req.session.user.role;
    if (role === 'admin' || role === 'superadmin') return next();
    res.redirect('/');
};

module.exports = {
    checkAuthenticated,
    checkAdmin
};
