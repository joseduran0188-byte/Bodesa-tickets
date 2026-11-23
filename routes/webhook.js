
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const {
  randomUUID,
  timingSafeEqual
} = require('crypto');

const {
  clasificarActividad,
  detectarPrioridad
} = require('../lib/clasificador-actividades');

const router = express.Router();

const BUCKET_ADJUNTOS = 'activity-attachments';
const DIAGNOSTICO_WEBHOOK = true;

const PRIORIDADES_VALIDAS = [
  'baja',
  'media',
  'alta',
  'urgente'
];

let supabaseAdmin = null;

// ========================================
// CLIENTE ADMINISTRATIVO DE SUPABASE
// ========================================

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Faltan las variables de configuración de Supabase.'
    );
  }

  supabaseAdmin = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  return supabaseAdmin;
}

// ========================================
// UTILIDADES
// ========================================

function textoOpcional(value) {
  const texto = String(value ?? '').trim();
  return texto || null;
}

function validarSecreto(recibido) {
  const esperado = process.env.WEBHOOK_SECRET;

  const recibidoValido = typeof recibido === 'string';
  const esperadoConfigurado =
    typeof esperado === 'string' && esperado.length > 0;

  const longitudRecibida = recibidoValido
    ? Buffer.byteLength(recibido, 'utf8')
    : 0;

  const longitudEsperada = esperadoConfigurado
    ? Buffer.byteLength(esperado, 'utf8')
    : 0;

  if (DIAGNOSTICO_WEBHOOK) {
    console.log('====== DIAGNOSTICO WEBHOOK ======');
    console.log('Secreto recibido como texto:', recibidoValido);
    console.log('Secreto configurado:', esperadoConfigurado);
    console.log('Longitud recibida:', longitudRecibida);
    console.log('Longitud configurada:', longitudEsperada);
    console.log(
      'Coinciden longitudes:',
      longitudRecibida === longitudEsperada
    );
    console.log('=================================');
  }

  if (!recibidoValido || !esperadoConfigurado) {
    return false;
  }

  const a = Buffer.from(recibido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function obtenerFecha(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const fecha = new Date(value);

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  return fecha.toISOString();
}

function obtenerExtension(nombre) {
  const extension = String(nombre || '')
    .split('.')
    .pop()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  return extension || 'bin';
}

function validarBase64(contenido) {
  if (
    typeof contenido !== 'string' ||
    !contenido.trim()
  ) {
    return false;
  }

  const limpio = contenido.replace(/\s/g, '');

  if (limpio.length % 4 !== 0) {
    return false;
  }

  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
    limpio
  );
}


// ========================================
// NORMALIZAR ENCABEZADOS DE EXCEL
// ========================================

function normalizarEncabezado(valor = '') {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00A0\u202F\u2007]/g, ' ')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// ========================================
// CONTAR MODELOS DE ARCHIVOS EXCEL
// ========================================

