
const express = require('express');

const {
    requireAuth,
    requireAdmin,
    requireTechnician,
    requireUser
} = require('../middleware/auth');

// ========================================
// CONFIGURACIÓN
// ========================================

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
    'cancelado'
];

function limpiar(valor) {
    return typeof valor === 'string' ? valor.trim() : '';
}

function esUUID(valor) {
    return typeof valor === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

// ========================================
// CONFIGURACIÓN DE MÓDULOS
// ========================================

const MODULOS = {
    admin: {
        middleware: requireAdmin,
        dashboard: 'admin/dashboard',
        detalle: 'admin/ticket-detalle',
        base: '/admin/tickets'
    },

    tecnico: {
        middleware: requireTechnician,
        dashboard: 'tecnico/dashboard',
        detalle: 'tecnico/ticket-detalle',
        base: '/tecnico/tickets'
    },

    user: {
        middleware: requireUser,
        dashboard: 'usuario/dashboard',
        detalle: 'usuario/ticket-detalle',
        base: '/usuario/tickets'
    }
};

// ========================================
// FACTORY DE MÓDULOS
// ========================================

function crearModuloTickets(rol) {
    const modulo = MODULOS[rol];

    if (!modulo) {
        throw new Error(`Rol de módulo no válido: ${rol}`);
    }

    // Recuperar sessionToken desde la ruta principal.
    const router = express.Router({
        mergeParams: true
    });

    // Autenticación y autorización.
    router.use(requireAuth, modulo.middleware);

    // ========================================
    // FUNCIONES AUXILIARES DE RUTAS
    // ========================================

    function obtenerBase(req) {
        return `/sesion/${encodeURIComponent(req.params.sessionToken)}${modulo.base}`;
    }

    function rutaDetalle(req, id) {
        return `${obtenerBase(req)}/${encodeURIComponent(id)}`;
    }

    function renderData(req, adicionales = {}) {
        const base = obtenerBase(req);

        return {
            user: req.user,
            sessionToken: req.params.sessionToken,
            dashboardUrl: base,
            nuevoTicketUrl: rol === 'user' ? `${base}/nuevo` : null,
            logoutUrl: `/sesion/${encodeURIComponent(req.params.sessionToken)}/logout`,
            ...adicionales
        };
    }

    // ========================================
    // PANEL PRINCIPAL
    // ========================================

    router.get('/', async (req, res) => {
        try {
            let query = req.supabase
                .from('tickets')
                .select('*')
                .order('created_at', { ascending: false });

            // El usuario únicamente consulta sus tickets.
            if (rol === 'user') {
                query = query.eq('solicitante_id', req.user.id);
            }

            const { data: tickets, error } = await query;

            if (error) {
                console.error('ERROR AL CONSULTAR TICKETS:', error);

                return res.status(500).send(
                    'No se pudieron cargar los tickets.'
                );
            }

            return res.render(
                modulo.dashboard,
                renderData(req, {
                    title: 'Panel de tickets',
                    tickets: tickets || []
                })
            );

        } catch (error) {
            console.error('ERROR EN DASHBOARD:', error);

            return res.status(500).send(
                'Error al cargar el panel.'
            );
        }
    });

    // ========================================
    // CREAR TICKET: SOLO USUARIO
    // ========================================

    if (rol === 'user') {

        router.get('/nuevo', (req, res) => {
            return res.render(
                'usuario/ticket-nuevo',
                renderData(req, {
                    title: 'Nuevo ticket',
                    error: null
                })
            );
        });

        router.post('/nuevo', async (req, res) => {
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
                    return res.status(400).send(
                        'La longitud de un campo no es válida.'
                    );
                }

                const nuevoTicket = {
                    nombre_solicitante: nombre,
                    titulo,
                    descripcion,

                    categoria: CATEGORIAS.includes(categoria)
                        ? categoria
                        : 'general',

                    prioridad: PRIORIDADES.includes(prioridad)
                        ? prioridad
                        : 'media',

                    solicitante_id: req.user.id,
                    estado: 'pendiente',
                    responsable: null
                };

                const { error } = await req.supabase
                    .from('tickets')
                    .insert(nuevoTicket);

                if (error) {
                    console.error('ERROR AL CREAR TICKET:', error);

                    return res.status(500).send(
                        'No se pudo crear el ticket.'
                    );
                }

                return res.redirect(303, obtenerBase(req));

            } catch (error) {
                console.error('ERROR AL CREAR TICKET:', error);

                return res.status(500).send(
                    'Error al crear el ticket.'
                );
            }
        });
    }

    // ========================================
    // CONSULTAR DETALLE
    // ========================================

    router.get('/:id', async (req, res) => {
        try {
            const ticketId = req.params.id;

            if (!esUUID(ticketId)) {
                return res.status(400).send(
                    'El identificador del ticket no es válido.'
                );
            }

            const { data: ticket, error } = await req.supabase
                .from('tickets')
                .select('*')
                .eq('id', ticketId)
                .maybeSingle();

            if (error) {
                console.error('ERROR AL CONSULTAR DETALLE:', error);

                return res.status(500).send(
                    'Error al consultar la información del ticket.'
                );
            }

            if (!ticket) {
                return res.status(404).send(
                    'Ticket no encontrado.'
                );
            }

            if (
                rol === 'user' &&
                ticket.solicitante_id !== req.user.id
            ) {
                return res.status(403).send(
                    'No tienes permiso para consultar este ticket.'
                );
            }

            return res.render(
                modulo.detalle,
                renderData(req, {
                    title: `Ticket #${ticket.id}`,
                    ticket,
                    editarTicket: req.query.editar === '1'
                })
            );

        } catch (error) {
            console.error('ERROR EN DETALLE:', error);

            return res.status(500).send(
                'Error al cargar el detalle del ticket.'
            );
        }
    });

    // ========================================
    // ACTUALIZAR TICKET
    // ========================================

    router.post('/:id/actualizar', async (req, res) => {
        try {
            const ticketId = req.params.id;

            if (!esUUID(ticketId)) {
                return res.status(400).send(
                    'El identificador del ticket no es válido.'
                );
            }

            const { data: ticket, error: findError } = await req.supabase
                .from('tickets')
                .select('id, solicitante_id, fecha_atencion, fecha_resolucion')
                .eq('id', ticketId)
                .maybeSingle();

            if (findError) {
                console.error('ERROR AL BUSCAR TICKET:', findError);

                return res.status(500).send(
                    'Error al consultar el ticket.'
                );
            }

            if (!ticket) {
                return res.status(404).send(
                    'Ticket no encontrado.'
                );
            }

            if (
                rol === 'user' &&
                ticket.solicitante_id !== req.user.id
            ) {
                return res.status(403).send(
                    'No tienes permiso para editar este ticket.'
                );
            }

            const nombre = limpiar(req.body.nombre_solicitante);
            const titulo = limpiar(req.body.titulo);
            const descripcion = limpiar(req.body.descripcion);
            const categoria = limpiar(req.body.categoria);

            if (!nombre || !titulo || !descripcion || !categoria) {
                return res.status(400).send(
                    'Completa los campos obligatorios.'
                );
            }

            if (
                nombre.length > 150 ||
                titulo.length > 200 ||
                descripcion.length > 5000 ||
                !CATEGORIAS.includes(categoria)
            ) {
                return res.status(400).send(
                    'Los datos ingresados no son válidos.'
                );
            }

            // Actualización del usuario mediante RPC.
            if (rol === 'user') {
                const { error } = await req.supabase.rpc(
                    'update_own_ticket',
                    {
                        p_ticket_id: ticket.id,
                        p_nombre_solicitante: nombre,
                        p_titulo: titulo,
                        p_descripcion: descripcion,
                        p_categoria: categoria
                    }
                );

                if (error) {
                    console.error('ERROR EN update_own_ticket:', error);

                    return res.status(500).send(
                        'No se pudieron actualizar los datos del ticket.'
                    );
                }

                return res.redirect(
                    303,
                    rutaDetalle(req, ticket.id)
                );
            }

            // Actualización de técnico y administrador.
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

            if (
                responsable.length > 150 ||
                observaciones.length > 5000
            ) {
                return res.status(400).send(
                    'Los campos de gestión son demasiado largos.'
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

            if (
                estado === 'en_proceso' &&
                !ticket.fecha_atencion
            ) {
                actualizacion.fecha_atencion = ahora;
            }

            if (
                estado === 'resuelto' &&
                !ticket.fecha_resolucion
            ) {
                actualizacion.fecha_resolucion = ahora;
            }

            const { error } = await req.supabase
                .from('tickets')
                .update(actualizacion)
                .eq('id', ticket.id);

            if (error) {
                console.error('ERROR AL ACTUALIZAR TICKET:', error);

                return res.status(500).send(
                    'No se pudo actualizar el ticket.'
                );
            }

            return res.redirect(
                303,
                rutaDetalle(req, ticket.id)
            );

        } catch (error) {
            console.error('ERROR EN ACTUALIZACIÓN:', error);

            return res.status(500).send(
                'Error al actualizar el ticket.'
            );
        }
    });

    // ========================================
    // ELIMINAR TICKET: SOLO ADMINISTRADOR
    // ========================================

    if (rol === 'admin') {

        router.post('/:id/eliminar', async (req, res) => {
            try {
                const ticketId = req.params.id;

                if (!esUUID(ticketId)) {
                    return res.status(400).send(
                        'El identificador del ticket no es válido.'
                    );
                }

                const { data: ticket, error: findError } = await req.supabase
                    .from('tickets')
                    .select('id')
                    .eq('id', ticketId)
                    .maybeSingle();

                if (findError) {
                    console.error('ERROR AL BUSCAR TICKET:', findError);

                    return res.status(500).send(
                        'Error al consultar el ticket.'
                    );
                }

                if (!ticket) {
                    return res.status(404).send(
                        'Ticket no encontrado.'
                    );
                }

                const { error } = await req.supabase
                    .from('tickets')
                    .delete()
                    .eq('id', ticket.id);

                if (error) {
                    console.error('ERROR AL ELIMINAR TICKET:', error);

                    return res.status(500).send(
                        'No se pudo eliminar el ticket.'
                    );
                }

                return res.redirect(303, obtenerBase(req));

            } catch (error) {
                console.error('ERROR AL ELIMINAR:', error);

                return res.status(500).send(
                    'Error al eliminar el ticket.'
                );
            }
        });
    }

    return router;
}

module.exports = crearModuloTickets;
