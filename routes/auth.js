
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
        const email = typeof req.body.email === 'string'
            ? req.body.email.trim().toLowerCase()
            : '';

        const password = typeof req.body.password === 'string'
            ? req.body.password
            : '';

        if (!email || !password) {
            return res.status(400).render('login', {
                title: 'Iniciar sesión',
                error: 'Ingresa tu correo y contraseña.'
            });
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error || !data.session || !data.user) {
            return res.status(401).render('login', {
                title: 'Iniciar sesión',
                error: 'Correo o contraseña incorrectos.'
            });
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, role')
            .eq('id', data.user.id)
            .single();

        if (
            profileError ||
            !profile ||
            !['admin', 'tecnico', 'user'].includes(profile.role)
        ) {
            await supabase.auth.signOut();

            return res.status(403).render('login', {
                title: 'Iniciar sesión',
                error: 'La cuenta no tiene un perfil o rol válido.'
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

        // Los tres roles llegan al enrutador central.
        // Este selecciona el panel de acuerdo con el perfil real.
        return res.redirect('/tickets');

    } catch (error) {
        console.error('Error en login:', error);

        return res.status(500).render('login', {
            title: 'Iniciar sesión',
            error: 'Ocurrió un error al iniciar sesión.'
        });
    }
});

router.post('/logout', async (req, res) => {
    try {
        const token = req.cookies?.['sb-access-token'];

        if (token) {
            const supabaseUser = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_ANON_KEY,
                {
                    global: {
                        headers: {
                            Authorization: `Bearer ${token}`
                        }
                    },
                    auth: {
                        autoRefreshToken: false,
                        persistSession: false
                    }
                }
            );

            const { error } = await supabaseUser.auth.signOut();

            if (error) {
                console.error('Error al cerrar sesión:', error.message);
            }
        }

        res.clearCookie('sb-access-token', cookieOptions);
        return res.redirect('/login');

    } catch (error) {
        console.error('Error en logout:', error);

        res.clearCookie('sb-access-token', cookieOptions);
        return res.redirect('/login');
    }
});

module.exports = router;
