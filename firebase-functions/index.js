/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

// Allowed production origins
const allowedOrigins = [
    "https://beta.rekindle.ink",
    "https://rekindle.ink",
    "https://lite.rekindle.ink",
    "https://legacy.rekindle.ink",
    "https://rekindle.website.yandexcloud.net",
];

// Common options for all functions
const callOptions = {
    cors: allowedOrigins,
    maxInstances: 10
};

async function logSecurityAction(type, targetUid, targetName, reason, extra = {}) {
    const logKey = admin.database().ref('security_actions').push().key;
    const entry = {
        type,
        actorUid: 'system',
        actorName: 'System (Auto)',
        targetUid,
        targetName: targetName || targetUid,
        reason,
        createdAt: admin.database.ServerValue.TIMESTAMP,
        undone: false,
        systemAction: true,
        ...extra
    };
    await admin.database().ref(`security_actions/${logKey}`).set(entry);
}

/**
 * Server-side registration with IP ban enforcement.
 * Because this runs on Google's servers, the IP is read from the actual HTTP
 * request — the client cannot spoof or bypass it with browser dev tools.
 *
 * Expects: { username: string, password: string }
 * Returns: { customToken: string } — client signs in with signInWithCustomToken()
 */
exports.registerUser = onCall(callOptions, async (request) => {
    const { username, password } = request.data;

    // Basic input validation (mirrors the client-side checks)
    if (!username || !password) {
        throw new HttpsError('invalid-argument', 'Username and password are required.');
    }
    if (username.length > 20) {
        throw new HttpsError('invalid-argument', 'Username must be 20 characters or less.');
    }
    if (!/^[a-zA-Z0-9]+$/.test(username)) {
        throw new HttpsError('invalid-argument', 'Username can only contain letters and numbers.');
    }

    // Get the real client IP from the server-side request
    let ip = '';
    try {
        const forwarded = request.rawRequest?.headers?.['x-forwarded-for'];
        const rawIp = (forwarded ? forwarded.split(',')[0].trim() : request.rawRequest?.ip) || '';
        // Strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
        ip = rawIp.replace(/^::ffff:/, '');
    } catch (ipErr) {
        logger.warn('Unable to extract client IP:', ipErr);
    }

    // Check banned IPs — this happens on the server, nothing the client can bypass
    if (ip) {
        try {
            const safeIp = ip.replace(/\./g, '-').replace(/:/g, '_');
            const snap = await admin.database().ref(`banned_ips/${safeIp}`).once('value');
            if (snap.exists()) {
                logger.warn(`Blocked registration from banned IP: ${ip} (username attempt: ${username})`);
                await logSecurityAction('ip_ban_registration', '', username, `Blocked registration from banned IP: ${ip}`);
                throw new HttpsError('permission-denied', 'Registration is not available from your network.');
            }
        } catch (e) {
            if (e.code && e.code.startsWith('functions/')) throw e; // re-throw HttpsError
            logger.error('Banned IP check error:', e);
            // Don't block registration on a transient DB read failure
        }
    }

    // Create the account
    const email = `${username}@rekindle.ink`;
    let userRecord;
    try {
        userRecord = await admin.auth().createUser({ email, password });
    } catch (e) {
        if (e.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'That username is already taken.');
        }
        if (e.code === 'auth/weak-password') {
            throw new HttpsError('invalid-argument', 'Password is too weak.');
        }
        logger.error('createUser error:', e);
        throw new HttpsError('internal', 'Registration failed. Please try again.');
    }

    // Everything after createUser is wrapped so a partial failure doesn't leave
    // the client with a confusing 500 and no actionable error.
    try {
        // Store IP server-side immediately — reliable regardless of client behaviour
        if (ip) {
            await admin.database().ref(`users_private/${userRecord.uid}/ipAddress`).set(ip);
        }

        // Post-creation defence-in-depth: if the IP was banned in the race window
        // between the pre-check and createUser, disable the account immediately.
        if (ip) {
            const safeIp = ip.replace(/\./g, '-').replace(/:/g, '_');
            const snap = await admin.database().ref(`banned_ips/${safeIp}`).once('value');
            if (snap.exists()) {
                logger.warn(`Banned IP registered (race) — disabling account: ${ip} (uid: ${userRecord.uid})`);
                await admin.auth().updateUser(userRecord.uid, { disabled: true });
                await logSecurityAction('ip_ban_login', userRecord.uid, username, `Account disabled after registration from banned IP: ${ip}`);
                throw new HttpsError('permission-denied', 'Registration is not available from your network.');
            }
        }

        // Return a custom token so the client can call signInWithCustomToken()
        const customToken = await admin.auth().createCustomToken(userRecord.uid);
        return { customToken };
    } catch (e) {
        if (e.code && e.code.startsWith('functions/')) throw e; // re-throw HttpsError
        logger.error('Post-registration error for uid:', userRecord.uid, e);
        throw new HttpsError('internal', 'Please log in with your username and password.');
    }
});

/**
 * Called by the client immediately after signInWithEmailAndPassword succeeds.
 * Checks the real server-side IP against the banned list and, if banned, disables
 * the Firebase Auth account and revokes all refresh tokens so the session can't persist.
 *
 * Returns: { banned: boolean }
 */
exports.checkIPOnLogin = onCall(callOptions, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in to call this function.');
    }

    const uid = request.auth.uid;
    const forwarded = request.rawRequest.headers['x-forwarded-for'];
    const rawIp = (forwarded ? forwarded.split(',')[0].trim() : request.rawRequest.ip) || '';
    const ip = rawIp.replace(/^::ffff:/, '');

    if (ip) {
        const safeIp = ip.replace(/\./g, '-').replace(/:/g, '_');
        const snap = await admin.database().ref(`banned_ips/${safeIp}`).once('value');
        if (snap.exists()) {
            logger.warn(`Banned IP signed in — disabling account and revoking session: ${ip} (uid: ${uid})`);
            await admin.auth().updateUser(uid, { disabled: true });
            await admin.auth().revokeRefreshTokens(uid);
            await logSecurityAction('ip_ban_login', uid, uid, `Account disabled on login from banned IP: ${ip}`);
            return { banned: true };
        }
        // Keep stored IP current so ban-by-IP lookups stay accurate
        await admin.database().ref(`users_private/${uid}/ipAddress`).set(ip);
    }

    return { banned: false };
});
