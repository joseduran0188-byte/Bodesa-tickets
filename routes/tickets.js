
const express = require('express');
const router = express.Router();

const {
    requireAuth,
    requireStaff,
    requireOnlyAdmin
} = require('../middleware/auth');

const CATEGORIAS = [
    'general',
    'software',
    'hardware',
    'redes',
    'sistemas',
    'accesos',
    'otro'
];

const PRIORIDADES = [
    'baja',
    'media',
    'alta',
    'urgente'
];

const ESTADOS = [
    'pendiente',
    'en_proceso',
    'resuelto',
    'cancelado',
    'cerrado'
];

function limpiarTexto(valor) {
    return typeof valor === 'string' ? valor.trim() : '';
}

function esPersonal(role) {
    return ['admin', 'tecnico'].includes(role);
}

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

        if (req.user.role === 'user') {
            query = query.eq('solicitante_id', req.user.id);
        }

        const { data: tickets, error } = await query;

        if (error) {
            console.error('Error al consultar tickets:', error);
            return res.status(500).send('No se pudieron cargar los tickets.');
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
        const nombre = limpiarTexto(req.body.nombre_solicitante);
        const titulo = limpiarTexto(req.body.titulo);
        const descripcion = limpiarTexto(req.body.descripcion);
        const categoria = limpiarTexto(req.body.categoria);
        const prioridad = limpiarTexto(req.body.prioridad);

        if (!nombre || !titulo || !descripcion) {
            return res.status(400).render('ticket-nuevo', {
                title: 'Nuevo ticket',
                user: req.user,
                error: 'Completa el nombre del solicitante, título y descripción.'
            });
        }

        if (nombre.length > 150 || titulo.length > 200 || descripcion.length > 5000) {
            return res.status(400).render('ticket-nuevo', {
                title: 'Nuevo ticket',
                user: req.user,
                error: 'Verifica la longitud de los campos ingresados.'
            });
        }

        const nuevoTicket = {
            nombre_solicitante: nombre,
            titulo,
            descripcion,
            categoria: CATEGORIAS.includes(categoria) ? categoria : 'general',
            prioridad: PRIORIDADES.includes(prioridad) ? prioridad : 'media',
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
            editarTicket: req.query.editar === '1'
        });
    } catch (error) {
        console.error('Error al consultar ticket:', error);
        return res.status(500).send('Error al consultar el ticket.');
    }
});

// ============================================
// 5. EDITAR TICKET COMPLETO
// Usuario: datos básicos de su propio ticket.
// Admin/técnico: datos básicos y gestión.
// ============================================

