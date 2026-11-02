
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function crearSupabase(token) {
    return createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
            global: {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            },
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            }
        }
    );
}

// ========================================
// VERIFICAR SESIÓN Y CARGAR PERFIL
// ========================================

async function requireAuth(req, res, next) {
    try {
        const token = req.cookies?.['sb-access-token'];

        if (!token) {
            return res.redirect('/login');
        }

        const supabase = crearSupabase(token);

        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser(token);

        if (authError || !user) {
            res.clearCookie('sb-access-token', {
                path: '/'
            });

            return res.redirect('/login');
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, email, full_name, role, departamento')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            console.error('ERROR AL CONSULTAR PERFIL:', profileError);

            return res.status(403).send(
                'No se encontró el perfil del usuario.'
            );
        }

        const rolesPermitidos = ['admin', 'tecnico', 'user'];

        if (!rolesPermitidos.includes(profile.role)) {
            return res.status(403).send('Rol no autorizado.');
        }

        // Guardar cliente autenticado para las consultas.
        req.supabase = supabase;

        // Guardar información del usuario en la solicitud.
        req.user = {
            id: user.id,
            email: user.email,
            full_name: profile.full_name || '',
            role: profile.role,
            departamento: profile.departamento || ''
        };

        res.locals.user = req.user;

        console.log('SESIÓN VERIFICADA:', {
            email: req.user.email,
            id: req.user.id,
            role: req.user.role,
            url: req.originalUrl,
            method: req.method
        });

        return next();

    } catch (error) {
        console.error('ERROR EN requireAuth:', error);

        return res.status(500).send(
            'Error al verificar la sesión.'
        );
    }
}

// ========================================
// VALIDAR ROL ADMINISTRADOR
// ========================================

function requireAdmin(req, res, next) {
    console.log('VALIDANDO ADMINISTRADOR:', {
        email: req.user?.email,
        role: req.user?.role,
        url: req.originalUrl
    });

    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).send(
            'Esta sección es exclusiva del administrador.'
        );
    }

    return next();
}

// ========================================
// VALIDAR ROL TÉCNICO
// ========================================

function requireTechnician(req, res, next) {
    if (!req.user || req.user.role !== 'tecnico') {
        return res.status(403).send(
            'Esta sección es exclusiva del técnico.'
        );
    }

    return next();
}

// ========================================
// VALIDAR ROL USUARIO
// ========================================

function requireUser(req, res, next) {
    if (!req.user || req.user.role !== 'user') {
        return res.status(403).send(
            'Esta sección es exclusiva del usuario.'
        );
    }

    return next();
}

// ========================================
// VALIDAR PERSONAL DE TI
// ========================================

function requireStaff(req, res, next) {
    if (
        !req.user ||
        !['admin', 'tecnico'].includes(req.user.role)
    ) {
        return res.status(403).send(
            'No tienes permisos para realizar esta acción.'
        );
    }

    return next();
}

module.exports = {
    requireAuth,
    requireAdmin,
    requireTechnician,
    requireUser,
    requireStaff
};
