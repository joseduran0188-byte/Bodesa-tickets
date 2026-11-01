
const express = require('express');
const router = express.Router();

const {
  requireAuth,
  requireAdmin
} = require('../middleware/auth');

// Orden de prioridad
const ordenPrioridad = {
  alta: 1,
  media: 2,
  baja: 3
};

// Valores permitidos
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

    // Los usuarios normales solamente ven sus solicitudes
    if (req.user.role === 'user') {
      query = query.eq('solicitante_id', req.user.id);
    }

    const {
      data: tickets,
      error
    } = await query;

    if (error) throw error;

    // Ordenar por prioridad y fecha de creación
    const ticketsOrdenados = (tickets || []).sort((a, b) => {
      const prioridadA = ordenPrioridad[a.prioridad] || 99;
      const prioridadB = ordenPrioridad[b.prioridad] || 99;

      if (prioridadA !== prioridadB) {
        return prioridadA - prioridadB;
      }

      return new Date(a.fecha_creacion) -
        new Date(b.fecha_creacion);
    });

    res.render('dashboard', {
      user: req.user,
      tickets: ticketsOrdenados
    });

  } catch (err) {
    console.error('Error al cargar tickets:', err);

    res.status(500).send('Error al cargar los tickets');
  }
});


// =====================================================
// FORMULARIO NUEVO TICKET
// =====================================================

router.get('/nuevo', requireAuth, (req, res) => {
  res.render('ticket-nuevo', {
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

    // Validar campos obligatorios
    if (
      !titulo ||
      !descripcion ||
      !titulo.trim() ||
      !descripcion.trim()
    ) {
      return res.status(400).send(
        'El título y la descripción son obligatorios.'
      );
    }

    // Validar prioridad
    const prioridadFinal = prioridad || 'media';

    if (!prioridadesPermitidas.includes(prioridadFinal)) {
      return res.status(400).send('Prioridad no válida.');
    }

    // Insertar ticket
    const { error } = await supabase
      .from('tickets')
      .insert({
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        prioridad: prioridadFinal,
        categoria: categoria || null,
        solicitante_id: req.user.id,
        estado: 'pendiente'
      });

    if (error) throw error;

    res.redirect('/tickets');

  } catch (err) {
    console.error('Error al crear ticket:', err);

    res.status(500).send('Error al crear el ticket');
  }
});


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
      return res.status(404).send('Ticket no encontrado');
    }

    // Validar propietario del ticket
    if (
      req.user.role === 'user' &&
      ticket.solicitante_id !== req.user.id
    ) {
      return res.status(403).send(
        'No tienes permiso para ver este ticket.'
      );
    }

    res.render('ticket-detalle', {
      user: req.user,
      ticket
    });

  } catch (err) {
    console.error('Error al consultar ticket:', err);

    res.status(500).send('Error al consultar el ticket');
  }
});


// =====================================================
// ACTUALIZAR TICKET
// SOLO ADMINISTRADORES Y TÉCNICOS
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
        tecnico_asignado_id,
        observaciones
      } = req.body;

      const ticketId = req.params.id;

      // Validar estado
      if (!estadosPermitidos.includes(estado)) {
        return res.status(400).send('Estado no válido.');
      }

      // Validar prioridad
      if (!prioridadesPermitidas.includes(prioridad)) {
        return res.status(400).send('Prioridad no válida.');
      }

      // Consultar ticket actual
      const {
        data: actual,
        error: consultaError
      } = await supabase
        .from('tickets')
        .select('id, fecha_atencion, fecha_resolucion')
        .eq('id', ticketId)
        .single();

      if (consultaError || !actual) {
        return res.status(404).send('Ticket no encontrado.');
      }

      // Preparar actualización
      const updates = {
        estado,
        prioridad,
        observaciones: observaciones || null,
        updated_at: new Date().toISOString()
      };

      // Asignar técnico si se proporcionó uno
      if (tecnico_asignado_id !== undefined) {
        updates.tecnico_asignado_id =
          tecnico_asignado_id || null;
      }

      // Registrar primera fecha de atención
      if (
        estado === 'en_proceso' &&
        !actual.fecha_atencion
      ) {
        updates.fecha_atencion =
          new Date().toISOString();
      }

      // Registrar fecha de resolución
      if (
        estado === 'resuelto' ||
        estado === 'cerrado'
      ) {
        if (!actual.fecha_resolucion) {
          updates.fecha_resolucion =
            new Date().toISOString();
        }
      } else {
        updates.fecha_resolucion = null;
      }

      // Guardar cambios
      const {
        error: updateError
      } = await supabase
        .from('tickets')
        .update(updates)
        .eq('id', ticketId);

      if (updateError) throw updateError;

      res.redirect(`/tickets/${ticketId}`);

    } catch (err) {
      console.error('Error al actualizar ticket:', err);

      res.status(500).send('Error al actualizar el ticket');
    }
  }
);

module.exports = router;
