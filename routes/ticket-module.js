const express = require('express');
const exportRoutes = require('./export');

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

// ========================================
// FUNCIONES AUXILIARES
// ========================================

function limpiar(valor) {
    return typeof valor === 'string' ? valor.trim() : '';
}

function esUUID(valor) {
    return typeof valor === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

// ========================================
// FORMATO DE FECHAS - HORARIO DE COLIMA
// ========================================

function formatearFecha(fecha, valorPendiente = '—') {
    if (!fecha) {
        return valorPendiente;
    }

    const fechaValida = new Date(fecha);

    if (Number.isNaN(fechaValida.getTime())) {
        return valorPendiente;
    }

    return new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).format(fechaValida);
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

    const router = express.Router({
        mergeParams: true
    });

    // Autenticación y autorización.
    router.use(requireAuth, modulo.middleware);
    if (rol === 'admin' || rol === 'tecnico') {
    router.use('/exportar', exportRoutes);
}

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
            formatearFecha,
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

            // El usuario únicamente consulta sus propios tickets.
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

        // Mostrar formulario.
        router.get('/nuevo', (req, res) => {
            return res.render(
                'usuario/ticket-nuevo',
                renderData(req, {
                    title: 'Nuevo ticket',
                    error: null
                })
            );
        });

        // Procesar creación.
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

            // Verificar propiedad del ticket para usuarios.
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

            // Buscar el ticket.
            const { data: ticket, error: findError } = await req.supabase
                .from('tickets')
                .select('id, solicitante_id')
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

            // ========================================
            // ACTUALIZACIÓN DEL USUARIO
            // ========================================

            if (rol === 'user') {

                // Comprobar que el ticket pertenece al usuario.
                if (ticket.solicitante_id !== req.user.id) {
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
                        'Los datos ingresados no son válidos.'
                    );
                }

                // El usuario actualiza mediante RPC.
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
                    console.error(
                        'ERROR EN update_own_ticket:',
                        error
                    );

                    return res.status(500).send(
                        'No se pudieron actualizar los datos del ticket.'
                    );
                }

                return res.redirect(
                    303,
                    rutaDetalle(req, ticket.id)
                );
            }

            // ========================================
            // ACTUALIZACIÓN DE ADMINISTRADOR Y TÉCNICO
            // ========================================

            if (rol === 'admin' || rol === 'tecnico') {

                const estado = limpiar(req.body.estado);
                const prioridad = limpiar(req.body.prioridad);
                const responsable = limpiar(req.body.responsable);
                const observaciones = limpiar(req.body.observaciones);

                // Validar estado.
                if (!ESTADOS.includes(estado)) {
                    return res.status(400).send(
                        'El estado seleccionado no es válido.'
                    );
                }

                // Validar prioridad.
                if (!PRIORIDADES.includes(prioridad)) {
                    return res.status(400).send(
                        'La prioridad seleccionada no es válida.'
                    );
                }

                // Validar longitudes.
                if (
                    responsable.length > 150 ||
                    observaciones.length > 5000
                ) {
                    return res.status(400).send(
                        'Los campos de gestión superan la longitud permitida.'
                    );
                }

                // Las fechas son administradas por el trigger de Supabase.
                const actualizacion = {
                    estado,
                    prioridad,
                    responsable: responsable || null,
                    observaciones: observaciones || null
                };

                const { data: actualizado, error } = await req.supabase
                    .from('tickets')
                    .update(actualizacion)
                    .eq('id', ticket.id)
                    .select('id')
                    .maybeSingle();

                if (error) {
                    console.error(
                        'ERROR AL ACTUALIZAR TICKET:',
                        error
                    );

                    return res.status(500).send(
                        'No se pudo actualizar el ticket.'
                    );
                }

                if (!actualizado) {
                    return res.status(403).send(
                        'No tienes permisos para actualizar este ticket.'
                    );
                }

                return res.redirect(
                    303,
                    rutaDetalle(req, ticket.id)
                );
            }

            return res.status(403).send(
                'No tienes permisos para realizar esta operación.'
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

                const { data: eliminado, error } = await req.supabase
                    .from('tickets')
                    .delete()
                    .eq('id', ticket.id)
                    .select('id')
                    .maybeSingle();

                if (error) {
                    console.error('ERROR AL ELIMINAR TICKET:', error);

                    return res.status(500).send(
                        'No se pudo eliminar el ticket.'
                    );
                }

                if (!eliminado) {
                    return res.status(403).send(
                        'No tienes permisos para eliminar este ticket.'
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