
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const {
  requireAuth,
  requireStaff,
  requireAdmin
} = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireStaff);

// ========================================
// CLIENTE ADMINISTRATIVO DE SUPABASE
// Se utiliza para generar URLs firmadas.
// ========================================
let supabaseAdmin = null;

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return supabaseAdmin;
}

// ========================================
// UTILIDADES
// ========================================
function baseUrl(req) {
  return `/sesion/${encodeURIComponent(req.params.sessionToken)}/actividades`;
}

function renderData(req, extra = {}) {
  return {
    user: req.user,
    sessionToken: req.params.sessionToken,
    dashboardUrl: baseUrl(req),
    logoutUrl: `/sesion/${encodeURIComponent(req.params.sessionToken)}/logout`,
    ...extra
  };
}

// ========================================
// DASHBOARD DE ACTIVIDADES
// ========================================
router.get('/', async (req, res) => {
  try {
    const { data: activities, error } = await req.supabase
      .from('activities')
      .select(`
        *,
        current_responsible:profiles!activities_current_responsible_id_fkey(full_name, email)
      `)
      .order('received_at', {
        ascending: false,
        nullsFirst: false
      })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('ERROR DASHBOARD ACTIVIDADES:', error);
      return res.status(500).send('Error al cargar actividades');
    }

    return res.render(
      'actividades/dashboard',
      renderData(req, {
        title: 'Capturas / Actividades',
        activities: activities || []
      })
    );

  } catch (err) {
    console.error(err);
    return res.status(500).send('Error interno');
  }
});

// ========================================
// MÉTRICAS DE PRODUCTIVIDAD
// ========================================
router.get('/metricas', async (req, res) => {
  try {
    const diasSolicitados = Number.parseInt(req.query.dias, 10);

    const dias = Number.isInteger(diasSolicitados)
      ? Math.min(Math.max(diasSolicitados, 1), 365)
      : 30;

    const { data: metricas, error } = await req.supabase
      .rpc('metricas_productividad', {
        p_dias: dias
      });

    if (error) {
      console.error('ERROR MÉTRICAS:', error);
      return res.status(500).send(
        'No se pudieron cargar las métricas'
      );
    }

    const totales = (metricas || []).reduce(
      (acc, m) => {
        acc.tomadas += Number(m.tomadas) || 0;
        acc.terminadas += Number(m.terminadas) || 0;
        acc.validadas += Number(m.validadas) || 0;
        acc.liberadas += Number(m.liberadas) || 0;

        return acc;
      },
      {
        tomadas: 0,
        terminadas: 0,
        validadas: 0,
        liberadas: 0
      }
    );

    return res.render(
      'actividades/metricas',
      renderData(req, {
        title: 'Métricas de Productividad',
        metricas: metricas || [],
        totales,
        dias
      })
    );

  } catch (err) {
    console.error('ERROR INTERNO MÉTRICAS:', err);
    return res.status(500).send('Error interno');
  }
});

// ========================================
// MI TRABAJO (REEMPLAZO DE PLANNER)
// ========================================
router.get('/mi-trabajo', async (req, res) => {
  try {
    const { data: misActividades, error } = await req.supabase
      .from('activities')
      .select(`
        *,
        current_responsible:profiles!activities_current_responsible_id_fkey(full_name, email)
      `)
      .eq('current_responsible_id', req.user.id)
      .in('status', [
        'en_proceso',
        'pendiente_validacion',
        'devuelta'
      ])
      .order('started_at', { ascending: false });

    if (error) {
      console.error('ERROR MI TRABAJO:', error);
      return res.status(500).send(
        'No se pudieron cargar tus actividades'
      );
    }

    return res.render(
      'actividades/mi-trabajo',
      renderData(req, {
        title: 'Mi trabajo',
        misActividades: misActividades || []
      })
    );

  } catch (err) {
    console.error('ERROR INTERNO MI TRABAJO:', err);
    return res.status(500).send('Error interno');
  }
});

// ========================================
// TABLERO KANBAN
// ========================================
router.get('/tablero', async (req, res) => {
  try {
    const { data: activities, error } = await req.supabase
      .from('activities')
      .select(`
        id,
        title,
        requester_name,
        activity_type,
        quantity,
        priority,
        status,
        started_at,
        submitted_at,
        current_responsible_id,
        current_responsible:profiles!activities_current_responsible_id_fkey(full_name)
      `)
      .in('status', [
        'disponible',
        'en_proceso',
        'pendiente_validacion',
        'devuelta',
        'validada'
      ])
      .order('priority', { ascending: false })
      .order('received_at', { ascending: false });

    if (error) {
      console.error('ERROR TABLERO:', error);
      return res.status(500).send(
        'No se pudo cargar el tablero'
      );
    }

    // Agrupar actividades por estado
    const columnas = {
      disponible: [],
      en_proceso: [],
      pendiente_validacion: [],
      devuelta: [],
      validada: []
    };

    (activities || []).forEach(act => {
      if (columnas[act.status]) {
        columnas[act.status].push(act);
      }
    });

    return res.render(
      'actividades/tablero',
      renderData(req, {
        title: 'Tablero de Capturas',
        columnas
      })
    );

  } catch (err) {
    console.error('ERROR INTERNO TABLERO:', err);
    return res.status(500).send('Error interno');
  }
});

