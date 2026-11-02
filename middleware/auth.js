const { createClient } = require('@supabase/supabase-js');

const {
    getTabSession,
    updateActivity
} = require('../lib/session-manager');

async function requireAuth(req, res, next) {
    try {
        const sessionToken = req.params.sessionToken;

        if (!sessionToken) {
            return res.redirect('/login');
        }

        const tabSession = await getTabSession(sessionToken);

        if (!tabSession) {
            return res.redirect('/login?expired=1');
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY,
            {
                global: {
                    headers: {
                        Authorization: `Bearer ${tabSession.accessToken}`
                    }
                },
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                    detectSessionInUrl: false
                }
            }
        );

        const {
            data: { user },
            error: userError
        } = await supabase.auth.getUser();

        if (userError || !user || user.id !== tabSession.userId) {
            return res.redirect('/login?expired=1');
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, email, full_name, role, departamento')
            .eq('id', user.id)
            .single();

        if (profileError || !profile || profile.role !== tabSession.role) {
            return res.status(403).send('No tienes autorización para acceder.');
        }

        req.tabSession = tabSession;
        req.sessionToken = sessionToken;
        req.supabase = supabase;
        req.user = {
            ...user,
            ...profile
        };

        res.locals.user = req.user;
        res.locals.sessionToken = sessionToken;

        res.setHeader('Cache-Control', 'no-store, private');
        res.setHeader('Referrer-Policy', 'no-referrer');

        await updateActivity(sessionToken);

        next();

    } catch (error) {
        console.error('Error validando sesión:', error);
        return res.status(500).send('Error al validar la sesión.');
    }
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).send('No tienes permisos para realizar esta acción.');
        }

        next();
    };
}

const requireAdmin = requireRole('admin');
const requireTechnician = requireRole('tecnico');
const requireUser = requireRole('user');

function requireStaff(req, res, next) {
    if (!req.user || !['admin', 'tecnico'].includes(req.user.role)) {
        return res.status(403).send('No tienes permisos para realizar esta acción.');
    }

    next();
}

module.exports = {
    requireAuth,
    requireAdmin,
    requireTechnician,
    requireUser,
    requireStaff
};