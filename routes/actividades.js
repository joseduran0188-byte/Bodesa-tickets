
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
    formatDate: (date) => {
      if (!date) return '—';

      return new Date(date).toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    },
    ...extra
  };
}

function textoOpcional(value) {
  const texto = String(value ?? '').trim();
  return texto || null;
}

const PRIORIDADES_VALIDAS = [
  'baja',
  'media',
  'alta',
  'urgente'
];

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
    console.error('ERROR DASHBOARD:', err);
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
// MI TRABAJO
// ========================================
router.get('/mi-trabajo', async (req, res) => {
  try {
    const { data: misActividades, error } = await req.supabase
      .from('activities')
      .select('*')
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
      .select('*')
      .in('status', [
        'disponible',
        'en_proceso',
        'pendiente_validacion',
        'devuelta',
        'validada'
      ])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('ERROR TABLERO:', error);
      return res.status(500).send(
        'No se pudo cargar el tablero'
      );
    }

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
        history:activity_history(
          *,
          actor:profiles!activity_history_actor_id_fkey(full_name, email)
        ),
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

    // Historial más reciente primero.
    activity.history = (activity.history || []).sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
    );

    return res.render(
      'actividades/detalle',
      renderData(req, {
        title: activity.title,
        activity
      })
    );

  } catch (err) {
    console.error('ERROR DETALLE:', err);
    return res.status(500).send('Error');
  }
});

// ========================================
// EDITAR ACTIVIDAD (SOLO ADMIN)
// ========================================
router.post('/:id/editar', requireAdmin, async (req, res) => {
  try {
    const activityId = req.params.id;

    // Obtener los datos actuales.
    const { data: anterior, error: readError } = await req.supabase
      .from('activities')
      .select('*')
      .eq('id', activityId)
      .maybeSingle();

    if (readError) {
      console.error('ERROR CONSULTANDO ACTIVIDAD PARA EDITAR:', readError);
      return res.status(500).send('No se pudo consultar la actividad');
    }

    if (!anterior) {
      return res.status(404).send('Actividad no encontrada');
    }

    if (anterior.status === 'cancelada') {
      return res.status(400).send(
        'No se pueden editar actividades canceladas'
      );
    }

    const title = String(req.body.title || '').trim();

    if (!title) {
      return res.status(400).send(
        'El título de la actividad es obligatorio'
      );
    }

    const priority = String(req.body.priority || '').toLowerCase();

    if (!PRIORIDADES_VALIDAS.includes(priority)) {
      return res.status(400).send('Prioridad no válida');
    }

    let quantity = null;

    if (
      req.body.quantity !== undefined &&
      String(req.body.quantity).trim() !== ''
    ) {
      quantity = Number(req.body.quantity);

      if (!Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).send(
          'La cantidad debe ser un entero mayor o igual a cero'
        );
      }
    }

    // Solamente se modifican los campos administrativos permitidos.
    const cambios = {
      title,
      requester_name: textoOpcional(req.body.requester_name),
      activity_type: textoOpcional(req.body.activity_type),
      quantity,
      priority,
      observations: textoOpcional(req.body.observations),
      updated_at: new Date().toISOString()
    };

    const camposAuditables = [
      'title',
      'requester_name',
      'activity_type',
      'quantity',
      'priority',
      'observations'
    ];

    const modificaciones = {};

    camposAuditables.forEach(campo => {
      const valorAnterior = anterior[campo] ?? null;
      const valorNuevo = cambios[campo] ?? null;

      if (valorAnterior !== valorNuevo) {
        modificaciones[campo] = {
          anterior: valorAnterior,
          nuevo: valorNuevo
        };
      }
    });

    if (Object.keys(modificaciones).length === 0) {
      return res.redirect(
        303,
        `${baseUrl(req)}/${activityId}`
      );
    }

    const { error: updateError } = await req.supabase
      .from('activities')
      .update(cambios)
      .eq('id', activityId);

    if (updateError) {
      console.error('ERROR ACTUALIZANDO ACTIVIDAD:', updateError);
      return res.status(500).send(
        'No se pudieron guardar los cambios'
      );
    }

    // Registrar los cambios en el historial.
    const { error: historyError } = await req.supabase
      .from('activity_history')
      .insert({
        activity_id: activityId,
        actor_id: req.user.id,
        action: 'actividad_editada',
        previous_status: anterior.status,
        new_status: anterior.status,
        comments: 'Actividad modificada por el administrador',
        metadata: {
          cambios: modificaciones
        }
      });

    if (historyError) {
      console.error('ERROR REGISTRANDO EDICIÓN EN HISTORIAL:', historyError);

      return res.status(500).send(
        'Los cambios se guardaron, pero no se pudo registrar la modificación en el historial. Contacta al administrador del sistema.'
      );
    }

    return res.redirect(
      303,
      `${baseUrl(req)}/${activityId}`
    );

  } catch (err) {
    console.error('ERROR EDITAR ACTIVIDAD:', err);
    return res.status(500).send('Error interno al editar actividad');
  }
});