function contarModelosExcel(attachments = []) {
  const codigosUnicos = new Set();
  const archivosLeidos = [];
  const errores = [];
  const diagnostico = [];

  let estructuraEncontrada = false;

  const encabezadosValidos = [
    'CODIGOSAP',
    'CODIGODESAP',
    'CODIGOPRODUCTO'
  ];

  for (const att of attachments) {
    if (!att?.name || !att?.contentBytes) continue;

    const extension = obtenerExtension(att.name);

    if (!['xlsx', 'xlsm', 'xls'].includes(extension)) {
      continue;
    }

    try {
      if (!validarBase64(att.contentBytes)) {
        throw new Error('Contenido Base64 inválido');
      }

      const buffer = Buffer.from(
        att.contentBytes.replace(/\s/g, ''),
        'base64'
      );

      if (!buffer.length) {
        throw new Error('Archivo vacío');
      }

      const workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: false
      });

      const diagnosticoArchivo = {
        archivo: att.name,
        hojas: []
      };

      let codigosArchivo = 0;

      for (const nombreHoja of workbook.SheetNames) {
        const hoja = workbook.Sheets[nombreHoja];

        const filas = XLSX.utils.sheet_to_json(hoja, {
          header: 1,
          defval: '',
          raw: false,
          blankrows: false
        });

        const resultadoHoja = {
          nombre: nombreHoja,
          encabezado_encontrado: false,
          fila_encabezado: null,
          columna_codigo: null,
          codigos_detectados: 0
        };

        // Buscar encabezados en las primeras 30 filas.
        const limite = Math.min(filas.length, 30);

        let filaEncabezado = -1;
        let columnaCodigo = -1;

        for (let i = 0; i < limite; i++) {
          const fila = filas[i] || [];

          const indice = fila.findIndex(celda => {
            const encabezado = normalizarEncabezado(celda);

            return encabezadosValidos.includes(encabezado);
          });

          if (indice !== -1) {
            filaEncabezado = i;
            columnaCodigo = indice;
            break;
          }
        }

        if (filaEncabezado === -1) {
          resultadoHoja.motivo =
            'No se encontró una columna de código SAP';

          diagnosticoArchivo.hojas.push(resultadoHoja);
          continue;
        }

        estructuraEncontrada = true;

        resultadoHoja.encabezado_encontrado = true;
        resultadoHoja.fila_encabezado = filaEncabezado + 1;
        resultadoHoja.columna_codigo = columnaCodigo + 1;

        // Leer los códigos debajo del encabezado.
        for (
          let i = filaEncabezado + 1;
          i < filas.length;
          i++
        ) {
          const valorOriginal = String(
            filas[i]?.[columnaCodigo] ?? ''
          ).trim();

          if (!valorOriginal) continue;

          const codigo = normalizarEncabezado(valorOriginal);

          if (
            !codigo ||
            [
              'CODIGOSAP',
              'TOTAL',
              'NA',
              'NC',
              'SC'
            ].includes(codigo)
          ) {
            continue;
          }

          // Los códigos deben contener al menos un número.
          if (!/\d/.test(codigo)) continue;

          const cantidadAnterior = codigosUnicos.size;

          codigosUnicos.add(codigo);

          if (codigosUnicos.size > cantidadAnterior) {
            resultadoHoja.codigos_detectados++;
            codigosArchivo++;
          }
        }

        diagnosticoArchivo.hojas.push(resultadoHoja);
      }

      archivosLeidos.push(att.name);

      diagnosticoArchivo.total_codigos_unicos_archivo =
        codigosArchivo;

      diagnostico.push(diagnosticoArchivo);

    } catch (error) {
      errores.push({
        archivo: att.name,
        error: error.message
      });

      console.error(
        'ERROR LEYENDO EXCEL:',
        att.name,
        error.message
      );
    }
  }

  const resultado = {
    quantity: estructuraEncontrada
      ? codigosUnicos.size
      : null,

    quantity_source: estructuraEncontrada
      ? 'excel'
      : null,

    estructura_encontrada: estructuraEncontrada,
    archivos_leidos: archivosLeidos,
    errores,
    diagnostico
  };

  console.log(
    'DIAGNOSTICO DETALLADO EXCEL:',
    JSON.stringify(resultado, null, 2)
  );

  return resultado;
}

// ========================================
// PROCESAR ARCHIVOS ADJUNTOS
// ========================================

async function procesarAdjuntos(activityId, attachments) {
  const db = getSupabaseAdmin();

  const resultados = {
    total: attachments.length,
    exitosos: 0,
    fallidos: 0,
    errores: []
  };

  for (const att of attachments) {
    let storagePath = null;

    try {
      if (
        !att ||
        !att.name ||
        !att.contentBytes
      ) {
        throw new Error(
          'El adjunto no contiene nombre o contenido.'
        );
      }

      if (!validarBase64(att.contentBytes)) {
        throw new Error(
          `Contenido Base64 inválido: ${att.name}`
        );
      }

      const buffer = Buffer.from(
        att.contentBytes.replace(/\s/g, ''),
        'base64'
      );

      if (!buffer.length) {
        throw new Error(
          `El archivo está vacío: ${att.name}`
        );
      }

      const extension = obtenerExtension(att.name);

      storagePath =
        `${activityId}/${randomUUID()}.${extension}`;

      const { error: uploadError } = await db.storage
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

      const { error: insertError } = await db
        .from('activity_attachments')
        .insert({
          activity_id: activityId,
          file_name: String(att.name).slice(0, 255),
          file_path: storagePath,
          file_size: buffer.length,
          mime_type: att.contentType || null
        });

      if (insertError) {
        await db.storage
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
        error.message
      );
    }
  }

  return resultados;
}

