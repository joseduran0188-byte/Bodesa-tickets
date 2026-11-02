
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

// Verificar sesión y obtener el rol real desde Supabase
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
            return res.status(403).send(
                'No se encontró el perfil del usuario.'
            );
        }

        // No confiar en roles enviados desde el navegador.
        const rolesPermitidos = ['user', 'admin', 'tecnico'];

        if (!rolesPermitidos.includes(profile.role)) {
            return res.status(403).send('El rol de usuario no es válido.');
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

        return next();

    } catch (error) {
        console.error('Error en requireAuth:', error);
        return res.status(500).send('Error al verificar la sesión.');
    }
}

// Administrador y técnico pueden gestionar tickets.
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

// Exclusivo para administrador.
function requireOnlyAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).send(
            'Esta acción es exclusiva del administrador.'
        );
    }

    return next();
}

module.exports = {
    requireAuth,
    requireStaff,
    requireOnlyAdmin
};
