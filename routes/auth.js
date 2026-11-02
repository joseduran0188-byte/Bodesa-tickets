const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
};

router.get('/login', (req, res) => {
    res.render('login', {
        title: 'Iniciar sesión',
        error: null
    });
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).render('login', {
                title: 'Iniciar sesión',
                error: 'Ingresa tu correo y contraseña.'
            });
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password
        });

        if (error || !data.session || !data.user) {
            return res.status(401).render('login', {
                title: 'Iniciar sesión',
                error: 'Correo o contraseña incorrectos.'
            });
        }

        // Verificar que exista un perfil asociado a la cuenta.
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, role')
            .eq('id', data.user.id)
            .single();

        if (profileError || !profile) {
            await supabase.auth.signOut();
            return res.status(403).render('login', {
                title: 'Iniciar sesión',
                error: 'La cuenta no tiene un perfil registrado.'
            });
        }

        res.cookie(
            'sb-access-token',
            data.session.access_token,
            {
                ...cookieOptions,
                maxAge: data.session.expires_in * 1000
            }
        );

        return res.redirect('/tickets');
    } catch (error) {
        console.error('Error en login:', error);

        return res.status(500).render('login', {
            title: 'Iniciar sesión',
            error: 'Ocurrió un error al iniciar sesión.'
        });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('sb-access-token', { path: '/' });
    return res.redirect('/login');
});

module.exports = router;