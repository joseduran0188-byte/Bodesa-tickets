
const { createClient } = require('@supabase/supabase-js');

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies['sb-access-token'];

    if (!token) {
      return res.redirect('/login');
    }

    // Crear cliente Supabase con el token del usuario
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
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }
    );

    // Validar sesión
    const {
      data: { user },
      error: authError
    } = await supabaseUser.auth.getUser(token);

    if (authError || !user) {
      res.clearCookie('sb-access-token');
      return res.redirect('/login');
    }

    // Consultar perfil
    const { data: profile, error: profileError } = await supabaseUser
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Error al consultar perfil:', profileError);
      return res.status(403).send('No se encontró el perfil del usuario.');
    }

    // IMPORTANTE: guardar el cliente en la solicitud
    req.supabase = supabaseUser;

    // Guardar información del usuario
    req.user = {
      id: user.id,
      email: user.email,
      ...profile
    };

    return next();

  } catch (err) {
    console.error('Error en requireAuth:', err);
    return res.status(500).send('Error de autenticación.');
  }
}

// Permitir acceso a administradores y técnicos
function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'tecnico'].includes(req.user.role)) {
    return res.status(403).send(
      'Acceso denegado. Solo administradores y técnicos.'
    );
  }

  return next();
}

module.exports = {
  requireAuth,
  requireAdmin
};
