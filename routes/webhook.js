
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

const MAX_ADJUNTOS = 100;
const MAX_ADJUNTO_BYTES = 3 * 1024 * 1024;

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
// UTILIDADES GENERALES
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

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

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

// ========================================
// OBTENER IDENTIFICADOR ÚNICO DEL MENSAJE
// ========================================

function obtenerIdentificadorMensaje(payload) {
  /*
   * Prioridad:
   *
   * 1. gmail_message_id:
   *    Identifica el mensaje individual en Gmail.
   *
   * 2. message_id:
   *    Compatibilidad con versiones anteriores.
   *
   * 3. original_message_id:
   *    Identificador original de Outlook.
   *
   * No usar thread_id como identificador principal:
   * una conversación puede contener varios correos.
   */

  return textoOpcional(
    payload.gmail_message_id ||
    payload.message_id ||
    payload.original_message_id ||
    payload.originalMessageId
  );
}

// ========================================
// NORMALIZAR ADJUNTOS
// ========================================

function normalizarAdjunto(att) {
  if (!att || typeof att !== 'object') {
    return null;
  }

  const name =
    att.name ??
    att.Name ??
    att.filename ??
    att.fileName ??
    att.file_name;

  const contentBytes =
    att.contentBytes ??
    att.ContentBytes ??
    att.content ??
    att.data;

  const contentType =
    att.contentType ??
    att.ContentType ??
    att.mimeType ??
    att.mime_type ??
    att.type ??
    null;

  const isInline =
    att.isInline === true ||
    att.IsInline === true ||
    att.is_inline === true;

  return {
    name: textoOpcional(name),

    contentBytes:
      typeof contentBytes === 'string'
        ? contentBytes
        : null,

    contentType: textoOpcional(contentType),

    isInline,

    contentId: textoOpcional(
      att.contentId ??
      att.ContentId ??
      att.content_id
    )
  };
}

// ========================================
// DECODIFICAR BASE64
// ========================================

function decodificarAdjunto(contenido) {
  if (
    typeof contenido !== 'string' ||
    !contenido.trim()
  ) {
    throw new Error(
      'El contenido Base64 está vacío.'
    );
  }

  let base64 = contenido.trim();

  if (/^data:[^,]*;base64,/i.test(base64)) {
    base64 = base64.substring(
      base64.indexOf(',') + 1
    );
  }

  base64 = base64.replace(/\s/g, '');

  base64 = base64
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  base64 = base64.replace(/=+$/, '');

  if (
    !base64 ||
    !/^[A-Za-z0-9+/]+$/.test(base64)
  ) {
    throw new Error(
      'El contenido no tiene un formato Base64 válido.'
    );
  }

  if (base64.length % 4 === 1) {
    throw new Error(
      'El contenido Base64 está incompleto.'
    );
  }

  const padding =
    (4 - (base64.length % 4)) % 4;

  const base64Completo =
    base64 + '='.repeat(padding);

  const buffer = Buffer.from(
    base64Completo,
    'base64'
  );

  if (!buffer.length) {
    throw new Error(
      'El archivo decodificado está vacío.'
    );
  }

  const original = base64Completo
    .replace(/=+$/, '');

  const convertido = buffer
    .toString('base64')
    .replace(/=+$/, '');

  if (original !== convertido) {
    throw new Error(
      'No fue posible verificar la integridad del Base64.'
    );
  }

  if (buffer.length > MAX_ADJUNTO_BYTES) {
    throw new Error(
      'El archivo supera el límite permitido de 3 MB.'
    );
  }

  return buffer;
}

// ========================================
// DETECTAR MIME POR CONTENIDO REAL
// ========================================

function detectarMimePorFirma(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 4
  ) {
    return null;
  }

  // JPEG
  if (
    buffer[0] === 0xFF &&
    buffer[1] === 0xD8 &&
    buffer[2] === 0xFF
  ) {
    return 'image/jpeg';
  }

  // PNG
  if (
    buffer.subarray(0, 8).equals(
      Buffer.from([
        0x89, 0x50, 0x4E, 0x47,
        0x0D, 0x0A, 0x1A, 0x0A
      ])
    )
  ) {
    return 'image/png';
  }

  // GIF
  const gif = buffer
    .subarray(0, 6)
    .toString('ascii');

  if (gif === 'GIF87a' || gif === 'GIF89a') {
    return 'image/gif';
  }

  // WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // PDF
  if (
    buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  ) {
    return 'application/pdf';
  }

  return null;
}

