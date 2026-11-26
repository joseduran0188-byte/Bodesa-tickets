
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const {
  requireAuth,
  requireStaff,
  requireAdmin
} = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireStaff);

// ========================================
// CLIENTE ADMINISTRATIVO DE SUPABASE
// ========================================

let supabaseAdmin = null;

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  supabaseAdmin = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );

  return supabaseAdmin;
}

// ========================================
// CONFIGURACIÓN GENERAL
// ========================================

function baseUrl(req) {
  return `/sesion/${encodeURIComponent(req.params.sessionToken)}/actividades`;
}

function paginationUrl(req, page) {
  const params = new URLSearchParams();

  const category = String(req.query.category || '').trim();
  const tag = String(req.query.tag || '').trim();

  if (category) params.set('category', category);
  if (tag) params.set('tag', tag);

  params.set('page', String(page));

  return `${baseUrl(req)}?${params.toString()}`;
}

function renderData(req, extra = {}) {
  return {
    user: req.user,
    sessionToken: req.params.sessionToken,
    dashboardUrl: baseUrl(req),

    logoutUrl:
      `/sesion/${encodeURIComponent(req.params.sessionToken)}/logout`,

    paginationUrl: (page) => paginationUrl(req, page),

    categoriaLabel: (key) => {
      const categoriaPrincipal = obtenerCategoriaPrincipal(key);

      const categoria = CATEGORIAS_RESUMEN.find(
        item => item.key === categoriaPrincipal
      );

      return categoria?.label || 'Por clasificar';
    },

    formatDate: (date) => {
      if (!date) return '—';

      return new Date(date).toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    },

    ...extra
  };
}

function textoOpcional(value) {
  const texto = String(value ?? '').trim();
  return texto || null;
}

const PRIORIDADES_VALIDAS = [
  'baja',
  'media',
  'alta',
  'urgente'
];

const ORDEN_PRIORIDADES = {
  urgente: 4,
  alta: 3,
  media: 2,
  baja: 1
};

const ESTADOS_TABLERO = [
  'disponible',
  'en_proceso',
  'pendiente_validacion',
  'devuelta',
  'validada'
];

const ESTADOS_OPERATIVOS = [
  'disponible',
  'en_proceso',
  'pendiente_validacion',
  'devuelta'
];

// ========================================
// CATÁLOGO PRINCIPAL DE CATEGORÍAS
// ========================================

const CATEGORIAS_RESUMEN = [
  { key: 'precios_costos', label: 'Precios y costos' },
  { key: 'codigos_catalogo', label: 'Códigos y catálogo' },
  { key: 'claves_marcas', label: 'Claves y marcas' },
  { key: 'tallas_surtido', label: 'Tallas y surtido' },
  { key: 'descuentos_promociones', label: 'Descuentos y promociones' },
  { key: 'movimientos_especiales', label: 'Movimientos especiales' },
  { key: 'patrones_dc', label: 'Patrones DC' },
  { key: 'por_clasificar', label: 'Por clasificar' }
];

// ========================================
// EQUIVALENCIAS DE CATEGORÍAS HISTÓRICAS
// No modifica catalog_category en Supabase.
// ========================================

const EQUIVALENCIAS_CATEGORIAS = {
  precios_costos: [
    'precios_costos'
  ],

  codigos_catalogo: [
    'codigos_catalogo',
    'ean_upc'
  ],

  claves_marcas: [
    'claves_marcas',
    'clases_reclasificacion',
    'marcas_descripciones'
  ],

  tallas_surtido: [
    'tallas_surtido'
  ],

  descuentos_promociones: [
    'descuentos_promociones'
  ],

  movimientos_especiales: [
    'movimientos_especiales'
  ],

  patrones_dc: [
    'patrones_dc'
  ],

  por_clasificar: [
    'por_clasificar',
    'proveedores',
    'temporadas_modelos',
    'condiciones_comerciales'
  ]
};

// ========================================
// CATEGORÍAS HISTÓRICAS RECONOCIDAS
// ========================================

const TODAS_LAS_CATEGORIAS_RECONOCIDAS = [
  ...new Set(
    Object.values(EQUIVALENCIAS_CATEGORIAS).flat()
  )
];

const CATEGORIAS_CLASIFICADAS = [
  ...new Set(
    Object.entries(EQUIVALENCIAS_CATEGORIAS)
      .filter(([categoriaPrincipal]) => {
        return categoriaPrincipal !== 'por_clasificar';
      })
      .flatMap(([, equivalencias]) => equivalencias)
  )
];

// ========================================
// OBTENER CATEGORÍA PRINCIPAL
// ========================================

