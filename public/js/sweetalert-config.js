
(function () {
    'use strict';

    if (typeof Swal === 'undefined') {
        console.error('SweetAlert2 no está disponible.');
        return;
    }

    // ========================================
    // NOTIFICACIONES TOAST
    // ========================================

    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true
    });

    // ========================================
    // FUNCIONES GLOBALES
    // ========================================

    window.BodesaAlert = {

        exito(mensaje, titulo = 'Operación completada') {
            return Swal.fire({
                icon: 'success',
                title: titulo,
                text: mensaje,
                confirmButtonText: 'Aceptar'
            });
        },

        error(mensaje, titulo = 'Ocurrió un error') {
            return Swal.fire({
                icon: 'error',
                title: titulo,
                text: mensaje,
                confirmButtonText: 'Aceptar'
            });
        },

        advertencia(mensaje, titulo = 'Atención') {
            return Swal.fire({
                icon: 'warning',
                title: titulo,
                text: mensaje,
                confirmButtonText: 'Entendido'
            });
        },

        info(mensaje, titulo = 'Información') {
            return Swal.fire({
                icon: 'info',
                title: titulo,
                text: mensaje,
                confirmButtonText: 'Aceptar'
            });
        },

        toastExito(mensaje) {
            return Toast.fire({
                icon: 'success',
                title: mensaje
            });
        },

        toastError(mensaje) {
            return Toast.fire({
                icon: 'error',
                title: mensaje
            });
        },

        // ========================================
        // CONFIRMACIONES PERSONALIZADAS
        // ========================================

        confirmar({
            titulo = '¿Estás seguro?',
            mensaje = '¿Deseas continuar con esta operación?',
            textoConfirmar = 'Sí, continuar',
            textoCancelar = 'Cancelar',
            icono = 'question',
            colorConfirmar = '#2563eb'
        } = {}) {
            return Swal.fire({
                title: titulo,
                text: mensaje,
                icon: icono,
                showCancelButton: true,
                confirmButtonColor: colorConfirmar,
                cancelButtonColor: '#6b7280',
                confirmButtonText: textoConfirmar,
                cancelButtonText: textoCancelar,
                reverseButtons: true,
                focusCancel: true
            });
        }
    };

    // ========================================
    // CONFIGURACIÓN DE ACCIONES
    // ========================================

    const acciones = {
        terminar: {
            titulo: '¿Terminar actividad?',
            mensaje: 'La actividad se marcará como terminada.',
            confirmar: 'Sí, terminar',
            icono: 'success',
            color: '#16a34a'
        },

        liberar: {
            titulo: '¿Liberar actividad?',
            mensaje: 'Se retirará la asignación actual de esta actividad.',
            confirmar: 'Sí, liberar',
            icono: 'warning',
            color: '#d97706'
        },

        tomar: {
            titulo: '¿Tomar actividad?',
            mensaje: 'La actividad quedará asignada a tu usuario.',
            confirmar: 'Sí, tomar',
            icono: 'question',
            color: '#2563eb'
        },

        validar: {
            titulo: '¿Validar actividad?',
            mensaje: 'Se confirmará la validación de esta actividad.',
            confirmar: 'Sí, validar',
            icono: 'success',
            color: '#16a34a'
        },

        devolver: {
            titulo: '¿Devolver actividad?',
            mensaje: 'La actividad será devuelta para su revisión.',
            confirmar: 'Sí, devolver',
            icono: 'warning',
            color: '#d97706'
        },

        eliminar: {
            titulo: '¿Eliminar registro?',
            mensaje: 'Esta operación puede ser irreversible.',
            confirmar: 'Sí, eliminar',
            icono: 'error',
            color: '#dc2626'
        }
    };

    // ========================================
    // IDENTIFICAR ACCIÓN POR URL
    // ========================================

    function obtenerAccion(formulario) {
        try {
            const url = new URL(
                formulario.action,
                window.location.href
            );

            const segmentos = url.pathname
                .split('/')
                .filter(Boolean);

            const ultimaParte = segmentos.at(-1);

            return acciones[ultimaParte] ? ultimaParte : null;

        } catch (error) {
            console.error('Error identificando acción:', error);
            return null;
        }
    }

    // ========================================
    // INTERCEPTAR FORMULARIOS
    // ========================================

    document.addEventListener('submit', async function (evento) {

        const formulario = evento.target;

        if (!(formulario instanceof HTMLFormElement)) {
            return;
        }

        const accion = obtenerAccion(formulario);

        if (!accion) {
            return;
        }

        evento.preventDefault();

        // Evitar dobles envíos
        if (formulario.dataset.enviando === 'true') {
            return;
        }

        const configuracion = acciones[accion];

        const resultado = await BodesaAlert.confirmar({
            titulo: configuracion.titulo,
            mensaje: configuracion.mensaje,
            textoConfirmar: configuracion.confirmar,
            icono: configuracion.icono,
            colorConfirmar: configuracion.color
        });

        if (!resultado.isConfirmed) {
            return;
        }

        formulario.dataset.enviando = 'true';

        // Enviar el formulario original sin alterar su método,
        // destino, campos ni parámetros.
        HTMLFormElement.prototype.submit.call(formulario);

    });

})();
