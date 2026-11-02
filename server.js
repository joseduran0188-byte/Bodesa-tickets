require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const tecnicoRoutes = require('./routes/tecnico');
const usuarioRoutes = require('./routes/usuario');

const {
    requireAuth,
    requireAdmin,
    requireTechnician,
    requireUser
} = require('./middleware/auth');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

app.use('/', authRoutes);

// Las rutas de cada rol deben estar protegidas por el contexto de pestaña.
app.use(
    '/sesion/:sessionToken/admin/tickets',
    requireAuth,
    requireAdmin,
    adminRoutes
);

app.use(
    '/sesion/:sessionToken/tecnico/tickets',
    requireAuth,
    requireTechnician,
    tecnicoRoutes
);

app.use(
    '/sesion/:sessionToken/usuario/tickets',
    requireAuth,
    requireUser,
    usuarioRoutes
);

app.get('/', (req, res) => {
    res.redirect('/login');
});

app.use((req, res) => {
    res.status(404).render('404', {
        mensaje: 'Página no encontrada'
    });
});

app.use((error, req, res, next) => {
    console.error('Error general:', error);

    res.status(500).send('Ocurrió un error interno del servidor.');
});

if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`Servidor iniciado en puerto ${PORT}`);
    });
}

module.exports = app;