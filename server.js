require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');

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

// Rutas públicas de autenticación
app.use('/', authRoutes);

// Rutas de tickets
app.use('/tickets', ticketRoutes);

app.get('/', (req, res) => {
    res.redirect('/tickets');
});

app.use((req, res) => {
    res.status(404).send('Página no encontrada.');
});

app.use((err, req, res, next) => {
    console.error('Error general:', err);
    res.status(500).send('Ocurrió un error interno.');
});

if (require.main === module) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`Servidor iniciado en el puerto ${PORT}`);
    });
}

module.exports = app;