function obtenerCategoriaPrincipal(categoriaOriginal) {
  const categoria = String(
    categoriaOriginal || 'por_clasificar'
  ).trim().toLowerCase();

  for (const [principal, equivalencias] of Object.entries(
    EQUIVALENCIAS_CATEGORIAS
  )) {
    if (equivalencias.includes(categoria)) {
      return principal;
    }
  }

  return 'por_clasificar';
}

// ========================================
// OBTENER EQUIVALENCIAS DE UNA CATEGORÍA
// ========================================

function obtenerEquivalenciasCategoria(categoriaPrincipal) {
  return EQUIVALENCIAS_CATEGORIAS[categoriaPrincipal] || [];
}

// ========================================
// CATÁLOGO DE ETIQUETAS OPERATIVAS
// ========================================

const ETIQUETAS_RESUMEN = [
  { key: 'OL04', label: 'OL04' },
  { key: 'DDD', label: 'DDD' },
  { key: 'PVC', label: 'PVC' }
];

// ========================================
// ESTADOS
// ========================================

const ESTADOS_RESUMEN = [
  { key: 'disponible', label: 'Disponibles' },
  { key: 'en_proceso', label: 'En proceso' },
  { key: 'pendiente_validacion', label: 'Pendientes de validación' },
  { key: 'devuelta', label: 'Devueltas' },
  { key: 'validada', label: 'Validadas' },
  { key: 'cancelada', label: 'Canceladas' }
];

// ========================================
// CREAR RESUMEN VACÍO
// ========================================

function crearResumenVacio() {
  return {
    totalActividades: 0,
    totalModelos: 0,

    categorias: CATEGORIAS_RESUMEN.map(categoria => ({
      ...categoria,
      actividades: 0,
      modelos: 0
    })),

    estados: ESTADOS_RESUMEN.map(estado => ({
      ...estado,
      total: 0
    })),

    etiquetas: ETIQUETAS_RESUMEN.map(etiqueta => ({
      ...etiqueta,
      actividades: 0
    }))
  };
}

// ========================================
// OBTENER RESUMEN COMPLETO
// ========================================

async function obtenerResumenActividades(supabase) {
  const resumen = crearResumenVacio();

  const categoriasPorClave = new Map(
    resumen.categorias.map(item => [
      item.key,
      item
    ])
  );

  const estadosPorClave = new Map(
    resumen.estados.map(item => [
      item.key,
      item
    ])
  );

  const etiquetasPorClave = new Map(
    resumen.etiquetas.map(item => [
      item.key,
      item
    ])
  );

  const TAMANO_BLOQUE = 1000;

  const {
    data: primerBloque,
    count,
    error
  } = await supabase
    .from('activities')
    .select(
      'id, status, catalog_category, quantity, operational_tags',
      { count: 'exact' }
    )
    .order('id', {
      ascending: true
    })
    .range(0, TAMANO_BLOQUE - 1);

  if (error) throw error;

  const totalRegistros = count || 0;

  function procesarBloque(registros) {
    for (const actividad of registros || []) {
      const estado = String(
        actividad.status || ''
      ).trim().toLowerCase();

      const categoriaOriginal = String(
        actividad.catalog_category || 'por_clasificar'
      ).trim().toLowerCase();

      const categoriaPrincipal =
        obtenerCategoriaPrincipal(categoriaOriginal);

      const cantidad = Number(actividad.quantity) || 0;

      resumen.totalActividades += 1;
      resumen.totalModelos += cantidad;

      const categoriaResumen =
        categoriasPorClave.get(categoriaPrincipal);

      if (categoriaResumen) {
        categoriaResumen.actividades += 1;
        categoriaResumen.modelos += cantidad;
      }

      const estadoResumen = estadosPorClave.get(estado);

      if (estadoResumen) {
        estadoResumen.total += 1;
      }

      const etiquetas = Array.isArray(
        actividad.operational_tags
      )
        ? actividad.operational_tags
        : [];

      const etiquetasUnicas = new Set(
        etiquetas.map(etiqueta =>
          String(etiqueta).trim().toUpperCase()
        )
      );

      for (const etiqueta of etiquetasUnicas) {
        const etiquetaResumen =
          etiquetasPorClave.get(etiqueta);

        if (etiquetaResumen) {
          etiquetaResumen.actividades += 1;
        }
      }
    }
  }

  procesarBloque(primerBloque);

  for (
    let desde = TAMANO_BLOQUE;
    desde < totalRegistros;
    desde += TAMANO_BLOQUE
  ) {
    const hasta = Math.min(
      desde + TAMANO_BLOQUE - 1,
      totalRegistros - 1
    );

    const {
      data,
      error: errorBloque
    } = await supabase
      .from('activities')
      .select(
        'id, status, catalog_category, quantity, operational_tags'
      )
      .order('id', {
        ascending: true
      })
      .range(desde, hasta);

    if (errorBloque) throw errorBloque;

    procesarBloque(data);
  }

  if (resumen.totalActividades !== totalRegistros) {
    console.warn(
      'ADVERTENCIA: el total leído no coincide con Supabase.',
      {
        totalSupabase: totalRegistros,
        totalLeido: resumen.totalActividades
      }
    );
  }

  return resumen;
}

