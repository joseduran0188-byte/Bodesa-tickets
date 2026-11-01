
// server.js

// 1. Variables de entorno
require('dotenv').config({ path: '.env.local' });

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');

// 2. Importar rutas
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const exportRoutes = require('./routes/export');

// 3. Crear aplicación Express
const app = express();

// 4. Configuración de Pug
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// 5. Middlewares
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// 6. Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// 7. Registrar rutas
app.use('/', authRoutes);
app.use('/tickets', ticketRoutes);
app.use('/export', exportRoutes);

// 8. Ruta principal
app.get('/', (req, res) => {
  res.redirect('/login');
});

// 9. Ruta para páginas no encontradas
app.use((req, res) => {
  res.status(404).send('Página no encontrada: ' + req.originalUrl);
});

// 10. Iniciar servidor
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
