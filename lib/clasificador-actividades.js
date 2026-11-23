
function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Las reglas se dividen en:
// - especificas: permiten clasificar automáticamente.
// - genericas: requieren revisión para evitar falsos positivos.

const CATEGORIAS = [
  {
    categoria: 'patrones_dc',
    tipo: 'patrones_dc',
    especificas: [
      /\bDC\s*[-:]?\s*E\d{5,}\b/
    ],
    genericas: []
  },
  {
    categoria: 'precios_costos',
    tipo: 'cambio_precios',
    especificas: [
      /\bPRECIOS?\b/,
      /\bCOSTOS?\b/
    ],
    genericas: []
  },
  {
    categoria: 'codigos_catalogo',
    tipo: 'codigos',
    especificas: [
      /\bCODIGOS?\b/,
      /\bCATALOGAR\b/,
      /\bCATALOGACION\b/,
      /\bDESCATALOGAR\b/
    ],
    genericas: []
  },
  {
    categoria: 'claves_marcas',
    tipo: 'claves_marcas',
    especificas: [
      /\bCAMBIO DE CLAVES?\b/,
      /\bCAMBIAR CLAVES?\b/,
      /\bCAMBIO DE MARCAS?\b/,
      /\bCAMBIAR MARCAS?\b/,
      /\bRECLASIFICAR\b/
    ],
    genericas: [
      /\bCLAVES?\b/,
      /\bMARCAS?\b/
    ]
  },
  {
    categoria: 'tallas_surtido',
    tipo: 'tallas_surtido',
    especificas: [
      /\bAGREGAR TALLAS?\b/,
      /\bSURTIR\b/,
      /\bSURTIDO\b/
    ],
    genericas: [
      /\bTALLAS?\b/
    ]
  },
  {
    categoria: 'descuentos_promociones',
    tipo: 'descuentos_promociones',
    especificas: [
      /\bDESCUENTOS?\b/,
      /\bPUNTOS\b/,
      /\bPROMOCIONES?\b/,
      /\b2X3\b/,
      /\b3X2\b/
    ],
    genericas: []
  },
  {
    categoria: 'movimientos_especiales',
    tipo: 'movimientos_especiales',
    especificas: [
      /\bLABORATORIO\b/,
      /\bUPC\s*2D\b/,
      /\bELIMINAR CENTRO\b/
    ],
    genericas: [
      /\bALTAS?\b/,
      /\bBAJAS?\b/,
      /\bDOC\b/,
      /\bCOLOR(?:ES)?\b/
    ]
  }
];

function obtenerCoincidencias(texto) {
  return CATEGORIAS
    .map(regla => {
      const especificas = regla.especificas
        .filter(regex => regex.test(texto))
        .map(regex => texto.match(regex)?.[0])
        .filter(Boolean);

      const genericas = regla.genericas
        .filter(regex => regex.test(texto))
        .map(regex => texto.match(regex)?.[0])
        .filter(Boolean);

      return {
        categoria: regla.categoria,
        tipo: regla.tipo,
        especificas,
        genericas,
        matched_terms: [
          ...especificas,
          ...genericas
        ]
      };
    })
    .filter(regla => regla.matched_terms.length > 0);
}

function resultadoRevision(coincidencias = []) {
  return {
    activity_type: 'otro',
    catalog_category: 'por_clasificar',
    classification_status: 'requiere_revision',
    classification_confidence: 'baja',
    matched_terms: [
      ...new Set(
        coincidencias.flatMap(
          coincidencia => coincidencia.matched_terms
        )
      )
    ]
  };
}

function clasificarCoincidencias(coincidencias, confianza) {
  // Si hay coincidencias de diferentes categorías,
  // no se elige una automáticamente.
  if (coincidencias.length !== 1) {
    return resultadoRevision(coincidencias);
  }

  const resultado = coincidencias[0];

  // Una palabra genérica no es suficiente para clasificar.
  if (resultado.especificas.length === 0) {
    return resultadoRevision(coincidencias);
  }

  return {
    activity_type: resultado.tipo,
    catalog_category: resultado.categoria,
    classification_status: 'clasificada',
    classification_confidence: confianza,
    matched_terms: [
      ...new Set(resultado.matched_terms)
    ]
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

  // 1. El asunto tiene prioridad.
  if (asunto) {
    const coincidenciasAsunto = obtenerCoincidencias(asunto);

    if (coincidenciasAsunto.length > 0) {
      return clasificarCoincidencias(
        coincidenciasAsunto,
        'alta'
      );
    }
  }

  // 2. Revisar nombres de archivos adjuntos.
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

  // 3. Revisar el cuerpo del correo.
  if (cuerpo) {
    const coincidenciasCuerpo = obtenerCoincidencias(cuerpo);

    if (coincidenciasCuerpo.length > 0) {
      return clasificarCoincidencias(
        coincidenciasCuerpo,
        'baja'
      );
    }
  }

  // 4. Sin evidencia suficiente.
  return resultadoRevision();
}

function detectarPrioridad(datos = {}) {
  const texto = normalizar(
    `${datos.subject || ''} ${datos.body || ''}`
  );

  if (
    /\b(URGENTE|URGENCIA|INMEDIATO|INMEDIATA)\b/.test(texto)
  ) {
    return 'urgente';
  }

  if (
    /\b(ALTA PRIORIDAD|PRIORIDAD ALTA)\b/.test(texto)
  ) {
    return 'alta';
  }

  if (
    /\b(BAJA PRIORIDAD|PRIORIDAD BAJA)\b/.test(texto)
  ) {
    return 'baja';
  }

  return 'media';
}

module.exports = {
  clasificarActividad,
  detectarPrioridad
};