// ========================================
// VALIDAR FILTROS DEL DASHBOARD
// ========================================

function obtenerFiltros(req) {
  const categoriaSolicitada = String(
    req.query.category || ''
  ).trim();

  const etiquetaSolicitada = String(
    req.query.tag || ''
  ).trim().toUpperCase();

  const categoriaValida = CATEGORIAS_RESUMEN.some(
    item => item.key === categoriaSolicitada
  );

  const etiquetaValida = ETIQUETAS_RESUMEN.some(
    item => item.key === etiquetaSolicitada
  );

  return {
    categoriaFiltro: categoriaValida
      ? categoriaSolicitada
      : '',

    etiquetaFiltro: etiquetaValida
      ? etiquetaSolicitada
      : ''
  };
}

// ========================================
// APLICAR FILTRO DE CATEGORÍA
// ========================================

function aplicarFiltroCategoria(consulta, categoriaFiltro) {
  if (!categoriaFiltro) return consulta;

  if (categoriaFiltro === 'por_clasificar') {
    const listaExcluidas = CATEGORIAS_CLASIFICADAS.join(',');

    return consulta.or(
      `catalog_category.is.null,catalog_category.not.in.(${listaExcluidas})`
    );
  }

  const equivalencias = obtenerEquivalenciasCategoria(
    categoriaFiltro
  );

  if (!equivalencias.length) return consulta;

  return consulta.in(
    'catalog_category',
    equivalencias
  );
}

// ========================================
// DASHBOARD DE ACTIVIDADES
// PAGINACIÓN: 10 REGISTROS POR PÁGINA
// ========================================

router.get('/', async (req, res) => {
  try {
    const REGISTROS_POR_PAGINA = 10;

    const {
      categoriaFiltro,
      etiquetaFiltro
    } = obtenerFiltros(req);

    const pageParam = String(req.query.page || '1');

    const paginaSolicitada = /^\d+$/.test(pageParam)
      ? Number(pageParam)
      : 1;

    const paginaInicial = Math.max(1, paginaSolicitada);

    const desde = (paginaInicial - 1) * REGISTROS_POR_PAGINA;
    const hasta = desde + REGISTROS_POR_PAGINA - 1;

    let consulta = req.supabase
      .from('activities')
      .select(`
        *,
        current_responsible:profiles!activities_current_responsible_id_fkey(
          full_name,
          email
        )
      `, {
        count: 'exact'
      });

    consulta = aplicarFiltroCategoria(
      consulta,
      categoriaFiltro
    );

    if (etiquetaFiltro) {
      consulta = consulta.filter(
        'operational_tags',
        'cs',
        JSON.stringify([etiquetaFiltro])
      );
    }

    const {
      data: activities,
      count,
      error
    } = await consulta
      .order('received_at', {
        ascending: false,
        nullsFirst: false
      })
      .order('created_at', {
        ascending: false
      })
      .range(desde, hasta);

    if (error) {
      console.error('ERROR DASHBOARD ACTIVIDADES:', error);

      return res.status(500).send(
        'Error al cargar actividades'
      );
    }

    const totalActividades = count || 0;

    const totalPaginas = Math.max(
      1,
      Math.ceil(totalActividades / REGISTROS_POR_PAGINA)
    );

    if (
      paginaInicial > totalPaginas &&
      totalActividades > 0
    ) {
      return res.redirect(
        302,
        paginationUrl(req, totalPaginas)
      );
    }

    const paginaActual = Math.min(
      paginaInicial,
      totalPaginas
    );

    const inicioVentana = Math.max(
      1,
      Math.min(paginaActual - 2, totalPaginas - 4)
    );

    const paginas = Array.from(
      {
        length: Math.min(5, totalPaginas)
      },
      (_, i) => inicioVentana + i
    );

    const registrosActuales = activities || [];

    const desdeRegistro = totalActividades === 0
      ? 0
      : desde + 1;

    const hastaRegistro = Math.min(
      desde + registrosActuales.length,
      totalActividades
    );

    let resumenActividades = crearResumenVacio();

    try {
      resumenActividades = await obtenerResumenActividades(
        req.supabase
      );

      console.log('========== RESUMEN ACTIVIDADES ==========');
      console.log('Total actividades:', resumenActividades.totalActividades);
      console.log('Total modelos:', resumenActividades.totalModelos);

      console.log(
        'Resumen por categoría consolidada:',
        resumenActividades.categorias.map(item => ({
          categoria: item.key,
          actividades: item.actividades,
          modelos: item.modelos
        }))
      );

      console.log('Resumen por etiqueta:', resumenActividades.etiquetas);
      console.log('Resumen por estado:', resumenActividades.estados);
      console.log('=========================================');

    } catch (errorResumen) {
      console.error(
        'ERROR AL CALCULAR RESUMEN DE ACTIVIDADES:',
        errorResumen
      );
    }

    console.log('========== PAGINACIÓN ACTIVIDADES ==========');
    console.log('Página actual:', paginaActual);
    console.log('Total actividades:', totalActividades);
    console.log('Total páginas:', totalPaginas);
    console.log('Registros obtenidos:', registrosActuales.length);
    console.log('Rango:', desdeRegistro, '-', hastaRegistro);
    console.log('Filtro categoría:', categoriaFiltro || 'Todas');
    console.log('Filtro etiqueta:', etiquetaFiltro || 'Todas');
    console.log('============================================');

    return res.render(
      'actividades/dashboard',
      renderData(req, {
        title: 'Capturas / Actividades',
        activities: registrosActuales,
        resumenActividades,
        paginaActual,
        totalPaginas,
        totalActividades,
        registrosPorPagina: REGISTROS_POR_PAGINA,
        desdeRegistro,
        hastaRegistro,
        paginas,
        tienePaginaAnterior: paginaActual > 1,
        tienePaginaSiguiente: paginaActual < totalPaginas,
        paginaAnterior: paginaActual - 1,
        paginaSiguiente: paginaActual + 1,
        categoriaFiltro,
        etiquetaFiltro,
        categoriasFiltro: CATEGORIAS_RESUMEN,
        etiquetasFiltro: ETIQUETAS_RESUMEN
      })
    );

  } catch (err) {
    console.error('ERROR DASHBOARD:', err);

    return res.status(500).send('Error interno');
  }
});

