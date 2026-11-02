
require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const tecnicoRoutes = require('./routes/tecnico');
const usuarioRoutes = require('./routes/usuario');

const app = express();

// ========================================
// CONFIGURACIÓN GENERAL
// ========================================

app.set('trust proxy', 1);
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// ========================================
// MIDDLEWARES
// ========================================

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Evitar caché de páginas privadas.
app.use((req, res, next) => {
    res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
    );

    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    next();
});

// Archivos estáticos.
app.use(express.static(path.join(__dirname, 'public')));

// ========================================
// AUTENTICACIÓN
// ========================================

app.use('/', authRoutes);

// ========================================
// MÓDULOS INDEPENDIENTES POR ROL
// ========================================

// Administrador
app.use('/admin/tickets', adminRoutes);

// Técnico
app.use('/tecnico/tickets', tecnicoRoutes);

// Usuario
app.use('/usuario/tickets', usuarioRoutes);

// ========================================
// RUTA PRINCIPAL
// ========================================

app.get('/', (req, res) => {
    res.redirect('/login');
});

// ========================================
// PÁGINA NO ENCONTRADA
// ========================================

app.use((req, res) => {
    res.status(404).send('Página no encontrada.');
});

// ========================================
// MANEJO GENERAL DE ERRORES
// ========================================

app.use((err, req, res, next) => {
    console.error('ERROR GENERAL:', err);

    res.status(500).send(
        'Ocurrió un error interno.'
    );
});

// ========================================
// INICIAR SERVIDOR
// ========================================

if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(
            `Servidor iniciado en el puerto ${PORT}`
        );
    });
}

module.exports = app;
