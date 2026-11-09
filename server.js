
require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');

// ========================================
// IMPORTACIÓN DE RUTAS
// ========================================

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const tecnicoRoutes = require('./routes/tecnico');
const usuarioRoutes = require('./routes/usuario');
const actividadesRoutes = require('./routes/actividades');
const webhookRoutes = require('./routes/webhook');

// ========================================
// INICIALIZACIÓN DE EXPRESS
// ========================================

const app = express();

// ========================================
// CONFIGURACIÓN GENERAL
// ========================================

app.set('trust proxy', 1);
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// ========================================
// SEGURIDAD HTTP
// ========================================

app.use(
    helmet({
        contentSecurityPolicy: false
    })
);

// ========================================
// PROCESAMIENTO DE SOLICITUDES
// ========================================

app.use(
    express.urlencoded({
        extended: true,
        limit: '1mb'
    })
);

app.use(
    express.json({
        limit: '1mb'
    })
);

// ========================================
// EVITAR CACHÉ DE INFORMACIÓN PRIVADA
// ========================================

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Referrer-Policy', 'no-referrer');

    next();
});

// ========================================
// ARCHIVOS ESTÁTICOS
// ========================================

app.use(
    express.static(path.join(__dirname, 'public'), {
        etag: true,
        maxAge: '1h'
    })
);

// ========================================
// WEBHOOK PÚBLICO
// Debe registrarse antes de las rutas
// que requieren autenticación.
// ========================================

app.use('/api/webhook', webhookRoutes);

// ========================================
// AUTENTICACIÓN
// ========================================

app.use('/', authRoutes);

// ========================================
// MÓDULOS CON SESIÓN INDEPENDIENTE
// ========================================

// ADMINISTRADOR
app.use(
    '/sesion/:sessionToken/admin/tickets',
    adminRoutes
);

// TÉCNICO
app.use(
    '/sesion/:sessionToken/tecnico/tickets',
    tecnicoRoutes
);

// USUARIO
app.use(
    '/sesion/:sessionToken/usuario/tickets',
    usuarioRoutes
);

// ========================================
// MÓDULO DE ACTIVIDADES
// ========================================

app.use(
    '/sesion/:sessionToken/actividades',
    actividadesRoutes
);

// ========================================
// RUTA PRINCIPAL
// ========================================

app.get('/', (req, res) => {
    res.redirect('/login');
});

// ========================================
// RUTA NO ENCONTRADA
// ========================================

app.use((req, res) => {
    res.status(404).send('Página no encontrada.');
});

// ========================================
// MANEJO GENERAL DE ERRORES
// ========================================

app.use((err, req, res, next) => {
    console.error('ERROR GENERAL:', err);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).send(
        'Ocurrió un error interno en el servidor.'
    );
});

// ========================================
// INICIAR SERVIDOR LOCAL
// ========================================

if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`Servidor iniciado en el puerto ${PORT}`);
    });
}

// ========================================
// EXPORTAR APLICACIÓN
// ========================================

module.exports = app;
