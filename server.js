
require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');

const app = express();

// Configuración para despliegue en Vercel
app.set('trust proxy', 1);

// Configuración de Pug
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// Seguridad HTTP
app.use(helmet({
    contentSecurityPolicy: false
}));

// Middlewares para procesar solicitudes
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Evitar almacenar páginas privadas en caché
app.use((req, res, next) => {
    res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
    );

    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    next();
});

// Archivos estáticos: CSS, JavaScript e imágenes
app.use(express.static(path.join(__dirname, 'public')));

// Rutas públicas de autenticación
app.use('/', authRoutes);

// Rutas protegidas de tickets
app.use('/tickets', ticketRoutes);

// Página principal
app.get('/', (req, res) => {
    res.redirect('/tickets');
});

// Página no encontrada
app.use((req, res) => {
    res.status(404).send('Página no encontrada.');
});

// Manejo general de errores
app.use((err, req, res, next) => {
    console.error('Error general:', err);

    res.status(500).send('Ocurrió un error interno.');
});

// Inicio del servidor local
if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`Servidor iniciado en el puerto ${PORT}`);
    });
}

module.exports = app;
