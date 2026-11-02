
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
        'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.'
    );
}

const supabaseAdmin = createClient(
    SUPABASE_URL,
    SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    }
);

const ENCRYPTION_KEY = Buffer.from(
    process.env.SESSION_ENCRYPTION_KEY || '',
    'hex'
);

if (ENCRYPTION_KEY.length !== 32) {
    throw new Error(
        'SESSION_ENCRYPTION_KEY debe contener 32 bytes (64 caracteres hexadecimales).'
    );
}

const SESSION_DURATION_HOURS = Number(
    process.env.SESSION_DURATION_HOURS || 12
);

if (
    !Number.isFinite(SESSION_DURATION_HOURS) ||
    SESSION_DURATION_HOURS <= 0
) {
    throw new Error('SESSION_DURATION_HOURS debe ser un número positivo.');
}

function encrypt(value) {
    if (!value) return null;

    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        ENCRYPTION_KEY,
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return [
        iv.toString('hex'),
        authTag.toString('hex'),
        encrypted.toString('hex')
    ].join(':');
}

function decrypt(value) {
    if (!value) return null;

    const partes = value.split(':');

    if (partes.length !== 3) {
        throw new Error('Formato de token cifrado inválido.');
    }

    const [ivHex, authTagHex, encryptedHex] = partes;

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        ENCRYPTION_KEY,
        Buffer.from(ivHex, 'hex')
    );

    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    return Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final()
    ]).toString('utf8');
}

function hashToken(token) {
    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function validarToken(token) {
    return (
        typeof token === 'string' &&
        /^[A-Za-z0-9_-]{40,100}$/.test(token)
    );
}

// Crear sesión independiente.
async function createTabSession(userId, role, authSession) {
    if (
        !userId ||
        !['admin', 'tecnico', 'user'].includes(role) ||
        !authSession ||
        !authSession.access_token ||
        !authSession.refresh_token
    ) {
        throw new Error('Datos insuficientes para crear la sesión.');
    }

    const token = generateToken();

    const expiresAt = new Date(
        Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000
    );

    const { error } = await supabaseAdmin
        .from('tab_sessions')
        .insert({
            token_hash: hashToken(token),
            user_id: userId,
            role,
            encrypted_access_token: encrypt(authSession.access_token),
            encrypted_refresh_token: encrypt(authSession.refresh_token),
            expires_at: expiresAt.toISOString(),
            last_activity: new Date().toISOString()
        });

    if (error) {
        throw new Error(`No se pudo crear la sesión: ${error.message}`);
    }

    return {
        token,
        expiresAt
    };
}

// Obtener sesión.
async function getTabSession(token) {
    if (!validarToken(token)) {
        return null;
    }

    const { data, error } = await supabaseAdmin
        .from('tab_sessions')
        .select(
            'id, token_hash, user_id, role, encrypted_access_token, encrypted_refresh_token, expires_at'
        )
        .eq('token_hash', hashToken(token))
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

    if (error || !data) {
        return null;
    }

    try {
        return {
            id: data.id,
            userId: data.user_id,
            role: data.role,
            accessToken: decrypt(data.encrypted_access_token),
            refreshToken: decrypt(data.encrypted_refresh_token),
            expiresAt: data.expires_at
        };
    } catch (errorDescifrado) {
        console.error('ERROR DESCIFRANDO SESIÓN:', errorDescifrado.message);
        return null;
    }
}

// Guardar tokens nuevos después de una renovación.
// La condición evita sobrescribir una renovación más reciente.
async function updateTabSessionTokens(token, oldRefreshToken, authSession) {
    if (
        !validarToken(token) ||
        !oldRefreshToken ||
        !authSession ||
        !authSession.access_token ||
        !authSession.refresh_token
    ) {
        throw new Error('Datos inválidos para renovar la sesión.');
    }

    const tokenHash = hashToken(token);

    const { data, error } = await supabaseAdmin
        .from('tab_sessions')
        .select('encrypted_refresh_token')
        .eq('token_hash', tokenHash)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

    if (error || !data) {
        return false;
    }

    const refreshActual = decrypt(data.encrypted_refresh_token);

    // Otra petición pudo haber renovado ya esta sesión.
    if (refreshActual !== oldRefreshToken) {
        return false;
    }

    const { data: actualizado, error: errorUpdate } = await supabaseAdmin
        .from('tab_sessions')
        .update({
            encrypted_access_token: encrypt(authSession.access_token),
            encrypted_refresh_token: encrypt(authSession.refresh_token),
            last_activity: new Date().toISOString()
        })
        .eq('token_hash', tokenHash)
        .eq('encrypted_refresh_token', data.encrypted_refresh_token)
        .select('id')
        .maybeSingle();

    if (errorUpdate) {
        throw new Error(
            `No se pudieron actualizar los tokens: ${errorUpdate.message}`
        );
    }

    return Boolean(actualizado);
}

// Actualizar actividad.
async function updateActivity(token) {
    if (!validarToken(token)) return;

    const { error } = await supabaseAdmin
        .from('tab_sessions')
        .update({
            last_activity: new Date().toISOString()
        })
        .eq('token_hash', hashToken(token))
        .gt('expires_at', new Date().toISOString());

    if (error) {
        console.error('ERROR ACTUALIZANDO ACTIVIDAD:', error.message);
    }
}

// Eliminar únicamente la sesión indicada.
async function deleteTabSession(token) {
    if (!validarToken(token)) return;

    const { error } = await supabaseAdmin
        .from('tab_sessions')
        .delete()
        .eq('token_hash', hashToken(token));

    if (error) {
        throw new Error(`No se pudo eliminar la sesión: ${error.message}`);
    }
}

module.exports = {
    createTabSession,
    getTabSession,
    updateTabSessionTokens,
    updateActivity,
    deleteTabSession
};
