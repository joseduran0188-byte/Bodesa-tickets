
const { createClient } = require('@supabase/supabase-js');

const requiredVariables = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

const missingVariables = requiredVariables.filter(
  (name) => !process.env[name] || !process.env[name].trim()
);

if (missingVariables.length > 0) {
  console.error(
    'Variables de entorno faltantes:',
    missingVariables.join(', ')
  );

  throw new Error('Faltan variables de entorno de Supabase');
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);

const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey
);

module.exports = { supabase, supabaseAdmin };
