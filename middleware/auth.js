
const { createClient } = require('@supabase/supabase-js');

// =====================================================
// AUTENTICACIÓN
// =====================================================

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.['sb-access-token'];

    if (!token) {
      return res.redirect('/login');
    }

    // Verificar configuración de Supabase.
    if (
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_ANON_KEY
    ) {
      console.error('Faltan variables de entorno de Supabase.');
      return res.status(500).send(
        'Error de configuración del servidor.'
      );
    }

    // Crear cliente Supabase utilizando el token del usuario.
    // Las consultas estarán sujetas a las políticas RLS.
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

    // Validar el token con Supabase Auth.
    const {
      data: { user },
      error: authError
    } = await supabaseUser.auth.getUser(token);

    if (authError || !user) {
      console.error('Sesión inválida:', authError?.message);

      res.clearCookie('sb-access-token');

      return res.redirect('/login');
    }

    // Consultar el perfil del usuario.
    const {
      data: profile,
      error: profileError
    } = await supabaseUser
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error(
        'Error al consultar perfil:',
        profileError
      );

      return res.status(403).send(
        'No se encontró el perfil del usuario.'
      );
    }

    // Guardar el cliente autenticado para las rutas.
    req.supabase = supabaseUser;

    // Guardar los datos del usuario en la solicitud.
    req.user = {
      id: user.id,
      email: user.email,
      full_name: profile.full_name,
      role: profile.role
    };

    return next();

  } catch (err) {
    console.error('Error en requireAuth:', err);

    return res.status(500).send(
      'Error de autenticación.'
    );
  }
}

// =====================================================
// ADMINISTRADORES Y TÉCNICOS
// Para actualizar y administrar solicitudes.
// =====================================================

function requireAdmin(req, res, next) {
  if (
    !req.user ||
    !['admin', 'tecnico'].includes(req.user.role)
  ) {
    return res.status(403).send(
      'Acceso denegado. Solo administradores y técnicos.'
    );
  }

  return next();
}

// =====================================================
// SOLAMENTE ADMINISTRADORES
// Para eliminar solicitudes.
// =====================================================

function requireOnlyAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).send(
      'Acceso denegado. Solo los administradores pueden realizar esta acción.'
    );
  }

  return next();
}

// =====================================================
// EXPORTAR MIDDLEWARES
// =====================================================

module.exports = {
  requireAuth,
  requireAdmin,
  requireOnlyAdmin
};
