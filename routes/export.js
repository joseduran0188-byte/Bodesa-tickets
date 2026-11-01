
const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');

const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/excel', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Utilizar el cliente autenticado del usuario
    const supabase = req.supabase;

    // Consultar las solicitudes registradas
    const { data: tickets, error } = await supabase
      .from('tickets')
      .select(`
        *,
        solicitante:profiles!solicitante_id (full_name),
        tecnico:profiles!tecnico_asignado_id (full_name)
      `)
      .order('fecha_creacion', { ascending: false });

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
      { header: 'Fecha de solicitud', key: 'fecha_creacion', width: 22 },
      { header: 'Nombre de la actividad', key: 'titulo', width: 40 },
      { header: 'Fecha/Hora en que se tomó', key: 'fecha_atencion', width: 25 },
      { header: 'Fecha en que se realizó', key: 'fecha_resolucion', width: 25 },
      { header: 'Persona que atendió', key: 'tecnico', width: 25 },
      { header: 'Prioridad', key: 'prioridad', width: 15 },
      { header: 'Estado', key: 'estado', width: 18 },
      { header: 'Solicitante', key: 'solicitante', width: 25 },
      { header: 'Categoría', key: 'categoria', width: 18 }
    ];

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

    // Formatear fechas
    const formatoFecha = (fecha) => {
      if (!fecha) return '';

      return new Date(fecha).toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    };

    // Agregar registros
    (tickets || []).forEach((ticket) => {
      sheet.addRow({
        fecha_creacion: formatoFecha(ticket.fecha_creacion),
        titulo: ticket.titulo || '',
        fecha_atencion: formatoFecha(ticket.fecha_atencion),
        fecha_resolucion: formatoFecha(ticket.fecha_resolucion),
        tecnico: ticket.tecnico?.full_name || '',
        prioridad: ticket.prioridad || '',
        estado: ticket.estado || '',
        solicitante: ticket.solicitante?.full_name || '',
        categoria: ticket.categoria || ''
      });
    });

    // Alinear contenido
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = {
          vertical: 'middle',
          wrapText: true
        };
      }
    });

    // Filtros en encabezados
    sheet.autoFilter = {
      from: 'A1',
      to: 'I1'
    };

    // Congelar encabezado
    sheet.views = [
      { state: 'frozen', ySplit: 1 }
    ];

    // Configurar respuesta para descargar Excel
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      'attachment; filename="solicitudes-ti-bodesa.xlsx"'
    );

    // Generar y enviar archivo
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
