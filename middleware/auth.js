
const { createClient } = require('@supabase/supabase-js');

const {
    getTabSession,
    updateTabSessionTokens,
    updateActivity
} = require('../lib/session-manager');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function crearClienteUsuario(accessToken) {
    return createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
            global: {
                headers: {
                    Authorization: `Bearer ${accessToken}`
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

function crearClienteAuth() {
    return createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            }
        }
    );
}

async function obtenerUsuario(accessToken) {
    const supabase = crearClienteUsuario(accessToken);

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
        return {
            user: null,
            error
        };
    }

    return {
        user: data.user,
        supabase,
        error: null
    };
}

async function requireAuth(req, res, next) {
    try {
        res.setHeader('Cache-Control', 'no-store, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Referrer-Policy', 'no-referrer');

        const sessionToken = req.params.sessionToken;

        if (
            typeof sessionToken !== 'string' ||
            !/^[A-Za-z0-9_-]{40,100}$/.test(sessionToken)
        ) {
            return res.redirect('/login');
        }

        let tabSession = await getTabSession(sessionToken);

        if (!tabSession) {
            return res.redirect('/login?expired=1');
        }

        if (!tabSession.accessToken || !tabSession.refreshToken) {
            return res.redirect('/login?expired=1');
        }

        // Primero intentar validar el access token actual.
        let resultado = await obtenerUsuario(tabSession.accessToken);

        // Si ya expiró o dejó de ser válido, intentar renovarlo.
        if (!resultado.user) {
            const clienteAuth = crearClienteAuth();

            const { data: refreshData, error: refreshError } =
                await clienteAuth.auth.refreshSession({
                    refresh_token: tabSession.refreshToken
                });

            if (refreshError || !refreshData.session || !refreshData.user) {
                console.error(
                    'ERROR RENOVANDO SESIÓN:',
                    refreshError?.message || 'No se recibió una sesión nueva.'
                );

                return res.redirect('/login?expired=1');
            }

            // Guardar los nuevos tokens cifrados.
            const guardado = await updateTabSessionTokens(
                sessionToken,
                tabSession.refreshToken,
                refreshData.session
            );

            if (guardado) {
                tabSession.accessToken = refreshData.session.access_token;
                tabSession.refreshToken = refreshData.session.refresh_token;

                resultado = {
                    user: refreshData.user,
                    supabase: crearClienteUsuario(tabSession.accessToken),
                    error: null
                };
            } else {
                // Otra petición pudo haber renovado los tokens primero.
                tabSession = await getTabSession(sessionToken);

                if (!tabSession) {
                    return res.redirect('/login?expired=1');
                }

                resultado = await obtenerUsuario(tabSession.accessToken);

                if (!resultado.user) {
                    return res.redirect('/login?expired=1');
                }
            }
        }

        const user = resultado.user;

        if (user.id !== tabSession.userId) {
            return res.status(403).send(
                'La sesión no corresponde al usuario autenticado.'
            );
        }

        // Consultar el perfil actual para comprobar permisos.
        const { data: profile, error: profileError } = await resultado.supabase
            .from('profiles')
            .select('id, email, full_name, role, departamento')
            .eq('id', user.id)
            .single();

        if (
            profileError ||
            !profile ||
            profile.id !== tabSession.userId ||
            profile.role !== tabSession.role
        ) {
            return res.status(403).send(
                'No tienes autorización para acceder a este módulo.'
            );
        }

        req.tabSession = tabSession;
        req.sessionToken = sessionToken;
        req.supabase = resultado.supabase;
        req.user = {
            ...user,
            ...profile
        };

        res.locals.user = req.user;
        res.locals.sessionToken = sessionToken;

        await updateActivity(sessionToken);

        return next();

    } catch (error) {
        console.error('ERROR EN MIDDLEWARE AUTH:', error);

        return res.status(500).send(
            'Ocurrió un error al validar tu sesión.'
        );
    }
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).send(
                'No tienes permisos para acceder a esta sección.'
            );
        }

        next();
    };
}

const requireAdmin = requireRole('admin');
const requireTechnician = requireRole('tecnico');
const requireUser = requireRole('user');

function requireStaff(req, res, next) {
    if (
        !req.user ||
        !['admin', 'tecnico'].includes(req.user.role)
    ) {
        return res.status(403).send(
            'No tienes permisos para realizar esta acción.'
        );
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
