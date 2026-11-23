
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
      /\bCOSTOS?\b/,
      /\bCOSTO Y PRECIO\b/,
      /\bCOSTOS Y PRECIOS\b/
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
      /\bCAMBIAR CLAVE\b/,
      /\bCAMBIO DE CLAVE\b/,
      /\bCAMBIAR MARCA\b/,
      /\bRECLASIFICAR\b/
    ]
  },
  {
    categoria: 'tallas_surtido',
    tipo: 'tallas_surtido',
    palabras: [
      /\bAGREGAR TALLAS?\b/,
      /\bSURTIR\b/,
      /\bSURTIDO\b/
    ]
  },
  {
    categoria: 'descuentos_promociones',
    tipo: 'descuentos_promociones',
    palabras: [
      /\bRETIRAR DESCUENTO\b/,
      /\bQUITAR DESCUENTO\b/,
      /\bQUITAR PUNTOS\b/,
      /\bCAMBIO DE PROMO\b/,
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
      /\bUPC 2D\b/,
      /\bMODIFICAR DOC\b/,
      /\bCAMBIAR COLOR\b/,
      /\bELIMINAR CENTRO\b/
    ]
  }
];

function clasificarActividad(datos = {}) {
  const asunto = normalizar(datos.subject || '');
  const cuerpo = normalizar(datos.body || '');
  const adjuntos = Array.isArray(datos.attachments)
    ? datos.attachments.map(a => normalizar(a.name)).join(' ')
    : '';

  const textoCompleto = `${asunto} ${cuerpo} ${adjuntos}`;

  const coincidencias = CATEGORIAS
    .map(regla => ({
      ...regla,
      matched_terms: regla.palabras
        .filter(regex => regex.test(textoCompleto))
        .map(regex => textoCompleto.match(regex)?.[0])
        .filter(Boolean)
    }))
    .filter(regla => regla.matched_terms.length > 0);

  if (coincidencias.length === 0 || coincidencias.length > 1) {
    return {
      activity_type: 'otro',
      catalog_category: 'por_clasificar',
      classification_status: 'requiere_revision',
      classification_confidence: 'baja',
      matched_terms: coincidencias.flatMap(c => c.matched_terms)
    };
  }

  const resultado = coincidencias[0];

  return {
    activity_type: resultado.tipo,
    catalog_category: resultado.categoria,
    classification_status: 'clasificada',
    classification_confidence: asunto && resultado.palabras.some(
      regex => regex.test(asunto)
    ) ? 'alta' : 'media',
    matched_terms: resultado.matched_terms
  };
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
