
const REGLAS_ACTIVIDAD = [
  {
    tipo: 'catalogacion_modelos',
    palabras: [
      'catalogación',
      'catalogacion',
      'modelos',
      'alta de modelos',
      'modelo nuevo'
    ]
  },
  {
    tipo: 'ordenes_compra',
    palabras: [
      'orden de compra',
      'órdenes de compra',
      'ordenes de compra',
      'oc ',
      'pedido de compra'
    ]
  },
  {
    tipo: 'codigos',
    palabras: [
      'código',
      'codigo',
      'códigos',
      'codigos',
      'alta de código',
      'alta de codigo'
    ]
  },
  {
    tipo: 'cambio_precios',
    palabras: [
      'cambio de precio',
      'cambio de precios',
      'actualización de precio',
      'actualizacion de precio',
      'modificación de precio',
      'modificacion de precio'
    ]
  }
];

function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function clasificarActividad(datos = {}) {
  const asunto = normalizar(datos.subject);
  const cuerpo = normalizar(datos.body);
  const adjuntos = Array.isArray(datos.attachments)
    ? datos.attachments.map(a => normalizar(a.name)).join(' ')
    : '';

  const textoCompleto = `${asunto} ${cuerpo} ${adjuntos}`;

  for (const regla of REGLAS_ACTIVIDAD) {
    const coincidencias = regla.palabras.filter(palabra =>
      textoCompleto.includes(normalizar(palabra))
    );

    if (coincidencias.length > 0) {
      return {
        activity_type: regla.tipo,
        classification_status: 'clasificada',
        confidence: asunto.includes(coincidencias[0]) ? 'alta' : 'media',
        matched_terms: coincidencias
      };
    }
  }

  return {
    activity_type: 'otro',
    classification_status: 'requiere_revision',
    confidence: 'baja',
    matched_terms: []
  };
}

function detectarPrioridad(datos = {}) {
  const texto = normalizar(
    `${datos.subject || ''} ${datos.body || ''}`
  );

  if (/\b(urgente|urgencia|inmediato|inmediata)\b/.test(texto)) {
    return 'urgente';
  }

  if (/\b(alta prioridad|prioridad alta)\b/.test(texto)) {
    return 'alta';
  }

  if (/\b(baja prioridad|prioridad baja)\b/.test(texto)) {
    return 'baja';
  }

  return 'media';
}

module.exports = {
  clasificarActividad,
  detectarPrioridad
};
