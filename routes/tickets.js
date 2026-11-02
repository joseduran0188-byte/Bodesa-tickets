
const express = require('express');
const router = express.Router();

const {
  requireAuth,
  requireAdmin,
  requireOnlyAdmin
} = require('../middleware/auth');

// =====================================================
// CONFIGURACIÓN
// =====================================================

const ordenPrioridad = {
  alta: 1,
  media: 2,
  baja: 3
};

const prioridadesPermitidas = ['alta', 'media', 'baja'];

const estadosPermitidos = [
  'pendiente',
  'en_proceso',
  'resuelto',
  'cerrado'
];

// =====================================================
// LISTAR TICKETS
// =====================================================

router.get('/', requireAuth, async (req, res) => {
  try {
    const supabase = req.supabase;

    let query = supabase
      .from('tickets')
      .select(`
        *,
        solicitante:profiles!solicitante_id (
          full_name,
          email
        ),
        tecnico:profiles!tecnico_asignado_id (
          full_name
        )
      `);

    // Los usuarios normales solamente ven sus solicitudes.
    if (req.user.role === 'user') {
      query = query.eq('solicitante_id', req.user.id);
    }

    const { data: tickets, error } = await query;

    if (error) throw error;

    // Ordenar por prioridad y fecha de creación.
    const ticketsOrdenados = (tickets || []).sort((a, b) => {
      const prioridadA = ordenPrioridad[a.prioridad] || 99;
      const prioridadB = ordenPrioridad[b.prioridad] || 99;

      if (prioridadA !== prioridadB) {
        return prioridadA - prioridadB;
      }

      return new Date(a.fecha_creacion) -
        new Date(b.fecha_creacion);
    });

    return res.render('dashboard', {
      user: req.user,
      tickets: ticketsOrdenados
    });

  } catch (err) {
    console.error('Error al cargar tickets:', err);
    return res.status(500).send('Error al cargar los tickets.');
  }
});

// =====================================================
// FORMULARIO NUEVO TICKET
// =====================================================

router.get('/nuevo', requireAuth, (req, res) => {
  return res.render('ticket-nuevo', {
    user: req.user
  });
});

// =====================================================
// CREAR TICKET
// =====================================================

router.post('/nuevo', requireAuth, async (req, res) => {
  try {
    const supabase = req.supabase;

    const {
      titulo,
      descripcion,
      prioridad,
      categoria
    } = req.body;

    // Validar campos obligatorios.
    if (
      typeof titulo !== 'string' ||
      typeof descripcion !== 'string' ||
      !titulo.trim() ||
      !descripcion.trim()
    ) {
      return res.status(400).send(
        'El título y la descripción son obligatorios.'
      );
    }

    if (titulo.trim().length > 200) {
      return res.status(400).send(
        'El título no puede superar los 200 caracteres.'
      );
    }

    if (descripcion.trim().length > 5000) {
      return res.status(400).send(
        'La descripción no puede superar los 5000 caracteres.'
      );
    }

    const prioridadFinal = prioridad || 'media';

    if (!prioridadesPermitidas.includes(prioridadFinal)) {
      return res.status(400).send('Prioridad no válida.');
    }

    const { error } = await supabase
      .from('tickets')
      .insert({
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        prioridad: prioridadFinal,
        categoria: typeof categoria === 'string'
          ? categoria.trim() || null
          : null,
        solicitante_id: req.user.id,
        estado: 'pendiente',
        responsable: null
      });

    if (error) throw error;

    return res.redirect('/tickets');

  } catch (err) {
    console.error('Error al crear ticket:', err);
    return res.status(500).send('Error al crear el ticket.');
  }
});

// =====================================================
// EDITAR DESCRIPCIÓN
// PROPIETARIO, ADMINISTRADOR O TÉCNICO
// =====================================================

