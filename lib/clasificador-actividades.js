
function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ======================================================
// CATÁLOGO DE CATEGORÍAS
// ======================================================

const CATEGORIAS = [
  {
    categoria: 'patrones_dc',
    tipo: 'patrones_dc',
    especificas: [
      /\bDC\s*[-:]?\s*E\d{5,}\b/
    ]
  },
  {
    categoria: 'precios_costos',
    tipo: 'cambio_precios',
    especificas: [
      /\bPRECIOS?\b/,
      /\bCOSTOS?\b/,
      /\bCAMBIO\s+(?:DE\s+)?PP\b/,
      /\bCAMBIAR\s+PP\b/,
      /\bDEFINIR\s+PP\b/,
      /\bPRECIO\s+PUBLICO\b/
    ]
  },
  {
    categoria: 'codigos_catalogo',
    tipo: 'codigos',
    especificas: [
      /\bCODIGOS?\b/,
      /\bCATALOGAR\b/,
      /\bCATALOGACION\b/,
      /\bALTA\s+DE\s+CODIGOS?\b/,
      /\bCREAR\s+CODIGOS?\b/,
      /\bCREACION\s+DE\s+CODIGOS?\b/,
      /\bMODIFICACION\s+DE\s+CODIGOS?\b/,
      /\bDESCATALOGAR\b/
    ]
  },
  {
    categoria: 'clases_reclasificacion',
    tipo: 'clases_reclasificacion',
    especificas: [
      /\bCAMBIO\s+DE\s+CLASES?\b/,
      /\bCAMBIAR\s+CLASES?\b/,
      /\bCLASE\s+(?:CENTRO|CORPORATIVA)\b/,
      /\bRECLASIFICACION\b/,
      /\bRECLASIFICAR\b/,
      /\bGRUPO\s+DE\s+ARTICULO\b/,
      /\bCAMBIO\s+DE\s+GA\b/,
      /\bCAMBIAR\s+GA\b/
    ]
  },
  {
    categoria: 'ean_upc',
    tipo: 'ean_upc',
    especificas: [
      /\bEAN\b/,
      /\bEANS\b/,
      /\bUPC\b/,
      /\bCODIGO\s+DE\s+BARRAS\b/,
      /\bCODIGOS\s+DE\s+BARRAS\b/
    ]
  },
  {
    categoria: 'marcas_descripciones',
    tipo: 'marcas_descripciones',
    especificas: [
      /\bCAMBIO\s+DE\s+MARCA\b/,
      /\bCAMBIAR\s+MARCA\b/,
      /\bMODIFICAR\s+MARCA\b/,
      /\bCREAR\s+MARCA\b/,
      /\bMODIFICAR\s+DESCRIPCION\b/,
      /\bCAMBIO\s+DE\s+DESCRIPCION\b/,
      /\bCAMBIAR\s+DESCRIPCION\b/
    ]
  },
  {
    categoria: 'tallas_surtido',
    tipo: 'tallas_surtido',
    especificas: [
      /\bAGREGAR\s+TALLAS?\b/,
      /\bCREAR\s+TALLAS?\b/,
      /\bCAMBIAR\s+TALLAS?\b/,
      /\bSURTIR\b/,
      /\bSURTIDO\b/
    ]
  },
  {
    categoria: 'descuentos_promociones',
    tipo: 'descuentos_promociones',
    especificas: [
      /\bDESCUENTOS?\b/,
      /\bRETIRAR\s+DESCUENTO\b/,
      /\bQUITAR\s+DESCUENTO\b/,
      /\bPUNTOS\b/,
      /\bPROMOCIONES?\b/,
      /\b2X3\b/,
      /\b3X2\b/
    ]
  },
  {
    categoria: 'proveedores',
    tipo: 'proveedores',
    especificas: [
      /\bCAMBIAR\s+PROVEEDOR\b/,
      /\bCAMBIO\s+DE\s+PROVEEDOR\b/,
      /\bCAMBIO\s+PROVEEDOR\b/,
      /\bAGREGAR\s+PROVEEDOR\b/,
      /\bALTA\s+DE\s+PROVEEDOR\b/
    ]
  },
  {
    categoria: 'temporadas_modelos',
    tipo: 'temporadas_modelos',
    especificas: [
      /\bCAMBIAR\s+TEMPORADA\b/,
      /\bCAMBIO\s+DE\s+TEMPORADA\b/,
      /\bTEMPORADAS?\b/,
      /\bCAMBIAR\s+MODELO\b/,
      /\bCAMBIO\s+DE\s+MODELO\b/
    ]
  },
  {
    categoria: 'condiciones_comerciales',
    tipo: 'condiciones_comerciales',
    especificas: [
      /\bCONDICIONES?\s+COMERCIALES\b/,
      /\bCOND\.\s*COMERCIALES\b/,
      /\bPLANCHAR\s+CONDICIONES?\s+COMERCIALES\b/
    ]
  },
  {
    categoria: 'movimientos_especiales',
    tipo: 'movimientos_especiales',
    especificas: [
      /\bDDD\b/,
      /\bTRIPLE\s+DDD\b/,
      /\bCOLOCAR\s+DDD\b/,
      /\bQUITAR\s+DDD\b/,
      /\bRETIRAR\s+DDD\b/,
      /\bDESCATALOGAR\s+DDD\b/,
      /\bLABORATORIO\b/,
      /\bELIMINAR\s+CENTRO\b/,
      /\bCOLOCAR\s+PVC\b/,
      /\bQUITAR\s+PVC\b/,
      /\bVALIDACION\s+PVC\b/,
      /\bCATALOGACION\s+PVC\b/,
      /\bPVC\b/
    ]
  },
  {
    // Compatibilidad con clasificaciones anteriores.
    categoria: 'claves_marcas',
    tipo: 'claves_marcas',
    especificas: [
      /\bCAMBIO\s+DE\s+CLAVES?\b/,
      /\bCAMBIAR\s+CLAVES?\b/
    ]
  }
];

