
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const router = express.Router();

// ========================================
// CONFIGURACIÓN
// ========================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !WEBHOOK_SECRET) {
    console.error(
        'Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o WEBHOOK_SECRET'
    );
}

const supabaseAdmin = createClient(
    SUPABASE_URL,
    SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    }
);

const BUCKET_ADJUNTOS = 'activity-attachments';

const PRIORIDADES_VALIDAS = [
    'baja',
    'media',
    'alta',
    'urgente'
];

// ========================================
// UTILIDADES
// ========================================

function textoOpcional(value) {
    const texto = String(value ?? '').trim();
    return texto || null;
}

function obtenerExtension(nombre) {
    const extension = String(nombre || '')
        .split('.')
        .pop()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    return extension || 'bin';
}

function validarBase64(contentBytes) {
    if (typeof contentBytes !== 'string' || !contentBytes.trim()) {
        return false;
    }

    // Acepta Base64 sin espacios ni saltos de línea.
    const contenido = contentBytes.replace(/\s/g, '');

    if (contenido.length % 4 !== 0) {
        return false;
    }

    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        contenido
    );
}

function obtenerFecha(value) {
    if (!value) return new Date().toISOString();

    const fecha = new Date(value);

    if (Number.isNaN(fecha.getTime())) {
        return new Date().toISOString();
    }

    return fecha.toISOString();
}

function respuestaDuplicado(id) {
    return {
        ok: true,
        duplicate: true,
        message: 'El correo ya había sido procesado',
        id
    };
}

// ========================================
// PROCESAR ADJUNTOS
// ========================================

async function procesarAdjuntos(activityId, attachments) {
    const resultados = {
        total: attachments.length,
        exitosos: 0,
        fallidos: 0,
        errores: []
    };

    for (const att of attachments) {
        let storagePath = null;

        try {
            if (!att || !att.name || !att.contentBytes) {
                throw new Error(
                    'El adjunto no contiene nombre o contenido Base64'
                );
            }

            if (!validarBase64(att.contentBytes)) {
                throw new Error(
                    `El contenido Base64 de ${att.name} no es válido`
                );
            }

            const buffer = Buffer.from(
                att.contentBytes.replace(/\s/g, ''),
                'base64'
            );

            if (!buffer.length) {
                throw new Error(
                    `El archivo ${att.name} está vacío`
                );
            }

            const extension = obtenerExtension(att.name);

            storagePath = `${activityId}/${randomUUID()}.${extension}`;

            // --------------------------------
            // SUBIR A SUPABASE STORAGE
            // --------------------------------

            const { error: uploadError } = await supabaseAdmin.storage
                .from(BUCKET_ADJUNTOS)
                .upload(storagePath, buffer, {
                    contentType:
                        att.contentType ||
                        'application/octet-stream',
                    upsert: false
                });

            if (uploadError) {
                throw uploadError;
            }

            // --------------------------------
            // REGISTRAR EN TABLA
            // --------------------------------

            const { error: insertError } = await supabaseAdmin
                .from('activity_attachments')
                .insert({
                    activity_id: activityId,
                    file_name: String(att.name).slice(0, 255),
                    file_path: storagePath,
                    file_size: buffer.length,
                    mime_type: att.contentType || null
                });

            if (insertError) {
                // Evitar archivos huérfanos en Storage.
                await supabaseAdmin.storage
                    .from(BUCKET_ADJUNTOS)
                    .remove([storagePath]);

                storagePath = null;

                throw insertError;
            }

            resultados.exitosos++;

        } catch (error) {
            resultados.fallidos++;

            resultados.errores.push({
                archivo: att?.name || 'Archivo sin nombre',
                error: error.message
            });

            console.error(
                'ERROR PROCESANDO ADJUNTO:',
                att?.name,
                error
            );
        }
    }

    return resultados;
}

// ========================================
// WEBHOOK DE OUTLOOK
// POST /api/webhook/capturas
// ========================================