router.post(
  '/:id/editar-descripcion',
  requireAuth,
  async (req, res) => {
    try {
      const supabase = req.supabase;
      const ticketId = req.params.id;
      const { descripcion } = req.body;

      if (
        typeof descripcion !== 'string' ||
        !descripcion.trim()
      ) {
        return res.status(400).send(
          'La descripción no puede estar vacía.'
        );
      }

      if (descripcion.trim().length > 5000) {
        return res.status(400).send(
          'La descripción no puede superar los 5000 caracteres.'
        );
      }

      // Consultar el propietario del ticket.
      const {
        data: ticket,
        error: consultaError
      } = await supabase
        .from('tickets')
        .select('id, solicitante_id')
        .eq('id', ticketId)
        .single();

      if (consultaError || !ticket) {
        console.error('Error al consultar ticket:', consultaError);
        return res.status(404).send('Ticket no encontrado.');
      }

      const esPropietario =
        ticket.solicitante_id === req.user.id;

      const esPersonalTI =
        ['admin', 'tecnico'].includes(req.user.role);

      if (!esPropietario && !esPersonalTI) {
        return res.status(403).send(
          'No tienes permiso para editar este ticket.'
        );
      }

      const {
        data: actualizado,
        error: updateError
      } = await supabase
        .from('tickets')
        .update({
          descripcion: descripcion.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', ticketId)
        .select('id')
        .single();

      if (updateError) throw updateError;

      if (!actualizado) {
        return res.status(403).send(
          'No fue posible actualizar el ticket. Verifica los permisos.'
        );
      }

      return res.redirect(`/tickets/${ticketId}`);

    } catch (err) {
      console.error('Error al editar descripción:', err);

      return res.status(500).send(
        'Error al actualizar la descripción del ticket.'
      );
    }
  }
);

// =====================================================
// ELIMINAR TICKET
// EXCLUSIVAMENTE ADMINISTRADORES
// =====================================================

router.post(
  '/:id/eliminar',
  requireAuth,
  requireOnlyAdmin,
  async (req, res) => {
    try {
      const supabase = req.supabase;
      const ticketId = req.params.id;

      // Comprobar que el ticket existe y es visible
      // para el usuario autenticado.
      const {
        data: ticket,
        error: consultaError
      } = await supabase
        .from('tickets')
        .select('id')
        .eq('id', ticketId)
        .maybeSingle();

      if (consultaError) {
        console.error(
          'Error al consultar ticket antes de eliminar:',
          consultaError
        );

        throw consultaError;
      }

      if (!ticket) {
        return res.status(404).send('Ticket no encontrado.');
      }

      // Eliminar ticket utilizando el JWT del administrador.
      // Supabase aplicará las políticas RLS.
      const {
        data: eliminados,
        error: deleteError
      } = await supabase
        .from('tickets')
        .delete()
        .eq('id', ticketId)
        .select('id');

      if (deleteError) {
        console.error('Error de Supabase al eliminar:', {
          message: deleteError.message,
          details: deleteError.details,
          hint: deleteError.hint,
          code: deleteError.code
        });

        throw deleteError;
      }

      if (!eliminados || eliminados.length === 0) {
        console.error(
          'Supabase no eliminó filas. Revisa la política DELETE de RLS.'
        );

        return res.status(403).send(
          'Supabase no permitió eliminar el ticket. Revisa la política DELETE de RLS.'
        );
      }

      console.log(
        `Ticket ${ticketId} eliminado por el administrador ${req.user.email}`
      );

      return res.redirect('/tickets');

    } catch (err) {
      console.error('Error al eliminar ticket:', err);

      return res.status(500).send(
        'Error al eliminar el ticket. Revisa la terminal del servidor.'
      );
    }
  }
);

// =====================================================
// VER DETALLE DE UN TICKET
// =====================================================

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const supabase = req.supabase;

    const {
      data: ticket,
      error
    } = await supabase
      .from('tickets')
      .select(`
        *,
        solicitante:profiles!solicitante_id (
          full_name,
          email
        ),
        tecnico:profiles!tecnico_asignado_id (
          full_name
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !ticket) {
      console.error('Error al consultar detalle:', error);
      return res.status(404).send('Ticket no encontrado.');
    }

    // Los usuarios normales solamente pueden consultar sus tickets.
    if (
      req.user.role === 'user' &&
      ticket.solicitante_id !== req.user.id
    ) {
      return res.status(403).send(
        'No tienes permiso para ver este ticket.'
      );
    }

    return res.render('ticket-detalle', {
      user: req.user,
      ticket,
      editarDescripcion: req.query.editar === '1'
    });

  } catch (err) {
    console.error('Error al consultar ticket:', err);
    return res.status(500).send('Error al consultar el ticket.');
  }
});

// =====================================================
// ACTUALIZAR TICKET
// ADMINISTRADORES Y TÉCNICOS
// =====================================================

router.post(
  '/:id/actualizar',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const supabase = req.supabase;

      const {
        estado,
        prioridad,
        responsable,
        observaciones
      } = req.body;

      const ticketId = req.params.id;

      // Validar estado.
      if (
        typeof estado !== 'string' ||
        !estadosPermitidos.includes(estado)
      ) {
        return res.status(400).send('Estado no válido.');
      }

      // Validar prioridad.
      if (
        typeof prioridad !== 'string' ||
        !prioridadesPermitidas.includes(prioridad)
      ) {
        return res.status(400).send('Prioridad no válida.');
      }

      // Validar responsable escrito manualmente.
      if (
        responsable !== undefined &&
        typeof responsable !== 'string'
      ) {
        return res.status(400).send('Nombre del responsable no válido.');
      }

      const responsableFinal =
        typeof responsable === 'string'
          ? responsable.trim()
          : '';

      if (responsableFinal.length > 100) {
        return res.status(400).send(
          'El nombre del responsable no puede superar los 100 caracteres.'
        );
      }

      // Validar observaciones.
      if (
        observaciones !== undefined &&
        typeof observaciones !== 'string'
      ) {
        return res.status(400).send('Observaciones no válidas.');
      }

      const observacionesFinal =
        typeof observaciones === 'string'
          ? observaciones.trim()
          : '';

      if (observacionesFinal.length > 5000) {
        return res.status(400).send(
          'Las observaciones no pueden superar los 5000 caracteres.'
        );
      }

      // Consultar ticket actual para conservar sus fechas.
      const {
        data: actual,
        error: consultaError
      } = await supabase
        .from('tickets')
        .select('id, fecha_atencion, fecha_resolucion')
        .eq('id', ticketId)
        .single();

      if (consultaError || !actual) {
        console.error('Error al consultar ticket:', consultaError);
        return res.status(404).send('Ticket no encontrado.');
      }

      const ahora = new Date().toISOString();

      // Preparar actualización.
      const updates = {
        estado,
        prioridad,

        // Nombre escrito manualmente por la persona de TI.
        responsable: responsableFinal || null,

        observaciones: observacionesFinal || null,
        updated_at: ahora
      };

      // Registrar primera fecha de atención.
      if (
        estado === 'en_proceso' &&
        !actual.fecha_atencion
      ) {
        updates.fecha_atencion = ahora;
      }

      // Registrar fecha de resolución.
      if (['resuelto', 'cerrado'].includes(estado)) {
        if (!actual.fecha_resolucion) {
          updates.fecha_resolucion = ahora;
        }
      } else {
        updates.fecha_resolucion = null;
      }

      const {
        data: actualizado,
        error: updateError
      } = await supabase
        .from('tickets')
        .update(updates)
        .eq('id', ticketId)
        .select('id')
        .single();

      if (updateError) throw updateError;

      if (!actualizado) {
        return res.status(403).send(
          'No fue posible actualizar el ticket. Verifica los permisos de Supabase.'
        );
      }

      console.log(
        `Ticket ${ticketId} actualizado. Responsable: ${responsableFinal || 'Sin asignar'}`
      );

      return res.redirect(`/tickets/${ticketId}`);

    } catch (err) {
      console.error('Error al actualizar ticket:', {
        message: err.message,
        details: err.details,
        hint: err.hint,
        code: err.code
      });

      return res.status(500).send(
        'Error al actualizar el ticket.'
      );
    }
  }
);

module.exports = router;