// ======================================================
// ETIQUETAS OPERATIVAS
// ======================================================

function detectarEtiquetas(texto = '') {
  const etiquetas = [];

  if (/\bOL\s*0?4\b/.test(texto)) {
    etiquetas.push('OL04');
  }

  if (/\bDDD\b|\bTRIPLE\s+DDD\b/.test(texto)) {
    etiquetas.push('DDD');
  }

  if (/\bPVC\b/.test(texto)) {
    etiquetas.push('PVC');
  }

  return [...new Set(etiquetas)];
}

// ======================================================
// OBTENER COINCIDENCIAS
// ======================================================

function obtenerCoincidencias(texto) {
  const etiquetas = detectarEtiquetas(texto);

  return CATEGORIAS
    .map(regla => {
      let especificas = regla.especificas
        .filter(regex => regex.test(texto))
        .map(regex => texto.match(regex)?.[0])
        .filter(Boolean);

      // DDD tiene prioridad sobre catalogación genérica.
      if (
        regla.categoria === 'codigos_catalogo' &&
        etiquetas.includes('DDD')
      ) {
        especificas = especificas.filter(
          termino =>
            !/\bCATALOGAR\b|\bCATALOGACION\b|\bDESCATALOGAR\b/.test(termino)
        );

        // Conservar códigos cuando realmente se mencionan.
        if (/\bCODIGOS?\b/.test(texto)) {
          especificas.push(
            texto.match(/\bCODIGOS?\b/)?.[0]
          );
        }
      }

      // PVC con reclasificación se trata como reclasificación.
      if (
        regla.categoria === 'movimientos_especiales' &&
        etiquetas.includes('PVC') &&
        /\bRECLASIFICACION\b|\bRECLASIFICAR\b/.test(texto)
      ) {
        especificas = especificas.filter(
          termino => !/\bPVC\b/.test(termino)
        );
      }

      // DDD se considera movimiento especial.
      if (
        regla.categoria === 'movimientos_especiales' &&
        etiquetas.includes('DDD') &&
        !especificas.some(termino => /\bDDD\b/.test(termino))
      ) {
        especificas.push('DDD');
      }

      especificas = [
        ...new Set(especificas.filter(Boolean))
      ];

      return {
        categoria: regla.categoria,
        tipo: regla.tipo,
        especificas,
        genericas: [],
        matched_terms: especificas
      };
    })
    .filter(regla => regla.matched_terms.length > 0);
}

// ======================================================
// RESULTADO PARA REVISIÓN MANUAL
// ======================================================

function resultadoRevision(
  coincidencias = [],
  etiquetas = []
) {
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
    ],
    operational_tags: etiquetas
  };
}

// ======================================================
// CLASIFICAR COINCIDENCIAS
// ======================================================

function clasificarCoincidencias(
  coincidencias,
  confianza,
  etiquetas = []
) {
  // Varias categorías detectadas: revisión manual.
  if (coincidencias.length !== 1) {
    return resultadoRevision(
      coincidencias,
      etiquetas
    );
  }

  const resultado = coincidencias[0];

  if (resultado.especificas.length === 0) {
    return resultadoRevision(
      coincidencias,
      etiquetas
    );
  }

  return {
    activity_type: resultado.tipo,
    catalog_category: resultado.categoria,
    classification_status: 'clasificada',
    classification_confidence: confianza,
    matched_terms: [
      ...new Set(resultado.matched_terms)
    ],
    operational_tags: etiquetas
  };
}

// ======================================================
// CLASIFICAR ACTIVIDAD
// ======================================================

function clasificarActividad(datos = {}) {
  const asunto = normalizar(datos.subject || '');
  const cuerpo = normalizar(datos.body || '');

  const adjuntos = Array.isArray(datos.attachments)
    ? datos.attachments
        .map(adjunto =>
          normalizar(adjunto.name || '')
        )
        .filter(Boolean)
    : [];

  // 1. El asunto tiene prioridad.
  if (asunto) {
    const coincidenciasAsunto =
      obtenerCoincidencias(asunto);

    if (coincidenciasAsunto.length > 0) {
      return clasificarCoincidencias(
        coincidenciasAsunto,
        'alta',
        detectarEtiquetas(asunto)
      );
    }
  }

  // 2. Revisar nombres de archivos adjuntos.
  if (adjuntos.length > 0) {
    const textoAdjuntos = adjuntos.join(' ');

    const coincidenciasAdjuntos =
      obtenerCoincidencias(textoAdjuntos);

    if (coincidenciasAdjuntos.length > 0) {
      return clasificarCoincidencias(
        coincidenciasAdjuntos,
        'media',
        detectarEtiquetas(textoAdjuntos)
      );
    }
  }

  // 3. Revisar el cuerpo del correo.
  if (cuerpo) {
    const coincidenciasCuerpo =
      obtenerCoincidencias(cuerpo);

    if (coincidenciasCuerpo.length > 0) {
      return clasificarCoincidencias(
        coincidenciasCuerpo,
        'baja',
        detectarEtiquetas(cuerpo)
      );
    }
  }

  // 4. Sin evidencia suficiente.
  const textoCompleto = [
    asunto,
    ...adjuntos,
    cuerpo
  ].join(' ');

  return resultadoRevision(
    [],
    detectarEtiquetas(textoCompleto)
  );
}

// ======================================================
// DETECTAR PRIORIDAD
// ======================================================

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

// ======================================================
// EXPORTACIONES
// ======================================================

module.exports = {
  clasificarActividad,
  detectarPrioridad
};
