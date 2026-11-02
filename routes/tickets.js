
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

const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'];

const ESTADOS = [
    'pendiente',
    'en_proceso',
    'resuelto',
    'cancelado'
];

function limpiar(valor) {
    return typeof valor === 'string' ? valor.trim() : '';
}

function rutaPanel(role) {
    const rutas = {
        admin: '/tickets',
        tecnico: '/tickets',
        user: '/tickets'
    };

    return rutas[role] || '/login';
}

function vistaDashboard(role) {
    const vistas = {
        admin: 'admin/dashboard',
        tecnico: 'tecnico/dashboard',
        user: 'usuario/dashboard'
    };

    return vistas[role] || null;
}

function vistaDetalle(role) {
    const vistas = {
        admin: 'admin/ticket-detalle',
        tecnico: 'tecnico/ticket-detalle',
        user: 'usuario/ticket-detalle'
    };

    return vistas[role] || null;
}

// ============================================
// 1. DASHBOARD INDEPENDIENTE POR ROL
// ============================================

router.get('/', requireAuth, async (req, res) => {
    try {
        const vista = vistaDashboard(req.user.role);

        if (!vista) {
            return res.status(403).send('Rol no autorizado.');
        }

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

        return res.render(vista, {
            title: 'Panel de tickets',
            user: req.user,
            tickets: tickets || []
        });

    } catch (error) {
        console.error('Error en dashboard:', error);
        return res.status(500).send('Error al cargar el panel.');
    }
});

// ============================================
// 2. FORMULARIO DE NUEVO TICKET
// ============================================

router.get('/nuevo', requireAuth, async (req, res) => {
    if (req.user.role !== 'user') {
        return res.status(403).send(
            'Esta vista de creación está reservada al usuario.'
        );
    }

    return res.render('usuario/ticket-nuevo', {
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
        const nombre = limpiar(req.body.nombre_solicitante);
        const titulo = limpiar(req.body.titulo);
        const descripcion = limpiar(req.body.descripcion);
        const categoria = limpiar(req.body.categoria);
        const prioridad = limpiar(req.body.prioridad);

        if (!nombre || !titulo || !descripcion) {
            return res.status(400).send(
                'Completa el nombre del solicitante, título y descripción.'
            );
        }

        if (
            nombre.length > 150 ||
            titulo.length > 200 ||
            descripcion.length > 5000
        ) {
            return res.status(400).send('La longitud de un campo no es válida.');
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
            return res.status(500).send('No se pudo crear el ticket.');
        }

        return res.redirect(rutaPanel(req.user.role));

    } catch (error) {
        console.error('Error al crear ticket:', error);
        return res.status(500).send('Error al crear el ticket.');
    }
});

// ============================================
// 4. DETALLE DE TICKET SEGÚN ROL
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

        const esPropietario = ticket.solicitante_id === req.user.id;
        const esStaff = ['admin', 'tecnico'].includes(req.user.role);

        if (!esPropietario && !esStaff) {
            return res.status(403).send('No tienes permiso para consultar este ticket.');
        }

        const vista = vistaDetalle(req.user.role);

        if (!vista) {
            return res.status(403).send('Rol no autorizado.');
        }

        return res.render(vista, {
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
// 5. ACTUALIZAR TICKET
// ============================================

router.post('/:id/actualizar', requireAuth, async (req, res) => {
    try {
        const { data: ticket, error: findError } = await req.supabase
            .from('tickets')
            .select('id, solicitante_id, fecha_atencion, fecha_resolucion')
            .eq('id', req.params.id)
            .single();

        if (findError || !ticket) {
            return res.status(404).send('Ticket no encontrado.');
        }

        const esPropietario = ticket.solicitante_id === req.user.id;
        const esStaff = ['admin', 'tecnico'].includes(req.user.role);

        if (!esPropietario && !esStaff) {
            return res.status(403).send('No tienes permiso para editar este ticket.');
        }

        const nombre = limpiar(req.body.nombre_solicitante);
        const titulo = limpiar(req.body.titulo);
        const descripcion = limpiar(req.body.descripcion);
        const categoria = limpiar(req.body.categoria);

        if (!nombre || !titulo || !descripcion || !categoria) {
            return res.status(400).send('Completa los campos obligatorios.');
        }

        if (
            nombre.length > 150 ||
            titulo.length > 200 ||
            descripcion.length > 5000 ||
            !CATEGORIAS.includes(categoria)
        ) {
            return res.status(400).send('Los datos ingresados no son válidos.');
        }

        // Usuario: solo datos básicos mediante RPC segura.
        if (req.user.role === 'user') {
            const { error } = await req.supabase.rpc('update_own_ticket', {
                p_ticket_id: ticket.id,
                p_nombre_solicitante: nombre,
                p_titulo: titulo,
                p_descripcion: descripcion,
                p_categoria: categoria
            });

            if (error) {
                console.error('Error en update_own_ticket:', error);
                return res.status(500).send(
                    'No se pudieron actualizar los datos del ticket.'
                );
            }

            return res.redirect(`/tickets/${ticket.id}`);
        }

        // Administrador y técnico: datos básicos y gestión.
        const estado = limpiar(req.body.estado);
        const prioridad = limpiar(req.body.prioridad);
        const responsable = limpiar(req.body.responsable);
        const observaciones = limpiar(req.body.observaciones);

        if (!ESTADOS.includes(estado)) {
            return res.status(400).send('Estado no válido.');
        }

        if (!PRIORIDADES.includes(prioridad)) {
            return res.status(400).send('Prioridad no válida.');
        }

        if (responsable.length > 150 || observaciones.length > 5000) {
            return res.status(400).send('Los campos de gestión son demasiado largos.');
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

        if (estado === 'en_proceso' && !ticket.fecha_atencion) {
            actualizacion.fecha_atencion = ahora;
        }

        if (estado === 'resuelto' && !ticket.fecha_resolucion) {
            actualizacion.fecha_resolucion = ahora;
        }

        const { error } = await req.supabase
            .from('tickets')
            .update(actualizacion)
            .eq('id', ticket.id);

        if (error) {
            console.error('Error al actualizar ticket:', error);
            return res.status(500).send('No se pudo actualizar el ticket.');
        }

        return res.redirect(`/tickets/${ticket.id}`);

    } catch (error) {
        console.error('Error al actualizar ticket:', error);
        return res.status(500).send('Error al actualizar el ticket.');
    }
});

// ============================================
// 6. ELIMINAR TICKET: SOLO ADMINISTRADOR
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

        // Regresa al panel correspondiente a la sesión autenticada.
        return res.redirect(rutaPanel(req.user.role));

    } catch (error) {
        console.error('Error al eliminar ticket:', error);
        return res.status(500).send('Error al eliminar el ticket.');
    }
});

module.exports = router;