// ========================================
// MÉTRICAS DE PRODUCTIVIDAD
// ========================================

router.get('/metricas', async (req, res) => {
  try {
    const diasSolicitados = Number.parseInt(
      req.query.dias,
      10
    );

    const dias = Number.isInteger(diasSolicitados)
      ? Math.min(Math.max(diasSolicitados, 1), 365)
      : 30;

    const {
      data: metricas,
      error
    } = await req.supabase.rpc(
      'metricas_productividad',
      {
        p_dias: dias
      }
    );

    if (error) {
      console.error('ERROR MÉTRICAS:', error);

      return res.status(500).send(
        'No se pudieron cargar las métricas'
      );
    }

    const totales = (metricas || []).reduce(
      (acc, m) => {
        acc.tomadas += Number(m.tomadas) || 0;
        acc.terminadas += Number(m.terminadas) || 0;
        acc.validadas += Number(m.validadas) || 0;
        acc.liberadas += Number(m.liberadas) || 0;

        return acc;
      },
      {
        tomadas: 0,
        terminadas: 0,
        validadas: 0,
        liberadas: 0
      }
    );

    return res.render(
      'actividades/metricas',
      renderData(req, {
        title: 'Métricas de Productividad',
        metricas: metricas || [],
        totales,
        dias
      })
    );

  } catch (err) {
    console.error('ERROR INTERNO MÉTRICAS:', err);

    return res.status(500).send('Error interno');
  }
});

// ========================================
// MI TRABAJO
// ========================================

router.get('/mi-trabajo', async (req, res) => {
  try {
    const {
      data: misActividades,
      error
    } = await req.supabase
      .from('activities')
      .select('*')
      .eq('current_responsible_id', req.user.id)
      .in('status', [
        'en_proceso',
        'pendiente_validacion',
        'devuelta'
      ])
      .order('started_at', {
        ascending: false
      });

    if (error) {
      console.error('ERROR MI TRABAJO:', error);

      return res.status(500).send(
        'No se pudieron cargar tus actividades'
      );
    }

    return res.render(
      'actividades/mi-trabajo',
      renderData(req, {
        title: 'Mi trabajo',
        misActividades: misActividades || []
      })
    );

  } catch (err) {
    console.error('ERROR INTERNO MI TRABAJO:', err);

    return res.status(500).send('Error interno');
  }
});

