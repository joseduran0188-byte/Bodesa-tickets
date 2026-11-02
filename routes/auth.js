
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
};

// ============================================
// CLIENTE SUPABASE INDEPENDIENTE
// ============================================

function crearSupabase(token = null) {
    const options = {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    };

    if (token) {
        options.global = {
            headers: {
                Authorization: `Bearer ${token}`
            }
        };
    }

    return createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        options
    );
}

// ============================================
// REDIRECCIÓN SEGÚN ROL
// ============================================

function rutaSegunRol(role) {
    const rutas = {
        admin: '/admin/tickets',
        tecnico: '/tecnico/tickets',
        user: '/usuario/tickets'
    };

    return rutas[role] || '/login';
}

// ============================================
// LOGIN
// ============================================

router.get('/login', (req, res) => {
    return res.render('login', {
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

        const supabase = crearSupabase();

        // Autenticar usuario.
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

        const token = data.session.access_token;

        // Consultar el perfil con la sesión autenticada.
        const supabaseUser = crearSupabase(token);

        const { data: profile, error: profileError } = await supabaseUser
            .from('profiles')
            .select('id, role')
            .eq('id', data.user.id)
            .single();

        const rolesPermitidos = ['admin', 'tecnico', 'user'];

        if (
            profileError ||
            !profile ||
            profile.id !== data.user.id ||
            !rolesPermitidos.includes(profile.role)
        ) {
            await supabaseUser.auth.signOut();

            return res.status(403).render('login', {
                title: 'Iniciar sesión',
                error: 'La cuenta no tiene un perfil o rol válido.'
            });
        }

        // Guardar token de acceso.
        res.cookie(
            'sb-access-token',
            token,
            {
                ...cookieOptions,
                maxAge: data.session.expires_in * 1000
            }
        );

        console.log('LOGIN CORRECTO:', {
            email: data.user.email,
            userId: data.user.id,
            role: profile.role,
            destination: rutaSegunRol(profile.role)
        });

        // Enviar al módulo correspondiente.
        return res.redirect(rutaSegunRol(profile.role));

    } catch (error) {
        console.error('ERROR EN LOGIN:', error);

        return res.status(500).render('login', {
            title: 'Iniciar sesión',
            error: 'Ocurrió un error al iniciar sesión.'
        });
    }
});

// ============================================
// LOGOUT
// ============================================

router.post('/logout', async (req, res) => {
    try {
        const token = req.cookies?.['sb-access-token'];

        if (token) {
            const supabaseUser = crearSupabase(token);

            const { error } = await supabaseUser.auth.signOut();

            if (error) {
                console.error(
                    'ERROR AL CERRAR SESIÓN EN SUPABASE:',
                    error.message
                );
            }
        }

        res.clearCookie('sb-access-token', {
            ...cookieOptions,
            maxAge: undefined
        });

        return res.redirect('/login');

    } catch (error) {
        console.error('ERROR EN LOGOUT:', error);

        res.clearCookie('sb-access-token', {
            ...cookieOptions,
            maxAge: undefined
        });

        return res.redirect('/login');
    }
});

module.exports = router;