// ========================================
// DETALLE DE ACTIVIDAD
// ========================================
router.get('/:id', async (req, res) => {
  try {
    const { data: activity, error } = await req.supabase
      .from('activities')
      .select(`
        *,
        current_responsible:profiles!activities_current_responsible_id_fkey(full_name, email),
        history:activity_history(*, actor:profiles(full_name)),
        attachments:activity_attachments(*)
      `)
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) {
      console.error('ERROR AL CARGAR DETALLE:', error);
      return res.status(500).send(
        'Error al cargar la actividad'
      );
    }

    if (!activity) {
      return res.status(404).send('Actividad no encontrada');
    }

    return res.render(
      'actividades/detalle',
      renderData(req, {
        title: activity.title,
        activity
      })
    );

  } catch (err) {
    console.error(err);
    return res.status(500).send('Error');
  }
});

// ========================================
// DESCARGAR ADJUNTO
// ========================================
router.get('/:id/adjunto/:attachmentId', async (req, res) => {
  try {
    const { data: att, error } = await req.supabase
      .from('activity_attachments')
      .select('id, activity_id, file_path')
      .eq('id', req.params.attachmentId)
      .eq('activity_id', req.params.id)
      .maybeSingle();

    if (error) {
      console.error('ERROR AL BUSCAR ADJUNTO:', error);
      return res.status(500).send(
        'Error al consultar el archivo'
      );
    }

    if (!att) {
      return res.status(404).send('Archivo no encontrado');
    }

    if (!att.file_path) {
      return res.status(404).send(
        'El archivo no tiene una ruta válida'
      );
    }

    const admin = getSupabaseAdmin();

    const { data: signed, error: signError } = await admin.storage
      .from('activity-attachments')
      .createSignedUrl(att.file_path, 60);

    if (signError || !signed?.signedUrl) {
      console.error(
        'ERROR AL GENERAR URL FIRMADA:',
        signError
      );

      return res.status(500).send(
        'No se pudo generar el enlace de descarga'
      );
    }

    res.setHeader('Cache-Control', 'no-store, private');

    return res.redirect(302, signed.signedUrl);

  } catch (err) {
    console.error('ERROR AL DESCARGAR ADJUNTO:', err);

    return res.status(500).send(
      'Error al descargar el archivo'
    );
  }
});

// ========================================
// TOMAR ACTIVIDAD
// ========================================
router.post('/:id/tomar', async (req, res) => {
  try {
    const { error } = await req.supabase.rpc('tomar_actividad', {
      p_activity_id: req.params.id
    });

    if (error) throw error;

    return res.redirect(
      303,
      `${baseUrl(req)}/${req.params.id}`
    );

  } catch (err) {
    console.error(err);

    return res.status(400).send(
      err.message || 'No se pudo tomar la actividad'
    );
  }
});

// ========================================
// LIBERAR ACTIVIDAD
// ========================================
router.post('/:id/liberar', async (req, res) => {
  try {
    const { error } = await req.supabase.rpc('liberar_actividad', {
      p_activity_id: req.params.id,
      p_reason: req.body.reason || null
    });

    if (error) throw error;

    return res.redirect(303, baseUrl(req));

  } catch (err) {
    console.error(err);

    return res.status(400).send(
      err.message || 'No se pudo liberar'
    );
  }
});

// ========================================
// MARCAR ACTIVIDAD COMO TERMINADA
// ========================================
router.post('/:id/terminar', async (req, res) => {
  try {
    const { error } = await req.supabase.rpc('marcar_terminada', {
      p_activity_id: req.params.id
    });

    if (error) throw error;

    return res.redirect(
      303,
      `${baseUrl(req)}/${req.params.id}`
    );

  } catch (err) {
    console.error(err);

    return res.status(400).send(
      err.message || 'No se pudo marcar terminada'
    );
  }
});

// ========================================
// VALIDAR ACTIVIDAD (SOLO ADMIN)
// ========================================
router.post('/:id/validar', requireAdmin, async (req, res) => {
  try {
    const { error } = await req.supabase.rpc('validar_actividad', {
      p_activity_id: req.params.id
    });

    if (error) throw error;

    return res.redirect(303, baseUrl(req));

  } catch (err) {
    console.error(err);

    return res.status(400).send(
      err.message || 'No se pudo validar'
    );
  }
});

// ========================================
// DEVOLVER ACTIVIDAD (SOLO ADMIN)
// ========================================
router.post('/:id/devolver', requireAdmin, async (req, res) => {
  try {
    const { error } = await req.supabase.rpc('devolver_actividad', {
      p_activity_id: req.params.id,
      p_reason: req.body.reason || 'Devuelta'
    });

    if (error) throw err;

    return res.redirect(303, baseUrl(req));

  } catch (err) {
    console.error(err);

    return res.status(400).send(
      err.message || 'No se pudo devolver'
    );
  }
});

module.exports = router;
