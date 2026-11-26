
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
      'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.'
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

  if (
    typeof recibido !== 'string' ||
    typeof esperado !== 'string' ||
    !esperado
  ) {
    return false;
  }

  const a = Buffer.from(recibido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function obtenerFecha(value) {
  if (!value) return new Date().toISOString();

  const fecha = new Date(value);

  if (Number.isNaN(fecha.getTime())) return null;

  return fecha.toISOString();
}

function obtenerExtension(nombre) {
  const partes = String(nombre || '').split('.');
  const extension = partes.length > 1
    ? partes.pop().toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';

  return extension || 'bin';
}

function normalizarNombreArchivo(nombre) {
  return String(nombre || 'archivo')
    .replace(/[\/\\]/g, '_')
    .replace(/[\u0000-\u001F]/g, '')
    .trim()
    .slice(0, 255) || 'archivo';
}

/**
 * Convierte contentBytes a Buffer.
 *
 * Acepta:
 * - Base64 normal.
 * - Base64 con saltos de línea.
 * - Base64 URL-safe.
 * - Base64 sin padding.
 * - Data URI: data:image/png;base64,...
 *
 * No modifica los bytes originales del archivo.
 */
function decodificarAdjunto(contenido) {
  if (typeof contenido !== 'string' || !contenido.trim()) {
    throw new Error('El contenido Base64 está vacío.');
  }

  let base64 = contenido.trim();

  // Eliminar encabezado de Data URI.
  if (/^data:[^,]*;base64,/i.test(base64)) {
    base64 = base64.substring(base64.indexOf(',') + 1);
  }

  // Eliminar espacios y saltos de línea.
  base64 = base64.replace(/\s/g, '');

  // Convertir Base64 URL-safe a Base64 normal.
  base64 = base64
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Eliminar padding existente y reconstruirlo.
  base64 = base64.replace(/=+$/, '');

  if (!base64 || !/^[A-Za-z0-9+/]+$/.test(base64)) {
    throw new Error('El contenido no tiene un formato Base64 válido.');
  }

  if (base64.length % 4 === 1) {
    throw new Error('El contenido Base64 está incompleto.');
  }

  const padding = (4 - (base64.length % 4)) % 4;
  const base64Completo = base64 + '='.repeat(padding);

  const buffer = Buffer.from(base64Completo, 'base64');

  if (!buffer.length) {
    throw new Error('El archivo decodificado está vacío.');
  }

  // Verificar que la conversión no haya producido datos inválidos.
  const originalNormalizado = base64Completo.replace(/=+$/, '');
  const convertidoNormalizado = buffer.toString('base64').replace(/=+$/, '');

  if (originalNormalizado !== convertidoNormalizado) {
    throw new Error('No fue posible verificar la integridad del Base64.');
  }

  return buffer;
}

function obtenerMimeType(att, nombre) {
  const recibido = textoOpcional(att?.contentType);

  if (recibido && /^[\w.+-]+\/[\w.+-]+$/.test(recibido)) {
    return recibido;
  }

  const extension = obtenerExtension(nombre);

  const tipos = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    csv: 'text/csv',
    txt: 'text/plain',
    zip: 'application/zip'
  };

  return tipos[extension] || 'application/octet-stream';
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
// CONTAR MODELOS DE EXCEL
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
      const buffer = decodificarAdjunto(att.contentBytes);

      const workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: false
      });

      const diagnosticoArchivo = {
        archivo: att.name,
        hojas: [],
        total_codigos_unicos_archivo: 0
      };

      const codigosArchivo = new Set();

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

        const limite = Math.min(filas.length, 30);

        let filaEncabezado = -1;
        let columnaCodigo = -1;

        for (let i = 0; i < limite; i++) {
          const fila = filas[i] || [];

          const indice = fila.findIndex(celda =>
            encabezadosValidos.includes(
              normalizarEncabezado(celda)
            )
          );

          if (indice !== -1) {
            filaEncabezado = i;
            columnaCodigo = indice;
            break;
          }
        }

        if (filaEncabezado === -1) {
          resultadoHoja.motivo =
            'No se encontró una columna de código SAP.';

          diagnosticoArchivo.hojas.push(resultadoHoja);
          continue;
        }

        estructuraEncontrada = true;

        resultadoHoja.encabezado_encontrado = true;
        resultadoHoja.fila_encabezado = filaEncabezado + 1;
        resultadoHoja.columna_codigo = columnaCodigo + 1;

        for (
          let i = filaEncabezado + 1;
          i < filas.length;
          i++
        ) {
          const valor = String(
            filas[i]?.[columnaCodigo] ?? ''
          ).trim();

          if (!valor) continue;

          const codigo = normalizarEncabezado(valor);

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

          if (!/\d/.test(codigo)) continue;

          const cantidadAnterior = codigosArchivo.size;

          codigosArchivo.add(codigo);
          codigosUnicos.add(codigo);

          if (codigosArchivo.size > cantidadAnterior) {
            resultadoHoja.codigos_detectados++;
          }
        }

        diagnosticoArchivo.hojas.push(resultadoHoja);
      }

      diagnosticoArchivo.total_codigos_unicos_archivo =
        codigosArchivo.size;

      archivosLeidos.push(att.name);
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
    'DIAGNOSTICO EXCEL:',
    JSON.stringify(resultado, null, 2)
  );

  return resultado;
}

