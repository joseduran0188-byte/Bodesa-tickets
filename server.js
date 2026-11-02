
require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const tecnicoRoutes = require('./routes/tecnico');
const usuarioRoutes = require('./routes/usuario');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Autenticación
app.use('/', authRoutes);

// Módulos con contexto independiente por pestaña
app.use(
    '/sesion/:sessionToken/admin/tickets',
    adminRoutes
);

app.use(
    '/sesion/:sessionToken/tecnico/tickets',
    tecnicoRoutes
);

app.use(
    '/sesion/:sessionToken/usuario/tickets',
    usuarioRoutes
);

app.get('/', (req, res) => {
    res.redirect('/login');
});

app.use((req, res) => {
    res.status(404).send('Página no encontrada.');
});

app.use((err, req, res, next) => {
    console.error('ERROR GENERAL:', err);

    res.status(500).send('Ocurrió un error interno.');
});

if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`Servidor iniciado en el puerto ${PORT}`);
    });
}

module.exports = app;
