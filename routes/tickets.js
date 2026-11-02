
const express = require('express');
const router = express.Router();

const {
  requireAuth,
  requireAdmin
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

    // Los usuarios normales solamente ven sus solicitudes
    if (req.user.role === 'user') {
      query = query.eq('solicitante_id', req.user.id);
    }

    const { data: tickets, error } = await query;

    if (error) throw error;

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

      // Consultar propietario del ticket
      const { data: ticket, error: consultaError } = await supabase
        .from('tickets')
        .select('id, solicitante_id')
        .eq('id', ticketId)
        .single();

      if (consultaError || !ticket) {
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

      const { error: updateError } = await supabase
        .from('tickets')
        .update({
          descripcion: descripcion.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', ticketId);

      if (updateError) throw updateError;

      res.redirect(`/tickets/${ticketId}`);

    } catch (err) {
      console.error('Error al editar descripción:', err);
      res.status(500).send(
        'Error al actualizar la descripción del ticket.'
      );
    }
  }
);

// =====================================================
// ELIMINAR TICKET
// SOLAMENTE ADMINISTRADORES
// =====================================================

router.post(
  '/:id/eliminar',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const supabase = req.supabase;
      const ticketId = req.params.id;

      const { data: ticket, error: consultaError } = await supabase
        .from('tickets')
        .select('id')
        .eq('id', ticketId)
        .single();

      if (consultaError || !ticket) {
        return res.status(404).send('Ticket no encontrado.');
      }

      const { error: deleteError } = await supabase
        .from('tickets')
        .delete()
        .eq('id', ticketId);

      if (deleteError) throw deleteError;

      res.redirect('/tickets');

    } catch (err) {
      console.error('Error al eliminar ticket:', err);
      res.status(500).send('Error al eliminar el ticket.');
    }
  }
);

// =====================================================
// VER DETALLE DE UN TICKET
// =====================================================

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const supabase = req.supabase;

    const { data: ticket, error } = await supabase
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
      return res.status(404).send('Ticket no encontrado.');
    }

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
        tecnico_asignado_id,
        observaciones
      } = req.body;

      const ticketId = req.params.id;

      if (!estadosPermitidos.includes(estado)) {
        return res.status(400).send('Estado no válido.');
      }

      if (!prioridadesPermitidas.includes(prioridad)) {
        return res.status(400).send('Prioridad no válida.');
      }

      const { data: actual, error: consultaError } = await supabase
        .from('tickets')
        .select('id, fecha_atencion, fecha_resolucion')
        .eq('id', ticketId)
        .single();

      if (consultaError || !actual) {
        return res.status(404).send('Ticket no encontrado.');
      }

      const updates = {
        estado,
        prioridad,
        observaciones: observaciones
          ? observaciones.trim()
          : null,
        updated_at: new Date().toISOString()
      };

      if (tecnico_asignado_id !== undefined) {
        updates.tecnico_asignado_id =
          tecnico_asignado_id || null;
      }

      if (
        estado === 'en_proceso' &&
        !actual.fecha_atencion
      ) {
        updates.fecha_atencion = new Date().toISOString();
      }

      if (['resuelto', 'cerrado'].includes(estado)) {
        if (!actual.fecha_resolucion) {
          updates.fecha_resolucion = new Date().toISOString();
        }
      } else {
        updates.fecha_resolucion = null;
      }

      const { error: updateError } = await supabase
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
