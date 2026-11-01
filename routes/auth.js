const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// Mostrar formulario de login
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Procesar login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return res.render('login', { error: 'Correo o contraseña incorrectos' });
  }

  // Guardar el token en cookie
  res.cookie('sb-access-token', data.session.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7 * 1000 // 7 días
  });

  res.redirect('/tickets');
});

// Cerrar sesión
router.get('/logout', (req, res) => {
  res.clearCookie('sb-access-token');
  res.redirect('/login');
});

module.exports = router;