// ========================================
// TABLERO KANBAN
// ========================================

router.get('/tablero', async (req, res) => {
  try {
    const selectActividades = `
      *,
      current_responsible:profiles!activities_current_responsible_id_fkey(
        full_name,
        email
      )
    `;

    const {
      data: activas,
      error: errorActivas
    } = await req.supabase
      .from('activities')
      .select(selectActividades)
      .in('status', ESTADOS_OPERATIVOS)
      .order('created_at', {
        ascending: false
      });

    if (errorActivas) {
      console.error(
        'ERROR CONSULTANDO ACTIVIDADES OPERATIVAS:',
        errorActivas
      );

      return res.status(500).send(
        'No se pudieron consultar las actividades operativas'
      );
    }

    const {
      data: validadas,
      error: errorValidadas
    } = await req.supabase
      .from('activities')
      .select(selectActividades)
      .eq('status', 'validada')
      .order('validated_at', {
        ascending: false,
        nullsFirst: false
      })
      .order('created_at', {
        ascending: false
      })
      .limit(15);

    if (errorValidadas) {
      console.error(
        'ERROR CONSULTANDO ACTIVIDADES VALIDADAS:',
        errorValidadas
      );

      return res.status(500).send(
        'No se pudieron consultar las actividades validadas'
      );
    }

    const columnas = {};

    ESTADOS_TABLERO.forEach(estado => {
      columnas[estado] = [];
    });

    const estadosEncontrados = {};

    (activas || []).forEach(actividad => {
      const estado = String(
        actividad.status || ''
      ).trim().toLowerCase();

      estadosEncontrados[estado] =
        (estadosEncontrados[estado] || 0) + 1;

      if (columnas[estado]) {
        columnas[estado].push(actividad);
      }
    });

    columnas.validada = validadas || [];

    Object.keys(columnas).forEach(estado => {
      columnas[estado].sort((a, b) => {
        const prioridadA = ORDEN_PRIORIDADES[a.priority] || 0;
        const prioridadB = ORDEN_PRIORIDADES[b.priority] || 0;

        if (prioridadA !== prioridadB) {
          return prioridadB - prioridadA;
        }

        return (
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
        );
      });
    });

    console.log('========== DIAGNÓSTICO KANBAN ==========');
    console.log('Actividades operativas:', (activas || []).length);
    console.log('Estados encontrados:', estadosEncontrados);
    console.log('Disponibles:', columnas.disponible.length);
    console.log('En proceso:', columnas.en_proceso.length);
    console.log('Pendientes de validación:', columnas.pendiente_validacion.length);
    console.log('Devueltas:', columnas.devuelta.length);
    console.log('Validadas mostradas:', columnas.validada.length);
    console.log('========================================');

    return res.render(
      'actividades/tablero',
      renderData(req, {
        title: 'Tablero de Capturas',
        columnas
      })
    );

  } catch (err) {
    console.error('ERROR INTERNO TABLERO:', err);

    return res.status(500).send(
      'Error interno al cargar el tablero'
    );
  }
});

// ========================================
// DETALLE DE ACTIVIDAD
// ========================================

router.get('/:id', async (req, res) => {
  try {
    const {
      data: activity,
      error
    } = await req.supabase
      .from('activities')
      .select(`
        *,
        current_responsible:profiles!activities_current_responsible_id_fkey(
          full_name,
          email
        ),
        history:activity_history(
          *,
          actor:profiles!activity_history_actor_id_fkey(
            full_name,
            email
          )
        ),
        attachments:activity_attachments(*)
      `)
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) {
      console.error('ERROR AL CARGAR DETALLE:', error);

      return res.status(500).send(
        'Error al cargar la actividad'
      );
    }

    if (!activity) {
      return res.status(404).send(
        'Actividad no encontrada'
      );
    }

    activity.history = (activity.history || []).sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
    );

    // Ordenar adjuntos por fecha de registro.
    activity.attachments = (
      activity.attachments || []
    ).sort(
      (a, b) =>
        new Date(a.created_at).getTime() -
        new Date(b.created_at).getTime()
    );

    return res.render(
      'actividades/detalle',
      renderData(req, {
        title: activity.title,
        activity
      })
    );

  } catch (err) {
    console.error('ERROR DETALLE:', err);

    return res.status(500).send('Error');
  }
});

// ========================================
// EDITAR ACTIVIDAD (SOLO ADMIN)
// ========================================