// ========================================
// CONSULTAR ADJUNTOS DE UNA ACTIVIDAD
// ========================================

async function obtenerAdjuntosExistentes(activityId) {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from('activity_attachments')
    .select('id, file_name, file_path, file_size, mime_type')
    .eq('activity_id', activityId);

  if (error) {
    throw new Error(
      'No se pudieron consultar los adjuntos existentes: ' +
      error.message
    );
  }

  return data || [];
}

// ========================================
// COMPROBAR QUE EL OBJETO SEA IDÉNTICO
// ========================================

async function objetoStorageCoincide(filePath, bufferEsperado) {
  if (!filePath) return false;

  const db = getSupabaseAdmin();

  const { data, error } = await db.storage
    .from(BUCKET_ADJUNTOS)
    .download(filePath);

  if (error || !data) {
    console.warn(
      'No se pudo descargar el objeto para verificarlo:',
      filePath,
      error?.message || ''
    );

    return false;
  }

  try {
    const arrayBuffer = await data.arrayBuffer();
    const bufferStorage = Buffer.from(arrayBuffer);

    return bufferStorage.equals(bufferEsperado);
  } catch (errorLectura) {
    console.error(
      'ERROR COMPARANDO ARCHIVO:',
      filePath,
      errorLectura.message
    );

    return false;
  }
}

// ========================================
// PROCESAR Y ALMACENAR ADJUNTOS
// ========================================

