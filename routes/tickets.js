
const express = require('express');
const router = express.Router();

const {
    requireAuth,
    requireStaff,
    requireOnlyAdmin
} = require('../middleware/auth');

// ============================================
// 1. LISTADO DE TICKETS
// ============================================

router.get('/', requireAuth, async (req, res) => {
    try {
        let query = req.supabase
            .from('tickets')
            .select(`
                *,
                solicitante:profiles!solicitante_id (
                    full_name,
                    email
                )
            `)
            .order('created_at', { ascending: false });

        // Los usuarios normales solo ven sus propios tickets.
        if (req.user.role === 'user') {
            query = query.eq('solicitante_id', req.user.id);
        }

        const { data: tickets, error } = await query;

        if (error) {
            console.error('Error al consultar tickets:', error);
            return res.status(500).send(
                'No se pudieron cargar los tickets.'
            );
        }

        return res.render('dashboard', {
            title: 'Panel de tickets',
            user: req.user,
            tickets: tickets || []
        });

    } catch (error) {
        console.error('Error en listado:', error);
        return res.status(500).send('Error al cargar el panel.');
    }
});


// ============================================
// 2. FORMULARIO DE NUEVO TICKET
// ============================================

router.get('/nuevo', requireAuth, (req, res) => {
    return res.render('ticket-nuevo', {
        title: 'Nuevo ticket',
        user: req.user,
        error: null
    });
});


// ============================================
// 3. CREAR TICKET
// ============================================

router.post('/nuevo', requireAuth, async (req, res) => {
    try {
        const {
            titulo,
            descripcion,
            prioridad,
            categoria,
            nombre_solicitante
        } = req.body;

        const nombre = typeof nombre_solicitante === 'string'
            ? nombre_solicitante.trim()
            : '';

        const tituloLimpio = typeof titulo === 'string'
            ? titulo.trim()
            : '';

        const descripcionLimpia = typeof descripcion === 'string'
            ? descripcion.trim()
            : '';

        if (!nombre || !tituloLimpio || !descripcionLimpia) {
            return res.status(400).render('ticket-nuevo', {
                title: 'Nuevo ticket',
                user: req.user,
                error: 'Completa el nombre del solicitante, título y descripción.'
            });
        }

        if (nombre.length > 150) {
            return res.status(400).render('ticket-nuevo', {
                title: 'Nuevo ticket',
                user: req.user,
                error: 'El nombre del solicitante no debe superar 150 caracteres.'
            });
        }

        const prioridadesPermitidas = [
            'baja',
            'media',
            'alta',
            'urgente'
        ];

        const categoriasPermitidas = [
            'general',
            'software',
            'hardware',
            'redes',
            'sistemas',
            'accesos',
            'otro'
        ];

        const prioridadFinal = prioridadesPermitidas.includes(prioridad)
            ? prioridad
            : 'media';

        const categoriaFinal = categoriasPermitidas.includes(categoria)
            ? categoria
            : 'general';

        const nuevoTicket = {
            titulo: tituloLimpio,
            descripcion: descripcionLimpia,
            nombre_solicitante: nombre,
            prioridad: prioridadFinal,
            categoria: categoriaFinal,
            solicitante_id: req.user.id,
            estado: 'pendiente',
            responsable: null
        };

        const { error } = await req.supabase
            .from('tickets')
            .insert(nuevoTicket);

        if (error) {
            console.error('Error al crear ticket:', error);

            return res.status(500).render('ticket-nuevo', {
                title: 'Nuevo ticket',
                user: req.user,
                error: 'No se pudo registrar el ticket.'
            });
        }

        return res.redirect('/tickets');

    } catch (error) {
        console.error('Error al crear ticket:', error);
        return res.status(500).send('Error al crear el ticket.');
    }
});


// ============================================
// 4. DETALLE DE TICKET
// ============================================

router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { data: ticket, error } = await req.supabase
            .from('tickets')
            .select(`
                *,
                solicitante:profiles!solicitante_id (
                    full_name,
                    email
                )
            `)
            .eq('id', req.params.id)
            .single();

        if (error || !ticket) {
            return res.status(404).send('Ticket no encontrado.');
        }

        // Seguridad adicional para usuarios normales.
        if (
            req.user.role === 'user' &&
            ticket.solicitante_id !== req.user.id
        ) {
            return res.status(403).send(
                'No tienes permiso para consultar este ticket.'
            );
        }

        return res.render('ticket-detalle', {
            title: `Ticket #${ticket.id}`,
            user: req.user,
            ticket,
            editarDescripcion: req.query.editar === '1'
        });

    } catch (error) {
        console.error('Error al consultar ticket:', error);
        return res.status(500).send('Error al consultar el ticket.');
    }
});


// ============================================
// 5. EDITAR DESCRIPCIÓN
// Usuario propietario, técnico o administrador
// ============================================