router.post('/:id/editar', requireAdmin, async (req, res) => {
  try {
    const activityId = req.params.id;

    const {
      data: anterior,
      error: readError
    } = await req.supabase
      .from('activities')
      .select('*')
      .eq('id', activityId)
      .maybeSingle();

    if (readError) {
      console.error(
        'ERROR CONSULTANDO ACTIVIDAD PARA EDITAR:',
        readError
      );

      return res.status(500).send(
        'No se pudo consultar la actividad'
      );
    }

    if (!anterior) {
      return res.status(404).send(
        'Actividad no encontrada'
      );
    }

    if (anterior.status === 'cancelada') {
      return res.status(400).send(
        'No se pueden editar actividades canceladas'
      );
    }

    const title = String(
      req.body?.title || ''
    ).trim();

    if (!title) {
      return res.status(400).send(
        'El título de la actividad es obligatorio'
      );
    }

    const priority = String(
      req.body?.priority || ''
    ).toLowerCase();

    if (!PRIORIDADES_VALIDAS.includes(priority)) {
      return res.status(400).send(
        'Prioridad no válida'
      );
    }

    let quantity = null;

    if (
      req.body?.quantity !== undefined &&
      String(req.body.quantity).trim() !== ''
    ) {
      quantity = Number(req.body.quantity);

      if (!Number.isInteger(quantity) || quantity < 0) {
        return res.status(400).send(
          'La cantidad debe ser un entero mayor o igual a cero'
        );
      }
    }

    const cambios = {
      title,

      // Si el formulario no envía el campo,
      // conservar el valor que ya existe.
      requester_name:
        req.body?.requester_name !== undefined
          ? textoOpcional(req.body.requester_name)
          : anterior.requester_name,

      requester_email:
        req.body?.requester_email !== undefined
          ? textoOpcional(req.body.requester_email)
          : anterior.requester_email,

      activity_type: textoOpcional(
        req.body?.activity_type
      ),

      quantity,
      priority,

      observations: textoOpcional(
        req.body?.observations
      ),

      updated_at: new Date().toISOString()
    };

    const camposAuditables = [
      'title',
      'requester_name',
      'requester_email',
      'activity_type',
      'quantity',
      'priority',
      'observations'
    ];

    const modificaciones = {};

    camposAuditables.forEach(campo => {
      const valorAnterior = anterior[campo] ?? null;
      const valorNuevo = cambios[campo] ?? null;

      if (valorAnterior !== valorNuevo) {
        modificaciones[campo] = {
          anterior: valorAnterior,
          nuevo: valorNuevo
        };
      }
    });

    if (Object.keys(modificaciones).length === 0) {
      return res.redirect(
        303,
        `${baseUrl(req)}/${activityId}`
      );
    }

    const {
      error: updateError
    } = await req.supabase
      .from('activities')
      .update(cambios)
      .eq('id', activityId);

    if (updateError) {
      console.error(
        'ERROR ACTUALIZANDO ACTIVIDAD:',
        updateError
      );

      return res.status(500).send(
        'No se pudieron guardar los cambios'
      );
    }

    const {
      error: historyError
    } = await req.supabase
      .from('activity_history')
      .insert({
        activity_id: activityId,
        actor_id: req.user.id,
        action: 'actividad_editada',
        previous_status: anterior.status,
        new_status: anterior.status,
        comments: 'Actividad modificada por el administrador',
        metadata: {
          cambios: modificaciones
        }
      });

    if (historyError) {
      console.error(
        'ERROR REGISTRANDO EDICIÓN EN HISTORIAL:',
        historyError
      );

      return res.status(500).send(
        'Los cambios se guardaron, pero no se pudo registrar la modificación en el historial. Contacta al administrador del sistema.'
      );
    }

    return res.redirect(
      303,
      `${baseUrl(req)}/${activityId}`
    );

  } catch (err) {
    console.error('ERROR EDITAR ACTIVIDAD:', err);

    return res.status(500).send(
      'Error interno al editar actividad'
    );
  }
});

// ========================================
// CANCELAR ACTIVIDAD (SOLO ADMIN)
// ========================================

router.post('/:id/eliminar', requireAdmin, async (req, res) => {
  try {
    const activityId = req.params.id;

    const reason = String(
      req.body?.cancellation_reason || ''
    ).trim();

    if (!reason) {
      return res.status(400).send(
        'Debes indicar el motivo de cancelación'
      );
    }

    const { data, error } = await req.supabase.rpc(
      'cancelar_actividad',
      {
        p_activity_id: activityId,
        p_reason: reason
      }
    );

    if (error) {
      console.error('ERROR CANCELANDO ACTIVIDAD:', error);

      const message = error.message || '';

      if (message.includes('Actividad no encontrada')) {
        return res.status(404).send(
          'Actividad no encontrada'
        );
      }

      if (message.includes('ya está cancelada')) {
        return res.status(400).send(
          'La actividad ya se encuentra cancelada'
        );
      }

      if (message.includes('motivo')) {
        return res.status(400).send(
          'Debes indicar el motivo de cancelación'
        );
      }

      return res.status(400).send(
        message || 'No se pudo cancelar la actividad'
      );
    }

    return res.redirect(
      303,
      `${baseUrl(req)}/${activityId}`
    );

  } catch (err) {
    console.error('ERROR CANCELAR ACTIVIDAD:', err);

    return res.status(500).send(
      'Error interno al cancelar actividad'
    );
  }
});

