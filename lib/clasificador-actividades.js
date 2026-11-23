
function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ======================================================
// CATÁLOGO PRINCIPAL DE CATEGORÍAS
// Las nuevas actividades utilizarán estas categorías.
// Las categorías históricas de Supabase no se modifican.
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
    tipo: 'precios_costos',
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
    tipo: 'codigos_catalogo',
    especificas: [
      /\bCODIGOS?\b/,
      /\bCATALOGAR\b/,
      /\bCATALOGACION\b/,
      /\bALTA\s+DE\s+CODIGOS?\b/,
      /\bCREAR\s+CODIGOS?\b/,
      /\bCREACION\s+DE\s+CODIGOS?\b/,
      /\bMODIFICACION\s+DE\s+CODIGOS?\b/,
      /\bDESCATALOGAR\b/,
      /\bEAN\b/,
      /\bEANS\b/,
      /\bUPC\b/,
      /\bCODIGO\s+DE\s+BARRAS\b/,
      /\bCODIGOS\s+DE\s+BARRAS\b/
    ]
  },
  {
    categoria: 'claves_marcas',
    tipo: 'claves_marcas',
    especificas: [
      /\bCAMBIO\s+DE\s+CLAVES?\b/,
      /\bCAMBIAR\s+CLAVES?\b/,
      /\bCAMBIO\s+DE\s+CLASES?\b/,
      /\bCAMBIAR\s+CLASES?\b/,
      /\bCLASE\s+(?:CENTRO|CORPORATIVA)\b/,
      /\bRECLASIFICACION\b/,
      /\bRECLASIFICAR\b/,
      /\bGRUPO\s+DE\s+ARTICULO\b/,
      /\bCAMBIO\s+DE\s+GA\b/,
      /\bCAMBIAR\s+GA\b/,
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
      /\bPVC\b/,
      /\bUPC\s*2D\b/,
      /\bALTAS?\b/,
      /\bBAJAS?\b/,
      /\bCOLORES?\b/,
      /\bDOC\b/
    ]
  }
];

// ======================================================
// TÉRMINOS HISTÓRICOS QUE REQUIEREN REVISIÓN
//
// Se conservan como evidencia de clasificación, pero no
// se asignan automáticamente a una categoría nueva.
// ======================================================

const TERMINOS_REQUIEREN_REVISION = [
  /\bCAMBIAR\s+PROVEEDOR\b/,
  /\bCAMBIO\s+DE\s+PROVEEDOR\b/,
  /\bCAMBIO\s+PROVEEDOR\b/,
  /\bAGREGAR\s+PROVEEDOR\b/,
  /\bALTA\s+DE\s+PROVEEDOR\b/,
  /\bCAMBIAR\s+TEMPORADA\b/,
  /\bCAMBIO\s+DE\s+TEMPORADA\b/,
  /\bTEMPORADAS?\b/,
  /\bCAMBIAR\s+MODELO\b/,
  /\bCAMBIO\s+DE\s+MODELO\b/,
  /\bCONDICIONES?\s+COMERCIALES\b/,
  /\bPLANCHAR\s+CONDICIONES?\s+COMERCIALES\b/
];

// ======================================================
// ETIQUETAS OPERATIVAS
// ======================================================

function detectarEtiquetas(texto = '') {
  const contenido = normalizar(texto);
  const etiquetas = [];

  if (/\bOL\s*0?4\b/.test(contenido)) {
    etiquetas.push('OL04');
  }

  if (/\bDDD\b|\bTRIPLE\s+DDD\b/.test(contenido)) {
    etiquetas.push('DDD');
  }

  if (/\bPVC\b/.test(contenido)) {
    etiquetas.push('PVC');
  }

  return [...new Set(etiquetas)];
}

// ======================================================
// OBTENER TÉRMINOS QUE REQUIEREN REVISIÓN
// ======================================================

function obtenerTerminosRevision(texto = '') {
  return TERMINOS_REQUIEREN_REVISION
    .filter(regex => regex.test(texto))
    .map(regex => texto.match(regex)?.[0])
    .filter(Boolean);
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

      // UPC 2D pertenece a movimientos especiales,
      // no a la categoría general de códigos.
      if (
        regla.categoria === 'codigos_catalogo' &&
        /\bUPC\s*2D\b/.test(texto)
      ) {
        especificas = especificas.filter(
          termino => !/\bUPC\b/.test(termino)
        );
      }

      // DDD tiene prioridad sobre la catalogación genérica.
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

      // PVC acompañado de reclasificación se considera
      // una actividad de claves y marcas.
      if (
        regla.categoria === 'movimientos_especiales' &&
        etiquetas.includes('PVC') &&
        /\bRECLASIFICACION\b|\bRECLASIFICAR\b/.test(texto)
      ) {
        especificas = especificas.filter(
          termino => !/\bPVC\b/.test(termino)
        );
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
  etiquetas = [],
  terminosAdicionales = []
) {
  const terminos = [
    ...coincidencias.flatMap(
      coincidencia => coincidencia.matched_terms
    ),
    ...terminosAdicionales
  ];

  return {
    activity_type: 'otro',
    catalog_category: 'por_clasificar',
    classification_status: 'requiere_revision',
    classification_confidence: 'baja',
    matched_terms: [
      ...new Set(terminos.filter(Boolean))
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
  etiquetas = [],
  terminosAdicionales = []
) {
  // Si se detectan varias categorías principales,
  // la actividad necesita revisión manual.
  if (coincidencias.length !== 1) {
    return resultadoRevision(
      coincidencias,
      etiquetas,
      terminosAdicionales
    );
  }

  const resultado = coincidencias[0];

  if (resultado.especificas.length === 0) {
    return resultadoRevision(
      coincidencias,
      etiquetas,
      terminosAdicionales
    );
  }

  return {
    activity_type: resultado.tipo,
    catalog_category: resultado.categoria,
    classification_status: 'clasificada',
    classification_confidence: confianza,
    matched_terms: [
      ...new Set([
        ...resultado.matched_terms,
        ...terminosAdicionales
      ])
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

    const terminosRevision =
      obtenerTerminosRevision(asunto);

    if (
      coincidenciasAsunto.length > 0 ||
      terminosRevision.length > 0
    ) {
      return clasificarCoincidencias(
        coincidenciasAsunto,
        'alta',
        detectarEtiquetas(asunto),
        terminosRevision
      );
    }
  }

  // 2. Revisar nombres de archivos adjuntos.
  if (adjuntos.length > 0) {
    const textoAdjuntos = adjuntos.join(' ');

    const coincidenciasAdjuntos =
      obtenerCoincidencias(textoAdjuntos);

    const terminosRevision =
      obtenerTerminosRevision(textoAdjuntos);

    if (
      coincidenciasAdjuntos.length > 0 ||
      terminosRevision.length > 0
    ) {
      return clasificarCoincidencias(
        coincidenciasAdjuntos,
        'media',
        detectarEtiquetas(textoAdjuntos),
        terminosRevision
      );
    }
  }

  // 3. Revisar el cuerpo del correo.
  if (cuerpo) {
    const coincidenciasCuerpo =
      obtenerCoincidencias(cuerpo);

    const terminosRevision =
      obtenerTerminosRevision(cuerpo);

    if (
      coincidenciasCuerpo.length > 0 ||
      terminosRevision.length > 0
    ) {
      return clasificarCoincidencias(
        coincidenciasCuerpo,
        'baja',
        detectarEtiquetas(cuerpo),
        terminosRevision
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
    detectarEtiquetas(textoCompleto),
    obtenerTerminosRevision(textoCompleto)
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