router.post('/:id/actualizar', requireAuth, async (req, res) => {
    try {
        const { data: ticket, error: findError } = await req.supabase
            .from('tickets')
            .select('id, solicitante_id, estado, fecha_atencion, fecha_resolucion')
            .eq('id', req.params.id)
            .single();

        if (findError || !ticket) {
            return res.status(404).send('Ticket no encontrado.');
        }

        const esPropietario = ticket.solicitante_id === req.user.id;
        const esStaff = esPersonal(req.user.role);

        if (!esPropietario && !esStaff) {
            return res.status(403).send(
                'No tienes permiso para editar este ticket.'
            );
        }

        // Datos básicos que pueden editar el propietario y el personal.
        const nombre = limpiarTexto(req.body.nombre_solicitante);
        const titulo = limpiarTexto(req.body.titulo);
        const descripcion = limpiarTexto(req.body.descripcion);
        const categoria = limpiarTexto(req.body.categoria);

        if (!nombre || !titulo || !descripcion || !categoria) {
            return res.status(400).send(
                'Completa todos los campos obligatorios.'
            );
        }

        if (
            nombre.length > 150 ||
            titulo.length > 200 ||
            descripcion.length > 5000 ||
            !CATEGORIAS.includes(categoria)
        ) {
            return res.status(400).send(
                'Uno o más campos contienen valores no válidos.'
            );
        }

        // Usuario normal: solo puede modificar los datos básicos.
        // La función SQL verifica nuevamente que sea el propietario.
        if (req.user.role === 'user') {
            const { error } = await req.supabase.rpc('update_own_ticket', {
                p_ticket_id: ticket.id,
                p_nombre_solicitante: nombre,
                p_titulo: titulo,
                p_descripcion: descripcion,
                p_categoria: categoria
            });

            if (error) {
                console.error('Error en RPC update_own_ticket:', error);
                return res.status(500).send(
                    'No se pudieron actualizar los datos del ticket. Verifica que la función update_own_ticket exista en Supabase.'
                );
            }

            return res.redirect(`/tickets/${ticket.id}`);
        }

        // Administrador y técnico: pueden modificar todos los campos.
        const estado = limpiarTexto(req.body.estado);
        const prioridad = limpiarTexto(req.body.prioridad);
        const responsable = limpiarTexto(req.body.responsable);
        const observaciones = limpiarTexto(req.body.observaciones);

        if (!ESTADOS.includes(estado)) {
            return res.status(400).send('Estado no válido.');
        }

        if (!PRIORIDADES.includes(prioridad)) {
            return res.status(400).send('Prioridad no válida.');
        }

        if (responsable.length > 150 || observaciones.length > 5000) {
            return res.status(400).send(
                'El responsable o las observaciones superan la longitud permitida.'
            );
        }

        const ahora = new Date().toISOString();

        const actualizacion = {
            nombre_solicitante: nombre,
            titulo,
            descripcion,
            categoria,
            estado,
            prioridad,
            responsable: responsable || null,
            observaciones: observaciones || null,
            updated_at: ahora
        };

        // Registrar la primera fecha de atención, sin sobrescribirla.
        if (
            estado === 'en_proceso' &&
            !ticket.fecha_atencion
        ) {
            actualizacion.fecha_atencion = ahora;
        }

        // Registrar la primera fecha de resolución, sin sobrescribirla.
        if (
            estado === 'resuelto' &&
            !ticket.fecha_resolucion
        ) {
            actualizacion.fecha_resolucion = ahora;
        }

        const { error: updateError } = await req.supabase
            .from('tickets')
            .update(actualizacion)
            .eq('id', ticket.id);

        if (updateError) {
            console.error('Error al actualizar ticket:', updateError);
            return res.status(500).send(
                'No se pudo actualizar el ticket. Revisa los permisos de Supabase.'
            );
        }

        return res.redirect(`/tickets/${ticket.id}`);
    } catch (error) {
        console.error('Error al actualizar ticket:', error);
        return res.status(500).send('Error al actualizar el ticket.');
    }
});

// ============================================
// 6. RUTA ANTERIOR DE EDICIÓN DE DESCRIPCIÓN
// Se conserva para no romper formularios antiguos.
// ============================================

router.post('/:id/editar-descripcion', requireAuth, async (req, res) => {
    try {
        const descripcion = limpiarTexto(req.body.descripcion);

        if (!descripcion || descripcion.length > 5000) {
            return res.status(400).send('La descripción no es válida.');
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
        const esStaff = esPersonal(req.user.role);

        if (!esPropietario && !esStaff) {
            return res.status(403).send('No tienes permiso para editar este ticket.');
        }

        let error;

        if (req.user.role === 'user') {
            const result = await req.supabase.rpc('update_own_ticket', {
                p_ticket_id: ticket.id,
                p_nombre_solicitante: '',
                p_titulo: '',
                p_descripcion: descripcion,
                p_categoria: ''
            });

            error = result.error;
        } else {
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
            return res.status(500).send('No se pudo actualizar la descripción.');
        }

        return res.redirect(`/tickets/${ticket.id}`);
    } catch (error) {
        console.error('Error al editar descripción:', error);
        return res.status(500).send('Error al editar el ticket.');
    }
});

// ============================================
// 7. ELIMINAR TICKET
// Exclusivo para administrador.
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
            return res.status(500).send('No se pudo eliminar el ticket.');
        }

        return res.redirect('/tickets');
    } catch (error) {
        console.error('Error al eliminar ticket:', error);
        return res.status(500).send('Error al eliminar el ticket.');
    }
});

module.exports = router;