// ========================================
// DESVALIDAR ACTIVIDAD (SOLO ADMIN)
// ========================================

router.post('/:id/desvalidar', requireAdmin, async (req, res) => {
  try {
    const activityId = req.params.id;

    const reason = String(
      req.body?.reason || ''
    ).trim();

    if (!reason) {
      return res.status(400).send(
        'Debes indicar el motivo de la desvalidación'
      );
    }

    const { error } = await req.supabase.rpc(
      'desvalidar_actividad',
      {
        p_activity_id: activityId,
        p_reason: reason
      }
    );

    if (error) throw error;

    return res.redirect(
      303,
      `${baseUrl(req)}/${activityId}`
    );

  } catch (err) {
    console.error('ERROR DESVALIDAR ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo desvalidar la actividad'
    );
  }
});

// ========================================
// REACTIVAR ACTIVIDAD CANCELADA (SOLO ADMIN)
// ========================================

router.post('/:id/reactivar', requireAdmin, async (req, res) => {
  try {
    const activityId = req.params.id;

    const reason = String(
      req.body?.reason || ''
    ).trim();

    const mode = String(
      req.body?.mode || ''
    ).trim();

    if (!reason) {
      return res.status(400).send(
        'Debes indicar el motivo de la reactivación'
      );
    }

    if (!['disponible', 'responsable'].includes(mode)) {
      return res.status(400).send(
        'Selecciona una modalidad de reactivación válida'
      );
    }

    const { error } = await req.supabase.rpc(
      'reactivar_actividad',
      {
        p_activity_id: activityId,
        p_keep_responsible: mode === 'responsable',
        p_reason: reason
      }
    );

    if (error) throw error;

    return res.redirect(
      303,
      `${baseUrl(req)}/${activityId}`
    );

  } catch (err) {
    console.error('ERROR REACTIVAR ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo reactivar la actividad'
    );
  }
});

// ========================================
// VISUALIZAR ADJUNTO
// ========================================

router.get(
  '/:id/adjunto/:attachmentId/ver',
  async (req, res) => {
    try {
      const {
        data: att,
        error
      } = await req.supabase
        .from('activity_attachments')
        .select(`
          id,
          activity_id,
          file_path,
          file_name,
          mime_type
        `)
        .eq('id', req.params.attachmentId)
        .eq('activity_id', req.params.id)
        .maybeSingle();

      if (error) {
        console.error(
          'ERROR AL BUSCAR ADJUNTO PARA VISUALIZAR:',
          error
        );

        return res.status(500).send(
          'Error al consultar el archivo'
        );
      }

      if (!att) {
        return res.status(404).send(
          'Archivo no encontrado'
        );
      }

      if (!att.file_path) {
        return res.status(404).send(
          'El archivo no tiene una ruta válida'
        );
      }

      const admin = getSupabaseAdmin();

      const {
        data: signed,
        error: signError
      } = await admin.storage
        .from('activity-attachments')
        .createSignedUrl(
          att.file_path,
          300,
          {
            download: false
          }
        );

      if (signError || !signed?.signedUrl) {
        console.error(
          'ERROR AL GENERAR URL DE VISUALIZACIÓN:',
          signError
        );

        return res.status(500).send(
          'No se pudo generar el enlace para visualizar el archivo'
        );
      }

      res.setHeader(
        'Cache-Control',
        'no-store, private'
      );

      return res.redirect(
        302,
        signed.signedUrl
      );

    } catch (err) {
      console.error(
        'ERROR AL VISUALIZAR ADJUNTO:',
        err
      );

      return res.status(500).send(
        'Error al visualizar el archivo'
      );
    }
  }
);

// ========================================
// DESCARGAR ADJUNTO
// ========================================

