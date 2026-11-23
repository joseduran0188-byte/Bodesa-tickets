
function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const CATEGORIAS = [
  {
    categoria: 'patrones_dc',
    tipo: 'patrones_dc',
    palabras: [
      /\bDC\s*[-:]?\s*E\d{5,}\b/
    ]
  },
  {
    categoria: 'precios_costos',
    tipo: 'cambio_precios',
    palabras: [
      /\bPRECIOS?\b/,
      /\bCOSTOS?\b/
    ]
  },
  {
    categoria: 'codigos_catalogo',
    tipo: 'codigos',
    palabras: [
      /\bCODIGOS?\b/,
      /\bCATALOGAR\b/,
      /\bCATALOGACION\b/,
      /\bDESCATALOGAR\b/
    ]
  },
  {
    categoria: 'claves_marcas',
    tipo: 'claves_marcas',
    palabras: [
      /\bCLAVES?\b/,
      /\bMARCAS?\b/,
      /\bCAMBIO DE CLAVE\b/,
      /\bCAMBIAR CLAVE\b/,
      /\bCAMBIAR MARCA\b/,
      /\bRECLASIFICAR\b/
    ]
  },
  {
    categoria: 'tallas_surtido',
    tipo: 'tallas_surtido',
    palabras: [
      /\bAGREGAR TALLAS?\b/,
      /\bTALLAS?\b/,
      /\bSURTIR\b/,
      /\bSURTIDO\b/
    ]
  },
  {
    categoria: 'descuentos_promociones',
    tipo: 'descuentos_promociones',
    palabras: [
      /\bDESCUENTOS?\b/,
      /\bPUNTOS\b/,
      /\bPROMOCIONES?\b/,
      /\b2X3\b/,
      /\b3X2\b/
    ]
  },
  {
    categoria: 'movimientos_especiales',
    tipo: 'movimientos_especiales',
    palabras: [
      /\bALTAS?\b/,
      /\bBAJAS?\b/,
      /\bLABORATORIO\b/,
      /\bUPC\s*2D\b/,
      /\bDOC\b/,
      /\bCOLOR(?:ES)?\b/,
      /\bELIMINAR CENTRO\b/
    ]
  }
];

function obtenerCoincidencias(texto) {
  return CATEGORIAS
    .map(regla => ({
      categoria: regla.categoria,
      tipo: regla.tipo,
      matched_terms: regla.palabras
        .filter(regex => regex.test(texto))
        .map(regex => texto.match(regex)?.[0])
        .filter(Boolean)
    }))
    .filter(regla => regla.matched_terms.length > 0);
}

function resultadoRevision(coincidencias = []) {
  return {
    activity_type: 'otro',
    catalog_category: 'por_clasificar',
    classification_status: 'requiere_revision',
    classification_confidence: 'baja',
    matched_terms: coincidencias.flatMap(
      coincidencia => coincidencia.matched_terms
    )
  };
}

function clasificarCoincidencias(coincidencias, confianza) {
  if (coincidencias.length !== 1) {
    return resultadoRevision(coincidencias);
  }

  const resultado = coincidencias[0];

  return {
    activity_type: resultado.tipo,
    catalog_category: resultado.categoria,
    classification_status: 'clasificada',
    classification_confidence: confianza,
    matched_terms: resultado.matched_terms
  };
}

function clasificarActividad(datos = {}) {
  const asunto = normalizar(datos.subject || '');
  const cuerpo = normalizar(datos.body || '');

  const adjuntos = Array.isArray(datos.attachments)
    ? datos.attachments
        .map(adjunto => normalizar(adjunto.name || ''))
        .filter(Boolean)
    : [];

  // 1. El asunto tiene prioridad sobre cualquier otra fuente.
  if (asunto) {
    const coincidenciasAsunto = obtenerCoincidencias(asunto);

    if (coincidenciasAsunto.length > 0) {
      return clasificarCoincidencias(
        coincidenciasAsunto,
        'alta'
      );
    }
  }

  // 2. Si el asunto no identifica la necesidad,
  // revisamos los nombres de los archivos adjuntos.
  if (adjuntos.length > 0) {
    const coincidenciasAdjuntos = obtenerCoincidencias(
      adjuntos.join(' ')
    );

    if (coincidenciasAdjuntos.length > 0) {
      return clasificarCoincidencias(
        coincidenciasAdjuntos,
        'media'
      );
    }
  }

  // 3. Como último recurso revisamos el cuerpo del correo.
  if (cuerpo) {
    const coincidenciasCuerpo = obtenerCoincidencias(cuerpo);

    if (coincidenciasCuerpo.length > 0) {
      return clasificarCoincidencias(
        coincidenciasCuerpo,
        'baja'
      );
    }
  }

  // 4. Si no hay evidencia suficiente, requiere revisión.
  return resultadoRevision();
}

function detectarPrioridad(datos = {}) {
  const texto = normalizar(
    `${datos.subject || ''} ${datos.body || ''}`
  );

  if (/\b(URGENTE|URGENCIA|INMEDIATO|INMEDIATA)\b/.test(texto)) {
    return 'urgente';
  }

  if (/\b(ALTA PRIORIDAD|PRIORIDAD ALTA)\b/.test(texto)) {
    return 'alta';
  }

  if (/\b(BAJA PRIORIDAD|PRIORIDAD BAJA)\b/.test(texto)) {
    return 'baja';
  }

  return 'media';
}

module.exports = {
  clasificarActividad,
  detectarPrioridad
};
