const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'EiB-X4NyaC8NAN3Oru74EsLrZ5B3IrKIn1p23sKx2ud0GtPt0_dAvJ2AUHpsklMF';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

router.post('/capturas', async (req, res) => {
  try {
    const payload = req.body || {};

    if (payload.secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const title = (payload.subject || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'subject es obligatorio' });
    }

    // Evitar duplicados
    if (payload.message_id) {
      const { data: existing } = await supabaseAdmin
        .from('activities')
        .select('id')
        .eq('source_type', 'outlook')
        .eq('source_email_id', payload.message_id)
        .maybeSingle();

      if (existing) {
        return res.status(200).json({ ok: true, message: 'Ya existía', id: existing.id });
      }
    }

    const priority = ['baja', 'media', 'alta', 'urgente'].includes(
      (payload.priority || '').toLowerCase()
    ) ? payload.priority.toLowerCase() : 'media';

    const activity = {
      source_type: 'outlook',
      source_email_id: payload.message_id || null,
      title,
      requester_name: payload.from_name || null,
      requester_email: payload.from_email || null,
      quantity: Number.isInteger(payload.quantity) ? payload.quantity : null,
      priority,
      activity_type: payload.activity_type || null,
      observations: payload.observations || payload.body_preview || null,
      status: 'disponible',
      received_at: payload.received_at
        ? new Date(payload.received_at).toISOString()
        : new Date().toISOString()
    };

    const { data: created, error } = await supabaseAdmin
      .from('activities')
      .insert(activity)
      .select('id')
      .single();

    if (error) {
      console.error('ERROR INSERT ACTIVITY:', error);
      return res.status(500).json({ error: error.message });
    }

    // Historial
    await supabaseAdmin.from('activity_history').insert({
      activity_id: created.id,
      action: 'creada_por_correo',
      new_status: 'disponible',
      comments: 'Ingresada desde Outlook / Power Automate'
    });

    // ========== ADJUNTOS ==========
    // Power Automate puede enviar:
    // "attachments": [
    //   { "name": "archivo.xlsx", "contentType": "application/vnd.openxmlformats...", "contentBytes": "base64..." }
    // ]
    if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
      for (const att of payload.attachments) {
        try {
          if (!att.name || !att.contentBytes) continue;

          const buffer = Buffer.from(att.contentBytes, 'base64');
          const ext = att.name.split('.').pop() || 'bin';
          const storagePath = `${created.id}/${randomUUID()}.${ext}`;

          const { error: uploadError } = await supabaseAdmin.storage
            .from('activity-attachments')
            .upload(storagePath, buffer, {
              contentType: att.contentType || 'application/octet-stream',
              upsert: false
            });

          if (uploadError) {
            console.error('Error subiendo adjunto:', uploadError);
            continue;
          }

          await supabaseAdmin.from('activity_attachments').insert({
            activity_id: created.id,
            file_name: att.name,
            file_path: storagePath,
            file_size: buffer.length,
            mime_type: att.contentType || null
          });
        } catch (attErr) {
          console.error('Error procesando adjunto:', attErr);
        }
      }
    }

    return res.status(201).json({ ok: true, id: created.id });
  } catch (err) {
    console.error('ERROR WEBHOOK:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;