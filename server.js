
// =====================================================
// BODESA TICKETS - SERVIDOR EXPRESS
// Compatible con desarrollo local y Vercel
// =====================================================

// Cargar variables locales.
// En Vercel se utilizarán las variables configuradas
// desde el panel de Environment Variables.
require('dotenv').config({ path: '.env.local' });

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');

// Importar rutas
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const exportRoutes = require('./routes/export');

// Crear aplicación
const app = express();

// Confiar en el proxy de Vercel
app.set('trust proxy', 1);

// Configuración de Pug
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// Middlewares de seguridad
app.use(helmet({
  contentSecurityPolicy: false
}));

// Middlewares generales
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Archivos estáticos
// Localmente Express sirve public/.
// En Vercel, los archivos de public/ se sirven mediante su CDN.
app.use(express.static(path.join(__dirname, 'public')));

// Registrar rutas
app.use('/', authRoutes);
app.use('/tickets', ticketRoutes);
app.use('/export', exportRoutes);

// Ruta principal
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Página no encontrada
app.use((req, res) => {
  res.status(404).send(
    'Página no encontrada: ' + req.originalUrl
  );
});

// Manejador general de errores
app.use((err, req, res, next) => {
  console.error('Error general:', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).send('Error interno del servidor.');
});

// =====================================================
// INICIO LOCAL
// En Vercel se exporta la aplicación sin abrir
// un servidor mediante app.listen().
// =====================================================

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

// Exportar aplicación para Vercel
module.exports = app;
