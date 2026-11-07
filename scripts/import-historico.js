/**
 * Uso:
 *   node scripts/import-historico.js "./Reporte pendiente captura al XX PARA PROGRAMA HERRAMIENTA.xlsx"
 *
 * Requiere: npm install xlsx
 */

require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltan variables de entorno');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Indica la ruta del archivo Excel');
    process.exit(1);
  }

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  console.log(`Filas encontradas: ${rows.length}`);

  let insertados = 0;
  let errores = 0;

  for (const row of rows) {
    // Ajusta los nombres de columna según tu Excel real
    const title = (row['Asunto'] || row['asunto'] || '').toString().trim();
    if (!title) continue;

    const requester = (row['De'] || row['de'] || '').toString().trim() || null;
    const quantity = Number(row['Cant.'] || row['Cantidad'] || null) || null;
    const priorityRaw = (row['Prioridad'] || '').toString().toLowerCase();
    const priority = ['baja', 'media', 'alta', 'urgente'].includes(priorityRaw)
      ? priorityRaw
      : 'media';

    const activityType = (row['TIPO'] || row['Tipo'] || '').toString().trim() || null;
    const observations = (row['observaciones'] || row['Observaciones'] || '').toString().trim() || null;
    const responsable = (row['NOMBRE DE QUIEN LO TRABAJO'] || '').toString().trim() || null;

    // Fechas
    let receivedAt = null;
    if (row['Creado']) {
      const d = new Date(row['Creado']);
      if (!isNaN(d.getTime())) receivedAt = d.toISOString();
    }

    const status = responsable ? 'validada' : 'disponible'; // o ajusta según tu lógica

    const { error } = await supabase.from('activities').insert({
      source_type: 'historical',
      title,
      requester_name: requester,
      quantity,
      priority,
      activity_type: activityType,
      observations,
      status,
      received_at: receivedAt,
      created_at: receivedAt || new Date().toISOString()
    });

    if (error) {
      console.error('Error en fila:', title, error.message);
      errores++;
    } else {
      insertados++;
    }
  }

  console.log(`\nListo. Insertados: ${insertados} | Errores: ${errores}`);
}

main().catch(console.error);