router.post('/:id/editar-descripcion', requireAuth, async (req, res) => {
    try {
        const descripcion = typeof req.body.descripcion === 'string'
            ? req.body.descripcion.trim()
            : '';

        if (!descripcion) {
            return res.status(400).send(
                'La descripción no puede estar vacía.'
            );
        }

        const { data: ticket, error: findError } = await req.supabase
            .from('tickets')
            .select('id, solicitante_id')
            .eq('id', req.params.id)
            .single();

        if (findError || !ticket) {
            return res.status(404).send('Ticket no encontrado.');
        }

        const esPropietario = ticket.solicitante_id === req.user.id;

        const esPersonal = ['admin', 'tecnico'].includes(req.user.role);

        if (!esPropietario && !esPersonal) {
            return res.status(403).send(
                'No tienes permiso para editar este ticket.'
            );
        }

        let error;

        if (req.user.role === 'user') {

            // Usuario normal: solo puede editar la descripción
            // mediante la función segura de Supabase.

            const result = await req.supabase.rpc(
                'update_ticket_description',
                {
                    p_ticket_id: ticket.id,
                    p_description: descripcion
                }
            );

            error = result.error;

        } else {

            // Administrador o técnico: actualización normal.

            const result = await req.supabase
                .from('tickets')
                .update({
                    descripcion,
                    updated_at: new Date().toISOString()
                })
                .eq('id', ticket.id);

            error = result.error;
        }

        if (error) {
            console.error('Error al editar descripción:', error);
            return res.status(500).send(
                'No se pudo actualizar la descripción.'
            );
        }

        return res.redirect(`/tickets/${ticket.id}`);

    } catch (error) {
        console.error('Error al editar descripción:', error);
        return res.status(500).send('Error al editar el ticket.');
    }
});


// ============================================
// 6. ACTUALIZAR GESTIÓN DEL TICKET
// Administrador y técnico
// ============================================

router.post('/:id/actualizar', requireAuth, requireStaff, async (req, res) => {
    try {
        const {
            estado,
            prioridad,
            responsable,
            observaciones
        } = req.body;

        const estadosPermitidos = [
            'pendiente',
            'en_proceso',
            'resuelto',
            'cancelado'
        ];

        const prioridadesPermitidas = [
            'baja',
            'media',
            'alta',
            'urgente'
        ];

        if (!estadosPermitidos.includes(estado)) {
            return res.status(400).send('Estado no válido.');
        }

        if (!prioridadesPermitidas.includes(prioridad)) {
            return res.status(400).send('Prioridad no válida.');
        }

        const responsableLimpio = typeof responsable === 'string'
            ? responsable.trim()
            : '';

        const observacionesLimpias = typeof observaciones === 'string'
            ? observaciones.trim()
            : '';

        const actualizacion = {
            estado,
            prioridad,
            responsable: responsableLimpio || null,
            observaciones: observacionesLimpias || null,
            updated_at: new Date().toISOString()
        };

        if (estado === 'en_proceso') {
            actualizacion.fecha_atencion = new Date().toISOString();
        }

        if (estado === 'resuelto') {
            actualizacion.fecha_resolucion = new Date().toISOString();
        }

        const { data: ticket, error: findError } = await req.supabase
            .from('tickets')
            .select('id')
            .eq('id', req.params.id)
            .single();

        if (findError || !ticket) {
            return res.status(404).send('Ticket no encontrado.');
        }

        const { error } = await req.supabase
            .from('tickets')
            .update(actualizacion)
            .eq('id', ticket.id);

        if (error) {
            console.error('Error al actualizar ticket:', error);
            return res.status(500).send(
                'No se pudo actualizar el ticket.'
            );
        }

        return res.redirect(`/tickets/${ticket.id}`);

    } catch (error) {
        console.error('Error al actualizar ticket:', error);
        return res.status(500).send('Error al actualizar el ticket.');
    }
});


// ============================================
// 7. ELIMINAR TICKET
// Exclusivo para administrador
// ============================================

router.post('/:id/eliminar', requireAuth, requireOnlyAdmin, async (req, res) => {
    try {
        const { data: ticket, error: findError } = await req.supabase
            .from('tickets')
            .select('id')
            .eq('id', req.params.id)
            .single();

        if (findError || !ticket) {
            return res.status(404).send('Ticket no encontrado.');
        }

        const { error } = await req.supabase
            .from('tickets')
            .delete()
            .eq('id', ticket.id);

        if (error) {
            console.error('Error al eliminar ticket:', error);
            return res.status(500).send(
                'No se pudo eliminar el ticket.'
            );
        }

        return res.redirect('/tickets');

    } catch (error) {
        console.error('Error al eliminar ticket:', error);
        return res.status(500).send('Error al eliminar el ticket.');
    }
});

module.exports = router;
