
(function () {
    'use strict';

    // Evitar instalar dos veces el mismo controlador.
    if (window.__bodesaSweetAlertInstalado) {
        return;
    }

    window.__bodesaSweetAlertInstalado = true;

    if (typeof Swal === 'undefined') {
        console.error('SweetAlert2 no está disponible.');
        window.__bodesaSweetAlertInstalado = false;
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
        // CONFIRMACIONES
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
            mensaje: 'La actividad quedará asignada al responsable indicado.',
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
            titulo: '¿Cancelar actividad?',
            mensaje: 'La actividad cambiará al estado cancelada. Se conservará su historial.',
            confirmar: 'Sí, cancelar',
            icono: 'warning',
            color: '#dc2626'
        },

        desvalidar: {
            titulo: '¿Desvalidar actividad?',
            mensaje: 'La actividad regresará al estado disponible.',
            confirmar: 'Sí, desvalidar',
            icono: 'warning',
            color: '#d97706'
        },

        reactivar: {
            titulo: '¿Reactivar actividad?',
            mensaje: 'La actividad volverá a estar operativa.',
            confirmar: 'Sí, reactivar',
            icono: 'question',
            color: '#2563eb'
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

            const ultimaParte = segmentos[
                segmentos.length - 1
            ];

            return Object.prototype.hasOwnProperty.call(
                acciones,
                ultimaParte
            )
                ? ultimaParte
                : null;

        } catch (error) {
            console.error(
                'Error identificando acción:',
                error
            );

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

        // Detener cualquier otro listener de submit
        // que intente abrir otra confirmación.
        evento.preventDefault();
        evento.stopImmediatePropagation();

        // Evitar procesar dos veces el mismo formulario.
        if (
            formulario.dataset.confirmacionActiva === 'true' ||
            formulario.dataset.enviando === 'true'
        ) {
            return;
        }

        formulario.dataset.confirmacionActiva = 'true';

        const configuracion = acciones[accion];

        try {

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

            const botones = formulario.querySelectorAll(
                'button[type="submit"], button:not([type])'
            );

            botones.forEach(boton => {
                boton.disabled = true;
            });

            // Enviar el formulario original.
            HTMLFormElement.prototype.submit.call(formulario);

        } catch (error) {

            console.error(
                'ERROR EN CONFIRMACIÓN:',
                error
            );

            formulario.dataset.enviando = 'false';

            BodesaAlert.error(
                'No se pudo procesar la confirmación.'
            );

        } finally {

            formulario.dataset.confirmacionActiva = 'false';
        }

    }, true);

})();
