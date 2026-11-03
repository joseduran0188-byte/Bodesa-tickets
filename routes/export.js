
const express = require('express');
const ExcelJS = require('exceljs');

const router = express.Router({ mergeParams: true });

router.get('/excel', async (req, res) => {
  try {
    // Validar que exista una sesión autenticada
    if (!req.user) {
      return res.status(401).send('Debes iniciar sesión.');
    }

    // Permitir exportación únicamente a administradores y técnicos
    if (!['admin', 'tecnico'].includes(req.user.role)) {
      return res.status(403).send('No tienes permiso para exportar solicitudes.');
    }

    // Utilizar el cliente Supabase autenticado
    const supabase = req.supabase;

    if (!supabase) {
      throw new Error('No se encontró el cliente de Supabase.');
    }

    // Consultar las solicitudes
    const { data: tickets, error } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Crear libro de Excel
    const workbook = new ExcelJS.Workbook();

    workbook.creator = 'Sistema de Gestión de Solicitudes TI - Bodesa';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Solicitudes TI - Bodesa');

    // Configurar columnas
    sheet.columns = [
      { header: 'Fecha de solicitud', key: 'created_at', width: 25 },
      { header: 'Nombre de la actividad', key: 'titulo', width: 40 },
      { header: 'Fecha/Hora en que se tomó', key: 'fecha_atencion', width: 28 },
      { header: 'Fecha en que se realizó', key: 'fecha_resolucion', width: 28 },
      { header: 'Persona que atendió', key: 'responsable', width: 25 },
      { header: 'Prioridad', key: 'prioridad', width: 15 },
      { header: 'Estado', key: 'estado', width: 18 },
      { header: 'Solicitante', key: 'solicitante', width: 25 },
      { header: 'Categoría', key: 'categoria', width: 20 }
    ];

    // Formatear fechas en horario de Colima
    const formatoFecha = (fecha) => {
      if (!fecha) return '';

      const fechaValida = new Date(fecha);

      if (Number.isNaN(fechaValida.getTime())) {
        return '';
      }

      return fechaValida.toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    };

    // Traducir estados
    const estados = {
      pendiente: 'Pendiente',
      en_proceso: 'En proceso',
      resuelto: 'Resuelto',
      cerrado: 'Cerrado'
    };

    // Traducir prioridades
    const prioridades = {
      baja: 'Baja',
      media: 'Media',
      alta: 'Alta',
      urgente: 'Urgente'
    };

    // Agregar registros
    (tickets || []).forEach((ticket) => {
      sheet.addRow({
        created_at: formatoFecha(ticket.created_at),
        titulo: ticket.titulo || '',
        fecha_atencion: formatoFecha(ticket.fecha_atencion),
        fecha_resolucion: formatoFecha(ticket.fecha_resolucion),
        responsable: ticket.responsable || '',
        prioridad: prioridades[ticket.prioridad] || ticket.prioridad || '',
        estado: estados[ticket.estado] || ticket.estado || '',
        solicitante: ticket.nombre_solicitante || '',
        categoria: ticket.categoria || ''
      });
    });

    // Estilo del encabezado
    const header = sheet.getRow(1);

    header.font = {
      bold: true,
      color: { argb: 'FFFFFFFF' },
      size: 11
    };

    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' }
    };

    header.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true
    };

    header.height = 30;

    // Alinear contenido
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = {
          vertical: 'middle',
          wrapText: true
        };
      }
    });

    // Filtros
    sheet.autoFilter = {
      from: 'A1',
      to: 'I1'
    };

    // Congelar encabezado
    sheet.views = [
      { state: 'frozen', ySplit: 1 }
    ];

    // Configurar descarga
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="solicitudes-ti-bodesa.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Error al generar el Excel:', err);

    if (!res.headersSent) {
      res.status(500).send('Error al generar el archivo Excel.');
    }
  }
});

module.exports = router;