// ========================================
// ELIMINACIÓN LÓGICA / CANCELAR ACTIVIDAD
// SOLO ADMIN
// ========================================
router.post('/:id/eliminar', requireAdmin, async (req, res) => {
  try {
    const activityId = req.params.id;
    const reason = String(
      req.body.cancellation_reason || ''
    ).trim();

    if (!reason) {
      return res.status(400).send(
        'Debes indicar el motivo de cancelación'
      );
    }

    const { data: anterior, error: readError } = await req.supabase
      .from('activities')
      .select('id, status, title')
      .eq('id', activityId)
      .maybeSingle();

    if (readError) {
      console.error('ERROR CONSULTANDO ACTIVIDAD PARA CANCELAR:', readError);
      return res.status(500).send(
        'No se pudo consultar la actividad'
      );
    }

    if (!anterior) {
      return res.status(404).send('Actividad no encontrada');
    }

    if (anterior.status === 'cancelada') {
      return res.status(400).send(
        'La actividad ya se encuentra cancelada'
      );
    }

    const ahora = new Date().toISOString();

    const { error: updateError } = await req.supabase
      .from('activities')
      .update({
        status: 'cancelada',
        canceled_at: ahora,
        cancellation_reason: reason,
        updated_at: ahora
      })
      .eq('id', activityId);

    if (updateError) {
      console.error('ERROR CANCELANDO ACTIVIDAD:', updateError);
      return res.status(500).send(
        'No se pudo cancelar la actividad'
      );
    }

    // Conservar trazabilidad de la cancelación.
    const { error: historyError } = await req.supabase
      .from('activity_history')
      .insert({
        activity_id: activityId,
        actor_id: req.user.id,
        action: 'actividad_cancelada',
        previous_status: anterior.status,
        new_status: 'cancelada',
        comments: reason,
        metadata: {
          cancellation_reason: reason,
          title: anterior.title
        }
      });

    if (historyError) {
      console.error('ERROR REGISTRANDO CANCELACIÓN:', historyError);

      return res.status(500).send(
        'La actividad fue cancelada, pero no se pudo registrar la acción en el historial. Contacta al administrador del sistema.'
      );
    }

    return res.redirect(
      303,
      `${baseUrl(req)}/${activityId}`
    );

  } catch (err) {
    console.error('ERROR ELIMINACIÓN LÓGICA:', err);
    return res.status(500).send(
      'Error interno al cancelar la actividad'
    );
  }
});

// ========================================
// DESVALIDAR ACTIVIDAD (SOLO ADMIN)
// validada -> disponible
// ========================================
router.post('/:id/desvalidar', requireAdmin, async (req, res) => {
  try {
    const activityId = req.params.id;
    const reason = String(req.body.reason || '').trim();

    if (!reason) {
      return res.status(400).send(
        'Debes indicar el motivo de la desvalidación'
      );
    }

    const { error } = await req.supabase.rpc(
      'desvalidar_actividad',
      {
        p_activity_id: activityId,
        p_reason: reason
      }
    );

    if (error) {
      console.error('ERROR DESVALIDAR ACTIVIDAD:', error);
      throw error;
    }

    return res.redirect(
      303,
      `${baseUrl(req)}/${activityId}`
    );

  } catch (err) {
    console.error('ERROR DESVALIDAR ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo desvalidar la actividad'
    );
  }
});

// ========================================
// REACTIVAR ACTIVIDAD CANCELADA (SOLO ADMIN)
// disponible o en_proceso con responsable anterior
// ========================================
router.post('/:id/reactivar', requireAdmin, async (req, res) => {
  try {
    const activityId = req.params.id;
    const reason = String(req.body.reason || '').trim();
    const mode = String(req.body.mode || '').trim();

    if (!reason) {
      return res.status(400).send(
        'Debes indicar el motivo de la reactivación'
      );
    }

    // disponible = reactivar sin responsable.
    // responsable = recuperar al responsable anterior.
    if (!['disponible', 'responsable'].includes(mode)) {
      return res.status(400).send(
        'Selecciona una modalidad de reactivación válida'
      );
    }

    const { error } = await req.supabase.rpc(
      'reactivar_actividad',
      {
        p_activity_id: activityId,
        p_keep_responsible: mode === 'responsable',
        p_reason: reason
      }
    );

    if (error) {
      console.error('ERROR RPC REACTIVAR ACTIVIDAD:', error);
      throw error;
    }

    return res.redirect(
      303,
      `${baseUrl(req)}/${activityId}`
    );

  } catch (err) {
    console.error('ERROR REACTIVAR ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo reactivar la actividad'
    );
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
    console.error('ERROR TOMAR ACTIVIDAD:', err);

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
    console.error('ERROR LIBERAR ACTIVIDAD:', err);

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
    console.error('ERROR TERMINAR ACTIVIDAD:', err);

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
    console.error('ERROR VALIDAR ACTIVIDAD:', err);

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

    if (error) throw error;

    return res.redirect(303, baseUrl(req));

  } catch (err) {
    console.error('ERROR DEVOLVER ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo devolver'
    );
  }
});

module.exports = router;