router.post('/capturas', async (req, res) => {
    try {
        const payload = req.body || {};

        // --------------------------------
        // 1. VALIDAR CONFIGURACIÓN
        // --------------------------------

        if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !WEBHOOK_SECRET) {
            console.error('Configuración del webhook incompleta');

            return res.status(500).json({
                ok: false,
                error: 'Webhook no configurado correctamente'
            });
        }

        // --------------------------------
        // 2. VALIDAR SECRETO
        // --------------------------------

        if (
            typeof payload.secret !== 'string' ||
            payload.secret !== WEBHOOK_SECRET
        ) {
            return res.status(401).json({
                ok: false,
                error: 'Unauthorized'
            });
        }

        // --------------------------------
        // 3. VALIDAR INFORMACIÓN DEL CORREO
        // --------------------------------

        const title = String(payload.subject || '').trim();

        if (!title) {
            return res.status(400).json({
                ok: false,
                error: 'subject es obligatorio'
            });
        }

        if (title.length > 500) {
            return res.status(400).json({
                ok: false,
                error: 'El asunto supera los 500 caracteres'
            });
        }

        const messageId = textoOpcional(payload.message_id);

        if (!messageId) {
            return res.status(400).json({
                ok: false,
                error: 'message_id es obligatorio para evitar duplicados'
            });
        }

        // --------------------------------
        // 4. COMPROBAR DUPLICADOS
        // --------------------------------

        const { data: existing, error: duplicateError } =
            await supabaseAdmin
                .from('activities')
                .select('id')
                .eq('source_type', 'outlook')
                .eq('source_email_id', messageId)
                .maybeSingle();

        if (duplicateError) {
            console.error(
                'ERROR CONSULTANDO DUPLICADOS:',
                duplicateError
            );

            return res.status(500).json({
                ok: false,
                error: 'No se pudo verificar si el correo ya existe'
            });
        }

        if (existing) {
            return res.status(200).json(
                respuestaDuplicado(existing.id)
            );
        }

        // --------------------------------
        // 5. DETECTAR PRIORIDAD
        // --------------------------------

        let priority = 'media';

        const lowerTitle = title.toLowerCase();

        if (
            lowerTitle.includes('urgente') ||
            lowerTitle.includes('urgent')
        ) {
            priority = 'urgente';
        } else if (
            typeof payload.priority === 'string' &&
            PRIORIDADES_VALIDAS.includes(
                payload.priority.toLowerCase()
            )
        ) {
            priority = payload.priority.toLowerCase();
        }

        // --------------------------------
        // 6. VALIDAR CANTIDAD
        // --------------------------------

        let quantity = null;

        if (
            payload.quantity !== undefined &&
            payload.quantity !== null &&
            String(payload.quantity).trim() !== ''
        ) {
            const parsedQuantity = Number(payload.quantity);

            if (
                Number.isInteger(parsedQuantity) &&
                parsedQuantity >= 0
            ) {
                quantity = parsedQuantity;
            }
        }

        // --------------------------------
        // 7. PREPARAR ACTIVIDAD
        // --------------------------------

        const activity = {
            source_type: 'outlook',
            source_email_id: messageId,
            title,
            requester_name: textoOpcional(payload.from_name),
            requester_email: textoOpcional(payload.from_email),
            quantity,
            priority,
            activity_type: textoOpcional(payload.activity_type),
            observations:
                textoOpcional(payload.observations) ||
                textoOpcional(payload.body_preview),
            status: 'disponible',
            received_at: obtenerFecha(payload.received_at)
        };

        // --------------------------------
        // 8. INSERTAR ACTIVIDAD
        // --------------------------------

        const { data: created, error: insertError } =
            await supabaseAdmin
                .from('activities')
                .insert(activity)
                .select('id')
                .single();

        if (insertError) {
            // 23505 = violación de índice único.
            // Puede suceder si dos ejecuciones procesan
            // simultáneamente el mismo correo.

            if (insertError.code === '23505') {
                const { data: duplicate } = await supabaseAdmin
                    .from('activities')
                    .select('id')
                    .eq('source_type', 'outlook')
                    .eq('source_email_id', messageId)
                    .maybeSingle();

                if (duplicate) {
                    return res.status(200).json(
                        respuestaDuplicado(duplicate.id)
                    );
                }
            }

            console.error(
                'ERROR INSERT ACTIVITY:',
                insertError
            );

            return res.status(500).json({
                ok: false,
                error: 'No se pudo crear la actividad'
            });
        }

        // --------------------------------
        // 9. REGISTRAR HISTORIAL
        // --------------------------------

        const { error: historyError } = await supabaseAdmin
            .from('activity_history')
            .insert({
                activity_id: created.id,
                action: 'creada_por_correo',
                new_status: 'disponible',
                comments:
                    'Ingresada automáticamente desde Outlook / Power Automate',
                metadata: {
                    source: 'outlook',
                    message_id: messageId
                }
            });

        if (historyError) {
            console.error(
                'ERROR REGISTRANDO HISTORIAL:',
                historyError
            );
        }

        // --------------------------------
        // 10. PROCESAR ADJUNTOS
        // --------------------------------

        let resultadoAdjuntos = {
            total: 0,
            exitosos: 0,
            fallidos: 0,
            errores: []
        };

        if (Array.isArray(payload.attachments)) {
            resultadoAdjuntos = await procesarAdjuntos(
                created.id,
                payload.attachments
            );
        }

        // --------------------------------
        // 11. RESPUESTA FINAL
        // --------------------------------

        const tieneErrores =
            resultadoAdjuntos.fallidos > 0 ||
            Boolean(historyError);

        console.log('========== WEBHOOK OUTLOOK ==========');
        console.log('Actividad:', created.id);
        console.log('Correo:', messageId);
        console.log('Adjuntos recibidos:', resultadoAdjuntos.total);
        console.log('Adjuntos guardados:', resultadoAdjuntos.exitosos);
        console.log('Adjuntos fallidos:', resultadoAdjuntos.fallidos);
        console.log('=====================================');

        return res.status(tieneErrores ? 207 : 201).json({
            ok: true,
            id: created.id,
            message: tieneErrores
                ? 'Actividad creada con incidencias parciales'
                : 'Actividad creada correctamente',
            attachments: resultadoAdjuntos,
            history_registered: !historyError
        });

    } catch (err) {
        console.error('ERROR GENERAL WEBHOOK:', err);

        return res.status(500).json({
            ok: false,
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