router.get(
  '/:id/adjunto/:attachmentId',
  async (req, res) => {
    try {
      const {
        data: att,
        error
      } = await req.supabase
        .from('activity_attachments')
        .select(`
          id,
          activity_id,
          file_path,
          file_name
        `)
        .eq('id', req.params.attachmentId)
        .eq('activity_id', req.params.id)
        .maybeSingle();

      if (error) {
        console.error(
          'ERROR AL BUSCAR ADJUNTO:',
          error
        );

        return res.status(500).send(
          'Error al consultar el archivo'
        );
      }

      if (!att) {
        return res.status(404).send(
          'Archivo no encontrado'
        );
      }

      if (!att.file_path) {
        return res.status(404).send(
          'El archivo no tiene una ruta válida'
        );
      }

      const admin = getSupabaseAdmin();

      const {
        data: signed,
        error: signError
      } = await admin.storage
        .from('activity-attachments')
        .createSignedUrl(
          att.file_path,
          300,
          {
            download: att.file_name || true
          }
        );

      if (signError || !signed?.signedUrl) {
        console.error(
          'ERROR AL GENERAR URL DE DESCARGA:',
          signError
        );

        return res.status(500).send(
          'No se pudo generar el enlace de descarga'
        );
      }

      res.setHeader(
        'Cache-Control',
        'no-store, private'
      );

      return res.redirect(
        302,
        signed.signedUrl
      );

    } catch (err) {
      console.error(
        'ERROR AL DESCARGAR ADJUNTO:',
        err
      );

      return res.status(500).send(
        'Error al descargar el archivo'
      );
    }
  }
);

// ========================================
// TOMAR ACTIVIDAD
// ========================================

router.post('/:id/tomar', async (req, res) => {
  try {
    const responsibleName = String(
      req.body?.responsible_name || ''
    ).trim();

    if (!responsibleName) {
      return res.redirect(
        303,
        `${baseUrl(req)}?error=${encodeURIComponent('Debes escribir el nombre del responsable.')}`
      );
    }

    if (responsibleName.length > 120) {
      return res.redirect(
        303,
        `${baseUrl(req)}?error=${encodeURIComponent('El nombre no puede superar los 120 caracteres.')}`
      );
    }

    const { error } = await req.supabase.rpc(
      'tomar_actividad',
      {
        p_activity_id: req.params.id,
        p_responsible_name: responsibleName
      }
    );

    if (error) throw error;

    return res.redirect(
      303,
      baseUrl(req)
    );

  } catch (err) {
    console.error('ERROR TOMAR ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo tomar la actividad'
    );
  }
});

// ========================================
// MARCAR ACTIVIDAD COMO TERMINADA
// ========================================

router.post('/:id/terminar', async (req, res) => {
  try {
    const { error } = await req.supabase.rpc(
      'marcar_terminada',
      {
        p_activity_id: req.params.id
      }
    );

    if (error) throw error;

    return res.redirect(
      303,
      baseUrl(req)
    );

  } catch (err) {
    console.error('ERROR TERMINAR ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo terminar la actividad'
    );
  }
});

// ========================================
// VALIDAR ACTIVIDAD (SOLO ADMIN)
// ========================================

router.post('/:id/validar', requireAdmin, async (req, res) => {
  try {
    const { error } = await req.supabase.rpc(
      'validar_actividad',
      {
        p_activity_id: req.params.id
      }
    );

    if (error) throw error;

    return res.redirect(
      303,
      baseUrl(req)
    );

  } catch (err) {
    console.error('ERROR VALIDAR ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo validar la actividad'
    );
  }
});

// ========================================
// LIBERAR ACTIVIDAD
// ========================================

router.post('/:id/liberar', async (req, res) => {
  try {
    const reason = String(
      req.body?.reason || ''
    ).trim() || null;

    const { error } = await req.supabase.rpc(
      'liberar_actividad',
      {
        p_activity_id: req.params.id,
        p_reason: reason
      }
    );

    if (error) throw error;

    return res.redirect(
      303,
      baseUrl(req)
    );

  } catch (err) {
    console.error('ERROR LIBERAR ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo liberar'
    );
  }
});

// ========================================
// DEVOLVER ACTIVIDAD (SOLO ADMIN)
// ========================================

router.post('/:id/devolver', requireAdmin, async (req, res) => {
  try {
    const reason = String(
      req.body?.reason || ''
    ).trim() || 'Devuelta';

    const { error } = await req.supabase.rpc(
      'devolver_actividad',
      {
        p_activity_id: req.params.id,
        p_reason: reason
      }
    );

    if (error) throw error;

    return res.redirect(
      303,
      baseUrl(req)
    );

  } catch (err) {
    console.error('ERROR DEVOLVER ACTIVIDAD:', err);

    return res.status(400).send(
      err.message || 'No se pudo devolver'
    );
  }
});

module.exports = router;
