
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const {
    createTabSession,
    deleteTabSession
} = require('../lib/session-manager');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function crearClienteSupabase() {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    });
}

function obtenerRutaPorRol(role, token) {
    const base = `/sesion/${encodeURIComponent(token)}`;

    const rutas = {
        admin: `${base}/admin/tickets`,
        tecnico: `${base}/tecnico/tickets`,
        user: `${base}/usuario/tickets`
    };

    return rutas[role] || '/login';
}

// Mostrar login
router.get('/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');

    res.render('login', {
        title: 'Iniciar sesión',
        error: req.query.expired
            ? 'Tu sesión expiró. Inicia sesión nuevamente.'
            : null
    });
});

// Procesar login
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

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY.');
        }

        const supabase = crearClienteSupabase();

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error || !data.user || !data.session) {
            return res.status(401).render('login', {
                title: 'Iniciar sesión',
                error: 'Correo o contraseña incorrectos.'
            });
        }

        // Cliente exclusivo para consultar el perfil autenticado.
        const supabaseUsuario = createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
            {
                global: {
                    headers: {
                        Authorization: `Bearer ${data.session.access_token}`
                    }
                },
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                    detectSessionInUrl: false
                }
            }
        );

        const { data: perfil, error: errorPerfil } = await supabaseUsuario
            .from('profiles')
            .select('id, email, full_name, role, departamento')
            .eq('id', data.user.id)
            .single();

        const rolesPermitidos = ['admin', 'tecnico', 'user'];

        if (
            errorPerfil ||
            !perfil ||
            perfil.id !== data.user.id ||
            !rolesPermitidos.includes(perfil.role)
        ) {
            // No ejecutar signOut global: podría afectar otras sesiones
            // de la misma cuenta abiertas en otras pestañas.
            return res.status(403).render('login', {
                title: 'Iniciar sesión',
                error: 'La cuenta no tiene un perfil o rol autorizado.'
            });
        }

        // Crear una sesión independiente para esta pestaña.
        const nuevaSesion = await createTabSession(
            data.user.id,
            perfil.role,
            data.session
        );

        return res.redirect(
            303,
            obtenerRutaPorRol(perfil.role, nuevaSesion.token)
        );

    } catch (error) {
        console.error('ERROR EN LOGIN:', error.message);

        return res.status(500).render('login', {
            title: 'Iniciar sesión',
            error: 'Ocurrió un error al iniciar sesión. Inténtalo nuevamente.'
        });
    }
});

// Cerrar solamente la sesión de esta pestaña.
router.post('/sesion/:sessionToken/logout', async (req, res) => {
    try {
        const token = req.params.sessionToken;

        if (
            typeof token !== 'string' ||
            !/^[A-Za-z0-9_-]{40,100}$/.test(token)
        ) {
            return res.redirect('/login');
        }

        await deleteTabSession(token);

        return res.redirect(303, '/login');

    } catch (error) {
        console.error('ERROR EN LOGOUT:', error.message);

        return res.status(500).send(
            'No se pudo cerrar la sesión. Inténtalo nuevamente.'
        );
    }
});

module.exports = router;