// ========================================
// DIAGNOSTICO DE CONFIGURACION
// ========================================

router.get('/diagnostico', (req, res) => {
  return res.status(200).json({
    ok: true,
    webhook: 'activo',
    configuracion: {
      webhook_secret: Boolean(process.env.WEBHOOK_SECRET),
      supabase_url: Boolean(process.env.SUPABASE_URL),
      supabase_service_role_key: Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    },
    mensaje:
      'Diagnóstico de variables completado. No se muestran secretos.'
  });
});

// ========================================
// WEBHOOK OUTLOOK
// POST /api/webhook/capturas
// ========================================

router.post('/capturas', async (req, res) => {
  try {
    const payload = req.body || {};

    if (DIAGNOSTICO_WEBHOOK) {
      console.log('====== SOLICITUD RECIBIDA ======');
      console.log('Método:', req.method);
      console.log('Content-Type:', req.headers['content-type']);
      console.log(
        'Body recibido como objeto:',
        typeof payload === 'object' && payload !== null
      );
      console.log(
        'Se recibió propiedad secret:',
        Object.prototype.hasOwnProperty.call(payload, 'secret')
      );
      console.log('================================');
    }

    // 1. Validar secreto.
    if (!validarSecreto(payload.secret)) {
      return res.status(401).json({
        ok: false,
        error: 'No autorizado',
        diagnostico: {
          secret_recibido: typeof payload.secret === 'string',
          secret_configurado: Boolean(
            process.env.WEBHOOK_SECRET
          )
        }
      });
    }

    const db = getSupabaseAdmin();

    // 2. Validar asunto.
    const title = textoOpcional(payload.subject);

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

    // 3. Validar identificador del correo.
    const messageId = textoOpcional(payload.message_id);

    if (!messageId) {
      return res.status(400).json({
        ok: false,
        error: 'message_id es obligatorio'
      });
    }

    // 4. Validar fecha.
    const receivedAt = obtenerFecha(payload.received_at);

    if (!receivedAt) {
      return res.status(400).json({
        ok: false,
        error: 'received_at contiene una fecha inválida'
      });
    }

    // 5. Validar adjuntos.
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments
      : [];

    // 6. Evitar correos duplicados.
    const { data: existing, error: duplicateError } = await db
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
        error: 'No se pudo verificar el correo'
      });
    }

    if (existing) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        message: 'El correo ya había sido procesado',
        id: existing.id
      });
    }

    // 7. Clasificación automática.
    const datosClasificacion = {
      subject: title,
      body:
        payload.body ||
        payload.body_preview ||
        payload.observations ||
        '',
      attachments
    };

    const clasificacion = clasificarActividad(
      datosClasificacion
    );

    // 8. Detectar prioridad.
    const prioridadDetectada = detectarPrioridad({
      subject: title,
      body: datosClasificacion.body
    });

    const prioridadRecibida = String(
      payload.priority || ''
    ).toLowerCase();

    const priority =
      prioridadDetectada !== 'media'
        ? prioridadDetectada
        : PRIORIDADES_VALIDAS.includes(prioridadRecibida)
          ? prioridadRecibida
          : 'media';

    // 9. Contar modelos en Excel.
    const resultadoExcel = contarModelosExcel(attachments);

    let quantity = resultadoExcel.quantity;
    let quantitySource = resultadoExcel.quantity_source;

    // Si no se reconoce el Excel, usar la cantidad del payload
    // únicamente cuando sea un entero no negativo.
    if (
      quantity === null &&
      payload.quantity !== undefined &&
      payload.quantity !== null &&
      String(payload.quantity).trim() !== ''
    ) {
      const cantidad = Number(payload.quantity);

      if (
        Number.isInteger(cantidad) &&
        cantidad >= 0
      ) {
        quantity = cantidad;
        quantitySource = 'payload';
      }
    }

    console.log('====== CONTEO DE MODELOS ======');
    console.log('Cantidad:', quantity);
    console.log('Origen:', quantitySource);
    console.log('Archivos:', resultadoExcel.archivos_leidos);
    console.log(
      'Estructura encontrada:',
      resultadoExcel.estructura_encontrada
    );
    console.log('================================');

    // 10. Preparar actividad.
    const activity = {
      source_type: 'outlook',
      source_email_id: messageId,
      title,

      requester_name: textoOpcional(payload.from_name),
      requester_email: textoOpcional(payload.from_email),

      quantity,
      quantity_source: quantitySource,
      priority,

      // Clasificación original.
      activity_type: clasificacion.activity_type,

      // Nueva organización por depósitos.
      catalog_category: clasificacion.catalog_category,
      classification_status: clasificacion.classification_status,
      classification_confidence: clasificacion.classification_confidence,
      matched_terms: clasificacion.matched_terms,

      observations:
        textoOpcional(payload.observations) ||
        textoOpcional(payload.body_preview) ||
        textoOpcional(payload.body),

      status: 'disponible',
      received_at: receivedAt
    };

    // 11. Insertar actividad.
    const { data: created, error: insertError } = await db
      .from('activities')
      .insert(activity)
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: duplicate } = await db
          .from('activities')
          .select('id')
          .eq('source_type', 'outlook')
          .eq('source_email_id', messageId)
          .maybeSingle();

        if (duplicate) {
          return res.status(200).json({
            ok: true,
            duplicate: true,
            id: duplicate.id
          });
        }
      }

      console.error(
        'ERROR INSERTANDO ACTIVIDAD:',
        insertError
      );

      return res.status(500).json({
        ok: false,
        error: 'No se pudo registrar la actividad'
      });
    }

    // 12. Registrar historial.
    const { error: historyError } = await db
      .from('activity_history')
      .insert({
        activity_id: created.id,
        action: 'creada_por_correo',
        new_status: 'disponible',
        comments:
          `Ingresada desde Outlook. Depósito: ${clasificacion.catalog_category}. ` +
          `Tipo: ${clasificacion.activity_type}. ` +
          `Modelos: ${quantity ?? 'No detectados'}.`
      });

    if (historyError) {
      console.error(
        'ERROR REGISTRANDO HISTORIAL:',
        historyError
      );
    }

    // 13. Procesar adjuntos y guardarlos en Storage.
    let resultadoAdjuntos = {
      total: 0,
      exitosos: 0,
      fallidos: 0,
      errores: []
    };

    if (attachments.length > 0) {
      resultadoAdjuntos = await procesarAdjuntos(
        created.id,
        attachments
      );
    }

    // 14. Preparar respuesta.
    const tieneErrores =
      resultadoAdjuntos.fallidos > 0 ||
      Boolean(historyError);

    console.log('====== WEBHOOK OUTLOOK ======');
    console.log('Actividad:', created.id);
    console.log('Correo:', messageId);
    console.log('Depósito:', clasificacion.catalog_category);
    console.log(
      'Clasificación:',
      clasificacion.classification_status
    );
    console.log('Prioridad:', priority);
    console.log('Cantidad de modelos:', quantity);
    console.log('Origen cantidad:', quantitySource);
    console.log('Adjuntos:', resultadoAdjuntos);
    console.log('=============================');

    return res.status(201).json({
      ok: true,

      message: tieneErrores
        ? 'Actividad registrada con incidencias parciales'
        : 'Actividad registrada correctamente',

      id: created.id,

      activity_type: clasificacion.activity_type,
      catalog_category: clasificacion.catalog_category,

      priority,
      status: 'disponible',

      classification_status:
        clasificacion.classification_status,

      classification_confidence:
        clasificacion.classification_confidence,

      matched_terms: clasificacion.matched_terms,

      quantity,
      quantity_source: quantitySource,

      excel: {
        estructura_encontrada:
          resultadoExcel.estructura_encontrada,
        archivos_leidos:
          resultadoExcel.archivos_leidos,
        errores: resultadoExcel.errores
      },

      attachments: resultadoAdjuntos,
      history_registered: !historyError
    });

  } catch (error) {
    console.error('ERROR GENERAL WEBHOOK:', error);

    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

module.exports = router;
