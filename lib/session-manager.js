const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
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

    const [ivHex, authTagHex, encryptedHex] = value.split(':');

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

async function createTabSession(userId, role, authSession) {
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
            expires_at: expiresAt.toISOString()
        });

    if (error) {
        throw new Error(`No se pudo crear la sesión: ${error.message}`);
    }

    return {
        token,
        expiresAt
    };
}

async function getTabSession(token) {
    if (!token || typeof token !== 'string' || token.length > 200) {
        return null;
    }

    const { data, error } = await supabaseAdmin
        .from('tab_sessions')
        .select('*')
        .eq('token_hash', hashToken(token))
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

    if (error || !data) return null;

    return {
        id: data.id,
        userId: data.user_id,
        role: data.role,
        accessToken: decrypt(data.encrypted_access_token),
        refreshToken: decrypt(data.encrypted_refresh_token),
        expiresAt: data.expires_at
    };
}

async function updateActivity(token) {
    await supabaseAdmin
        .from('tab_sessions')
        .update({
            last_activity: new Date().toISOString()
        })
        .eq('token_hash', hashToken(token));
}

async function deleteTabSession(token) {
    if (!token) return;

    await supabaseAdmin
        .from('tab_sessions')
        .delete()
        .eq('token_hash', hashToken(token));
}

module.exports = {
    createTabSession,
    getTabSession,
    updateActivity,
    deleteTabSession
};