async function procesarAdjuntos(activityId, attachments = []) {
  const db = getSupabaseAdmin();

  const resultados = {
    total: attachments.length,
    exitosos: 0,
    fallidos: 0,
    errores: []
  };

  let existentes = await obtenerAdjuntosExistentes(activityId);

  // Evita reutilizar el mismo registro para dos adjuntos.
  const registrosUtilizados = new Set();

  for (const att of attachments) {
    let storagePath = null;

    try {
      if (!att || !att.name || !att.contentBytes) {
        throw new Error(
          'El adjunto no contiene nombre o contenido.'
        );
      }

      const buffer = decodificarAdjunto(att.contentBytes);

      const nombre = normalizarNombreArchivo(att.name);
      const mimeType = obtenerMimeType(att, nombre);

      console.log('PROCESANDO ADJUNTO:', {
        nombre,
        bytes: buffer.length,
        mimeType
      });

      // Buscar un registro con el mismo nombre y tamaño.
      // No se considera válido hasta comparar los bytes reales.
      let adjuntoEncontrado = false;

      for (let i = 0; i < existentes.length; i++) {
        if (registrosUtilizados.has(i)) continue;

        const existente = existentes[i];

        if (
          existente.file_name !== nombre ||
          Number(existente.file_size) !== buffer.length
        ) {
          continue;
        }

        const coincide = await objetoStorageCoincide(
          existente.file_path,
          buffer
        );

        if (coincide) {
          registrosUtilizados.add(i);
          adjuntoEncontrado = true;
          resultados.exitosos++;

          console.log(
            'ADJUNTO VERIFICADO; NO SE DUPLICA:',
            nombre,
            existente.file_path
          );

          break;
        }

        console.warn(
          'EL ARCHIVO EXISTENTE NO COINCIDE. SE SUBIRÁ DE NUEVO:',
          nombre,
          existente.file_path
        );
      }

      if (adjuntoEncontrado) continue;

      // Crear una ruta única para el objeto.
      const extension = obtenerExtension(nombre);

      storagePath =
        `${activityId}/${randomUUID()}.${extension}`;

      // Subir el Buffer binario original.
      const { error: uploadError } = await db.storage
        .from(BUCKET_ADJUNTOS)
        .upload(storagePath, buffer, {
          contentType: mimeType,
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw new Error(
          'Error subiendo archivo a Storage: ' +
          uploadError.message
        );
      }

      // Verificar que Storage conserve exactamente los bytes.
      const archivoVerificado = await objetoStorageCoincide(
        storagePath,
        buffer
      );

      if (!archivoVerificado) {
        await db.storage
          .from(BUCKET_ADJUNTOS)
          .remove([storagePath]);

        storagePath = null;

        throw new Error(
          'El archivo subido no coincide con el archivo original.'
        );
      }

      // Registrar los metadatos después de verificar Storage.
      const { error: insertError } = await db
        .from('activity_attachments')
        .insert({
          activity_id: activityId,
          file_name: nombre,
          file_path: storagePath,
          file_size: buffer.length,
          mime_type: mimeType
        });

      if (insertError) {
        await db.storage
          .from(BUCKET_ADJUNTOS)
          .remove([storagePath]);

        storagePath = null;

        throw new Error(
          'Error registrando metadatos del adjunto: ' +
          insertError.message
        );
      }

      resultados.exitosos++;

      // Incluir el nuevo registro para evitar duplicados
      // dentro de la misma solicitud.
      existentes.push({
        file_name: nombre,
        file_path: storagePath,
        file_size: buffer.length,
        mime_type: mimeType
      });

      registrosUtilizados.add(existentes.length - 1);

      console.log('ADJUNTO GUARDADO Y VERIFICADO:', {
        nombre,
        storagePath,
        bytes: buffer.length,
        mimeType
      });

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

      // Limpiar un objeto que haya quedado sin registro.
      if (storagePath) {
        try {
          await db.storage
            .from(BUCKET_ADJUNTOS)
            .remove([storagePath]);
        } catch (cleanupError) {
          console.error(
            'ERROR LIMPIANDO ARCHIVO:',
            cleanupError.message
          );
        }
      }
    }
  }

  return resultados;
}

// ========================================
// REGISTRAR O COMPROBAR HISTORIAL
// ========================================

async function asegurarHistorial(
  activityId,
  clasificacion,
  operationalTags,
  quantity
) {
  const db = getSupabaseAdmin();

  const { data: existente, error: consultaError } = await db
    .from('activity_history')
    .select('activity_id')
    .eq('activity_id', activityId)
    .eq('action', 'creada_por_correo')
    .limit(1);

  if (consultaError) {
    console.error(
      'ERROR CONSULTANDO HISTORIAL:',
      consultaError
    );

    return false;
  }

  if (existente && existente.length > 0) {
    return true;
  }

  const comments =
    `Ingresada desde Outlook. Categoría: ${clasificacion.catalog_category || 'Sin categoría'}. ` +
    `Tipo: ${clasificacion.activity_type || 'Sin tipo'}. ` +
    `Etiquetas: ${operationalTags.length > 0 ? operationalTags.join(', ') : 'Ninguna'}. ` +
    `Modelos: ${quantity ?? 'No detectados'}.`;

  const { error: historyError } = await db
    .from('activity_history')
    .insert({
      activity_id: activityId,
      action: 'creada_por_correo',
      new_status: 'disponible',
      comments
    });

  if (historyError) {
    console.error(
      'ERROR REGISTRANDO HISTORIAL:',
      historyError
    );

    return false;
  }

  return true;
}

// ========================================
// RESPUESTA UNIFICADA
// ========================================

function responderRecepcion({
  res,
  status = 200,
  activityId,
  duplicate = false,
  attachments,
  historyRegistered,
  message,
  extra = {}
}) {
  const received = attachments.total;
  const stored = attachments.exitosos;
  const failed = attachments.fallidos;

  const complete =
    historyRegistered === true &&
    received === stored &&
    failed === 0;

  return res.status(status).json({
    ok: true,
    complete,
    activity_id: activityId,
    id: activityId,
    duplicate,

    message: complete
      ? message
      : 'Recepción incompleta. Se requiere reintento.',

    attachments: {
      received,
      stored,
      failed,
      errors: attachments.errores,

      // Compatibilidad con Apps Script anterior.
      total: received,
      exitosos: stored,
      fallidos: failed,
      errores: attachments.errores
    },

    history_registered: historyRegistered,
    ...extra
  });
}

// ========================================
// COMPLETAR ACTIVIDAD EXISTENTE
// ========================================

async function completarActividadExistente({
  res,
  activityId,
  attachments,
  message
}) {
  const resultadoAdjuntos = await procesarAdjuntos(
    activityId,
    attachments
  );

  const db = getSupabaseAdmin();

  const { data: activity, error: activityError } = await db
    .from('activities')
    .select(
      'id, activity_type, catalog_category, operational_tags, quantity'
    )
    .eq('id', activityId)
    .maybeSingle();

  if (activityError || !activity) {
    console.error(
      'ERROR RECUPERANDO ACTIVIDAD:',
      activityError
    );

    return res.status(500).json({
      ok: false,
      complete: false,
      error: 'No se pudo recuperar la actividad existente.'
    });
  }

  const clasificacion = {
    activity_type: activity.activity_type,
    catalog_category: activity.catalog_category
  };

  const operationalTags = Array.isArray(
    activity.operational_tags
  )
    ? activity.operational_tags
    : [];

  const historyRegistered = await asegurarHistorial(
    activityId,
    clasificacion,
    operationalTags,
    activity.quantity
  );

  return responderRecepcion({
    res,
    status: 200,
    activityId,
    duplicate: true,
    attachments: resultadoAdjuntos,
    historyRegistered,
    message
  });
}

// ========================================
// DIAGNÓSTICO DE CONFIGURACIÓN
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
      'Diagnóstico completado. No se muestran secretos.'
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
        'Se recibió body:',
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
        complete: false,
        error: 'No autorizado'
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

    // 5. Validar estructura de adjuntos.
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments
      : [];

    if (attachments.length > 100) {
      return res.status(400).json({
        ok: false,
        error: 'La solicitud supera el máximo de 100 adjuntos.'
      });
    }

    // 6. Consultar si el correo ya fue registrado.
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
        complete: false,
        error: 'No se pudo verificar el correo.'
      });
    }

    // 7. Si existe, reparar/verificar adjuntos e historial.
    if (existing) {
      return await completarActividadExistente({
        res,
        activityId: existing.id,
        attachments,
        message: 'Actividad existente verificada correctamente.'
      });
    }

    // 8. Clasificación automática.
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

    const operationalTags = Array.isArray(
      clasificacion.operational_tags
    )
      ? clasificacion.operational_tags
      : [];

    // 9. Detectar prioridad.
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

    // 10. Contar modelos en Excel.
    const resultadoExcel = contarModelosExcel(attachments);

    let quantity = resultadoExcel.quantity;
    let quantitySource = resultadoExcel.quantity_source;

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

    // 11. Preparar actividad.
    const activity = {
      source_type: 'outlook',
      source_email_id: messageId,
      title,

      requester_name: textoOpcional(payload.from_name),
      requester_email: textoOpcional(payload.from_email),

      quantity,
      quantity_source: quantitySource,
      priority,

      activity_type: clasificacion.activity_type,
      catalog_category: clasificacion.catalog_category,
      classification_status: clasificacion.classification_status,
      classification_confidence: clasificacion.classification_confidence,
      matched_terms: clasificacion.matched_terms,

      operational_tags: operationalTags,

      observations:
        textoOpcional(payload.observations) ||
        textoOpcional(payload.body_preview) ||
        textoOpcional(payload.body),

      status: 'disponible',
      received_at: receivedAt
    };

    // 12. Insertar actividad.
    const { data: created, error: insertError } = await db
      .from('activities')
      .insert(activity)
      .select('id')
      .single();

    if (insertError) {
      // Puede ocurrir si dos solicitudes llegan al mismo tiempo.
      if (insertError.code === '23505') {
        const { data: duplicate, error: retryLookupError } = await db
          .from('activities')
          .select('id')
          .eq('source_type', 'outlook')
          .eq('source_email_id', messageId)
          .maybeSingle();

        if (retryLookupError) {
          console.error(
            'ERROR RECUPERANDO DUPLICADO:',
            retryLookupError
          );

          return res.status(500).json({
            ok: false,
            complete: false,
            error: 'No se pudo recuperar la actividad duplicada.'
          });
        }

        if (duplicate) {
          return await completarActividadExistente({
            res,
            activityId: duplicate.id,
            attachments,
            message: 'Actividad existente verificada correctamente.'
          });
        }
      }

      console.error(
        'ERROR INSERTANDO ACTIVIDAD:',
        insertError
      );

      return res.status(500).json({
        ok: false,
        complete: false,
        error: 'No se pudo registrar la actividad.'
      });
    }

    // 13. Registrar historial.
    const historyRegistered = await asegurarHistorial(
      created.id,
      clasificacion,
      operationalTags,
      quantity
    );

    // 14. Procesar adjuntos.
    const resultadoAdjuntos = await procesarAdjuntos(
      created.id,
      attachments
    );

    // 15. Diagnóstico.
    console.log('====== WEBHOOK OUTLOOK ======');
    console.log('Actividad:', created.id);
    console.log('Correo:', messageId);
    console.log('Categoría:', clasificacion.catalog_category);
    console.log('Etiquetas operativas:', operationalTags);
    console.log(
      'Clasificación:',
      clasificacion.classification_status
    );
    console.log('Prioridad:', priority);
    console.log('Cantidad de modelos:', quantity);
    console.log('Origen cantidad:', quantitySource);
    console.log('Adjuntos:', resultadoAdjuntos);
    console.log('Historial registrado:', historyRegistered);
    console.log('=============================');

    // 16. Respuesta para Apps Script.
    return responderRecepcion({
      res,
      status: 201,
      activityId: created.id,
      duplicate: false,
      attachments: resultadoAdjuntos,
      historyRegistered,
      message: 'Actividad registrada correctamente.',
      extra: {
        activity_type: clasificacion.activity_type,
        catalog_category: clasificacion.catalog_category,
        operational_tags: operationalTags,
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
        }
      }
    });

  } catch (error) {
    console.error('ERROR GENERAL WEBHOOK:', error);

    return res.status(500).json({
      ok: false,
      complete: false,
      error: 'Error interno del servidor'
    });
  }
});

module.exports = router;
