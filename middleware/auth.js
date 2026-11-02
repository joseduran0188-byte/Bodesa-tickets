
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

function getSupabase(token) {
    return createClient(supabaseUrl, supabaseAnonKey, {
        global: {
            headers: {
                Authorization: `Bearer ${token}`
            }
        },
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}

async function requireAuth(req, res, next) {
    try {
        const token = req.cookies?.['sb-access-token'];

        if (!token) {
            return res.redirect('/login');
        }

        const supabase = getSupabase(token);

        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser(token);

        if (authError || !user) {
            res.clearCookie('sb-access-token', { path: '/' });
            return res.redirect('/login');
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, email, full_name, role, departamento')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            console.error('Error al consultar perfil:', profileError);
            return res.status(403).send(
                'No se encontró el perfil del usuario.'
            );
        }

        const rolesPermitidos = ['admin', 'tecnico', 'user'];

        if (!rolesPermitidos.includes(profile.role)) {
            return res.status(403).send('Rol no autorizado.');
        }

        req.supabase = supabase;

        req.user = {
            id: user.id,
            email: user.email,
            full_name: profile.full_name || '',
            role: profile.role,
            departamento: profile.departamento || ''
        };

        res.locals.user = req.user;

        console.log('Sesión verificada:', {
            email: req.user.email,
            role: req.user.role,
            url: req.originalUrl
        });

        return next();

    } catch (error) {
        console.error('Error en requireAuth:', error);
        return res.status(500).send('Error al verificar la sesión.');
    }
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).send(
            'Esta sección es exclusiva del administrador.'
        );
    }

    return next();
}

function requireTechnician(req, res, next) {
    if (!req.user || req.user.role !== 'tecnico') {
        return res.status(403).send(
            'Esta sección es exclusiva del técnico.'
        );
    }

    return next();
}

function requireUser(req, res, next) {
    if (!req.user || req.user.role !== 'user') {
        return res.status(403).send(
            'Esta sección es exclusiva del usuario.'
        );
    }

    return next();
}

function requireStaff(req, res, next) {
    if (!req.user || !['admin', 'tecnico'].includes(req.user.role)) {
        return res.status(403).send(
            'No tienes permisos para realizar esta acción.'
        );
    }

    return next();
}

function requireOnlyAdmin(req, res, next) {
    return requireAdmin(req, res, next);
}

module.exports = {
    requireAuth,
    requireAdmin,
    requireTechnician,
    requireUser,
    requireStaff,
    requireOnlyAdmin
};
