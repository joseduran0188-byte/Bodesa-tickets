
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
    limit: '1mb',
    parameterLimit: 1000
})
);

app.use(
express.json({
    limit: '4mb',
    strict: true
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
// API DE RECEPCIÓN DE OUTLOOK
// POST /api/webhook/capturas
// ========================================

app.use('/api/webhook', webhookRoutes);

// ========================================
// AUTENTICACIÓN
// ========================================

app.use('/', authRoutes);

// ========================================
// MÓDULOS CON SESIÓN INDEPENDIENTE
// ========================================

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
return res.redirect('/login');
});

// ========================================
// RUTA NO ENCONTRADA
// ========================================

app.use((req, res) => {
return res.status(404).send('Página no encontrada.');
});

// ========================================
// MANEJO GENERAL DE ERRORES
// ========================================

app.use((err, req, res, next) => {
console.error('ERROR GENERAL:', {
    method: req.method,
    path: req.originalUrl,
    type: err.type || null,
    status: err.status || err.statusCode || null,
    message: err.message || 'Error desconocido'
});

if (res.headersSent) {
    return next(err);
}

const status =
    Number(err.status || err.statusCode) || 500;

if (
    status === 413 ||
    err.type === 'entity.too.large'
) {
    return res.status(413).json({
    ok: false,
    complete: false,
    code: 'REQUEST_TOO_LARGE',
    error: 'La solicitud supera el límite permitido de 4 MB.'
    });
}

if (
    status === 400 &&
    err.type === 'entity.parse.failed'
) {
    return res.status(400).json({
    ok: false,
    complete: false,
    code: 'INVALID_JSON',
    error: 'El contenido JSON de la solicitud no es válido.'
    });
}

if (err.type === 'encoding.unsupported') {
    return res.status(415).json({
    ok: false,
    complete: false,
    code: 'UNSUPPORTED_ENCODING',
    error: 'La codificación de la solicitud no es compatible.'
    });
}

return res.status(
    status >= 400 && status < 600 ? status : 500
).send(
    status >= 500
    ? 'Ocurrió un error interno del servidor.'
    : err.message || 'Solicitud no válida.'
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