// ========================================
// OBTENER MIME TYPE
// ========================================

function obtenerMimeType(att, nombre, buffer) {
  const detectado = detectarMimePorFirma(buffer);

  if (detectado) {
    return detectado;
  }

  const recibido = textoOpcional(
    att?.contentType
  );

  if (
    recibido &&
    /^[\w.+-]+\/[\w.+-]+$/.test(recibido)
  ) {
    return recibido.toLowerCase();
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
    avif: 'image/avif',

    pdf: 'application/pdf',

    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xls: 'application/vnd.ms-excel',

    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',

    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',

    csv: 'text/csv',
    txt: 'text/plain',
    zip: 'application/zip'
  };

  return tipos[extension] ||
    'application/octet-stream';
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

  for (const original of attachments) {
    const att = normalizarAdjunto(original);

    if (!att?.name || !att.contentBytes) {
      continue;
    }

    const extension = obtenerExtension(att.name);

    if (!['xlsx', 'xlsm', 'xls'].includes(extension)) {
      continue;
    }

    try {
      const buffer = decodificarAdjunto(
        att.contentBytes
      );

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

        const filas = XLSX.utils.sheet_to_json(
          hoja,
          {
            header: 1,
            defval: '',
            raw: false,
            blankrows: false
          }
        );

        const resultadoHoja = {
          nombre: nombreHoja,
          encabezado_encontrado: false,
          fila_encabezado: null,
          columna_codigo: null,
          codigos_detectados: 0
        };

        const limite = Math.min(
          filas.length,
          30
        );

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

          diagnosticoArchivo.hojas.push(
            resultadoHoja
          );

          continue;
        }

        estructuraEncontrada = true;

        resultadoHoja.encabezado_encontrado = true;
        resultadoHoja.fila_encabezado =
          filaEncabezado + 1;

        resultadoHoja.columna_codigo =
          columnaCodigo + 1;

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

          const cantidadAnterior =
            codigosArchivo.size;

          codigosArchivo.add(codigo);
          codigosUnicos.add(codigo);

          if (
            codigosArchivo.size > cantidadAnterior
          ) {
            resultadoHoja.codigos_detectados++;
          }
        }

        diagnosticoArchivo.hojas.push(
          resultadoHoja
        );
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

  return {
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
}

// ========================================
// CONSULTAR ADJUNTOS EXISTENTES
// ========================================

async function obtenerAdjuntosExistentes(activityId) {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from('activity_attachments')
    .select(
      'id, file_name, file_path, file_size, mime_type'
    )
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
// COMPARAR ARCHIVO CON STORAGE
// ========================================

async function objetoStorageCoincide(
  filePath,
  bufferEsperado
) {
  if (!filePath) return false;

  const db = getSupabaseAdmin();

  const { data, error } = await db.storage
    .from(BUCKET_ADJUNTOS)
    .download(filePath);

  if (error || !data) {
    return false;
  }

  try {
    const arrayBuffer = await data.arrayBuffer();

    const bufferStorage = Buffer.from(
      arrayBuffer
    );

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

async function procesarAdjuntos(
  activityId,
  attachments = []
) {
  const db = getSupabaseAdmin();

  const resultados = {
    total: attachments.length,
    exitosos: 0,
    fallidos: 0,
    errores: []
  };

  let existentes = await obtenerAdjuntosExistentes(
    activityId
  );

  const registrosUtilizados = new Set();

  for (const original of attachments) {
    let storagePath = null;

    const att = normalizarAdjunto(original);

    try {
      if (
        !att ||
        !att.name ||
        !att.contentBytes ||
        !att.contentBytes.trim()
      ) {
        throw new Error(
          'El adjunto no contiene nombre o contenido Base64 válido.'
        );
      }

      const nombre = normalizarNombreArchivo(
        att.name
      );

      const buffer = decodificarAdjunto(
        att.contentBytes
      );

      const mimeType = obtenerMimeType(
        att,
        nombre,
        buffer
      );

      console.log('PROCESANDO ADJUNTO:', {
        nombre,
        bytes: buffer.length,
        mimeType,
        isInline: att.isInline,
        contentId: att.contentId
      });

      // ========================================
      // COMPROBAR SI YA ESTÁ ALMACENADO
      // ========================================

      let adjuntoEncontrado = false;

      for (
        let i = 0;
        i < existentes.length;
        i++
      ) {
        if (registrosUtilizados.has(i)) {
          continue;
        }

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
            'ADJUNTO YA ALMACENADO Y VERIFICADO:',
            nombre
          );

          break;
        }
      }

      if (adjuntoEncontrado) {
        continue;
      }

      // ========================================
      // CREAR RUTA ÚNICA
      // ========================================

      const extension = obtenerExtension(nombre);

      storagePath =
        `${activityId}/${randomUUID()}.${extension}`;

      // ========================================
      // SUBIR ARCHIVO BINARIO
      // ========================================

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

      // ========================================
      // VERIFICAR ARCHIVO ALMACENADO
      // ========================================

      const verificado = await objetoStorageCoincide(
        storagePath,
        buffer
      );

      if (!verificado) {
        await db.storage
          .from(BUCKET_ADJUNTOS)
          .remove([storagePath]);

        storagePath = null;

        throw new Error(
          'El archivo almacenado no coincide con el original.'
        );
      }

      // ========================================
      // REGISTRAR METADATOS
      // ========================================

      const {
        data: metadata,
        error: insertError
      } = await db
        .from('activity_attachments')
        .insert({
          activity_id: activityId,
          file_name: nombre,
          file_path: storagePath,
          file_size: buffer.length,
          mime_type: mimeType
        })
        .select(
          'id, file_name, file_path, file_size, mime_type'
        )
        .single();

      if (insertError) {
        await db.storage
          .from(BUCKET_ADJUNTOS)
          .remove([storagePath]);

        storagePath = null;

        throw new Error(
          'Error registrando metadatos: ' +
          insertError.message
        );
      }

      resultados.exitosos++;

      existentes.push(metadata);

      registrosUtilizados.add(
        existentes.length - 1
      );

      console.log('ADJUNTO GUARDADO:', {
        nombre,
        storagePath,
        bytes: buffer.length,
        mimeType,
        isInline: att.isInline
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

  const {
    data: existente,
    error: consultaError
  } = await db
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
    `Etiquetas: ${operationalTags.length ? operationalTags.join(', ') : 'Ninguna'}. ` +
    `Modelos: ${quantity ?? 'No detectados'}.`;

  const {
    error: historyError
  } = await db
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
    received > 0 &&
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

      // Compatibilidad con Apps Script.
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

  const {
    data: activity,
    error: activityError
  } = await db
    .from('activities')
    .select(`
      id,
      activity_type,
      catalog_category,
      operational_tags,
      quantity
    `)
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
// DIAGNÓSTICO
// ========================================

router.get('/diagnostico', (req, res) => {
  return res.status(200).json({
    ok: true,
    webhook: 'activo',

    configuracion: {
      webhook_secret: Boolean(
        process.env.WEBHOOK_SECRET
      ),

      supabase_url: Boolean(
        process.env.SUPABASE_URL
      ),

      supabase_service_role_key: Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    },

    bucket: BUCKET_ADJUNTOS,

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
      console.log(
        'Content-Type:',
        req.headers['content-type']
      );

      console.log(
        'Número de adjuntos recibidos:',
        Array.isArray(payload.attachments)
          ? payload.attachments.length
          : 0
      );

      console.log(
        'Identificador Gmail recibido:',
        Boolean(payload.gmail_message_id)
      );

      console.log(
        'Identificador alternativo recibido:',
        Boolean(payload.message_id)
      );

      console.log(
        'Identificador original recibido:',
        Boolean(payload.original_message_id)
      );

      console.log(
        'Identificador de conversación recibido:',
        Boolean(payload.thread_id)
      );

      console.log('================================');
    }

    // ========================================
    // 1. VALIDAR SECRETO
    // ========================================

    if (!validarSecreto(payload.secret)) {
      return res.status(401).json({
        ok: false,
        complete: false,
        error: 'No autorizado'
      });
    }

    const db = getSupabaseAdmin();

    // ========================================
    // 2. VALIDAR ASUNTO
    // ========================================

    const title = textoOpcional(
      payload.subject
    );

    if (!title) {
      return res.status(400).json({
        ok: false,
        complete: false,
        error: 'subject es obligatorio'
      });
    }

    if (title.length > 500) {
      return res.status(400).json({
        ok: false,
        complete: false,
        error: 'El asunto supera los 500 caracteres.'
      });
    }

    // ========================================
    // 3. IDENTIFICADOR ÚNICO DEL MENSAJE
    // ========================================

    const messageId =
      obtenerIdentificadorMensaje(payload);

    if (!messageId) {
      return res.status(400).json({
        ok: false,
        complete: false,
        error:
          'Falta el identificador del mensaje. Se requiere gmail_message_id, message_id u original_message_id.'
      });
    }

    const threadId = textoOpcional(
      payload.thread_id ||
      payload.gmail_thread_id
    );

    const originalMessageId = textoOpcional(
      payload.original_message_id ||
      payload.originalMessageId
    );

    // ========================================
    // 4. VALIDAR FECHA
    // ========================================

    const receivedAt = obtenerFecha(
      payload.received_at
    );

    if (!receivedAt) {
      return res.status(400).json({
        ok: false,
        complete: false,
        error: 'received_at contiene una fecha inválida.'
      });
    }

    // ========================================
    // 5. VALIDAR ADJUNTOS
    // ========================================

    const attachments = Array.isArray(
      payload.attachments
    )
      ? payload.attachments
      : [];

    if (attachments.length > MAX_ADJUNTOS) {
      return res.status(400).json({
        ok: false,
        complete: false,
        error:
          'Se supera el máximo permitido de adjuntos.'
      });
    }

    if (attachments.length === 0) {
      return res.status(422).json({
        ok: false,
        complete: false,
        error:
          'El correo llegó sin adjuntos. No se marcará como procesado.'
      });
    }

    const adjuntosNormalizados = attachments.map(
      normalizarAdjunto
    );

    // No eliminar adjuntos inline.
    // Se reciben y procesan igual que los demás archivos.

    // ========================================
    // 6. COMPROBAR CORREO DUPLICADO
    // ========================================

    const {
      data: existing,
      error: duplicateError
    } = await db
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

    // ========================================
    // 7. SI YA EXISTE, COMPLETAR ADJUNTOS
    // ========================================

    if (existing) {
      console.log(
        'CORREO DUPLICADO. SE REUTILIZA ACTIVIDAD:',
        existing.id
      );

      return await completarActividadExistente({
        res,
        activityId: existing.id,
        attachments: adjuntosNormalizados,
        message:
          'Actividad existente verificada correctamente.'
      });
    }

    // ========================================
    // 8. CLASIFICACIÓN
    // ========================================

    const datosClasificacion = {
      subject: title,

      body:
        payload.body ||
        payload.body_preview ||
        payload.observations ||
        '',

      attachments: adjuntosNormalizados
    };

    const clasificacion = clasificarActividad(
      datosClasificacion
    );

    const operationalTags = Array.isArray(
      clasificacion.operational_tags
    )
      ? clasificacion.operational_tags
      : [];

    // ========================================
    // 9. PRIORIDAD
    // ========================================

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
        : PRIORIDADES_VALIDAS.includes(
            prioridadRecibida
          )
          ? prioridadRecibida
          : 'media';

    // ========================================
    // 10. CONTAR MODELOS DE EXCEL
    // ========================================

    const resultadoExcel = contarModelosExcel(
      adjuntosNormalizados
    );

    let quantity = resultadoExcel.quantity;

    let quantitySource =
      resultadoExcel.quantity_source;

    if (
      quantity === null &&
      payload.quantity !== undefined &&
      payload.quantity !== null &&
      String(payload.quantity).trim() !== ''
    ) {
      const cantidad = Number(
        payload.quantity
      );

      if (
        Number.isInteger(cantidad) &&
        cantidad >= 0
      ) {
        quantity = cantidad;
        quantitySource = 'payload';
      }
    }

    // ========================================
    // 11. PREPARAR ACTIVIDAD
    // ========================================

    const activity = {
      source_type: 'outlook',

      // ID único del mensaje individual.
      source_email_id: messageId,

      title,

      requester_name: textoOpcional(
        payload.from_name
      ),

      requester_email: textoOpcional(
        payload.from_email
      ),

      quantity,
      quantity_source: quantitySource,
      priority,

      activity_type:
        clasificacion.activity_type,

      catalog_category:
        clasificacion.catalog_category,

      classification_status:
        clasificacion.classification_status,

      classification_confidence:
        clasificacion.classification_confidence,

      matched_terms:
        clasificacion.matched_terms,

      operational_tags: operationalTags,

      observations:
        textoOpcional(payload.observations) ||
        textoOpcional(payload.body_preview) ||
        textoOpcional(payload.body),

      status: 'disponible',
      received_at: receivedAt
    };

    // ========================================
    // 12. INSERTAR ACTIVIDAD
    // ========================================

    const {
      data: created,
      error: insertError
    } = await db
      .from('activities')
      .insert(activity)
      .select('id')
      .single();

    if (insertError) {
      // Otra ejecución pudo insertar el mismo correo
      // entre la consulta y el INSERT.

      if (insertError.code === '23505') {
        const {
          data: duplicate,
          error: lookupError
        } = await db
          .from('activities')
          .select('id')
          .eq('source_type', 'outlook')
          .eq('source_email_id', messageId)
          .maybeSingle();

        if (lookupError) {
          console.error(
            'ERROR RECUPERANDO DUPLICADO:',
            lookupError
          );

          return res.status(500).json({
            ok: false,
            complete: false,
            error:
              'No se pudo recuperar la actividad duplicada.'
          });
        }

        if (duplicate) {
          return await completarActividadExistente({
            res,
            activityId: duplicate.id,
            attachments: adjuntosNormalizados,
            message:
              'Actividad existente verificada correctamente.'
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
        error:
          'No se pudo registrar la actividad.'
      });
    }

    // ========================================
    // 13. REGISTRAR HISTORIAL
    // ========================================

    const historyRegistered = await asegurarHistorial(
      created.id,
      clasificacion,
      operationalTags,
      quantity
    );

    // ========================================
    // 14. GUARDAR TODOS LOS ARCHIVOS
    // ========================================

    const resultadoAdjuntos = await procesarAdjuntos(
      created.id,
      adjuntosNormalizados
    );

    // ========================================
    // 15. DIAGNÓSTICO
    // ========================================

    console.log('====== WEBHOOK OUTLOOK ======');
    console.log('Actividad:', created.id);
    console.log('Correo:', messageId);
    console.log('Conversación:', threadId || 'No recibida');
    console.log(
      'Mensaje original:',
      originalMessageId || 'No recibido'
    );

    console.log(
      'Categoría:',
      clasificacion.catalog_category
    );

    console.log('Prioridad:', priority);
    console.log('Cantidad:', quantity);
    console.log('Adjuntos:', resultadoAdjuntos);
    console.log('Historial:', historyRegistered);
    console.log('=============================');

    // ========================================
    // 16. CONFIRMACIÓN PARA APPS SCRIPT
    // ========================================

    return responderRecepcion({
      res,
      status: 201,

      activityId: created.id,

      duplicate: false,

      attachments: resultadoAdjuntos,

      historyRegistered,

      message:
        'Actividad registrada correctamente.',

      extra: {
        activity_type:
          clasificacion.activity_type,

        catalog_category:
          clasificacion.catalog_category,

        operational_tags:
          operationalTags,

        priority,

        status: 'disponible',

        classification_status:
          clasificacion.classification_status,

        classification_confidence:
          clasificacion.classification_confidence,

        matched_terms:
          clasificacion.matched_terms,

        quantity,

        quantity_source:
          quantitySource,

        message_id: messageId,

        thread_id: threadId,

        original_message_id:
          originalMessageId,

        excel: {
          estructura_encontrada:
            resultadoExcel.estructura_encontrada,

          archivos_leidos:
            resultadoExcel.archivos_leidos,

          errores:
            resultadoExcel.errores
        }
      }
    });

  } catch (error) {
    console.error(
      'ERROR GENERAL WEBHOOK:',
      error
    );

    return res.status(500).json({
      ok: false,
      complete: false,
      error: 'Error interno del servidor'
    });
  }
});

module.exports = router;
