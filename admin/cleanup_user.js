const admin = require('firebase-admin');
const fs = require('fs');

const SERVICE_ACCOUNT_PATH = '../service-account.json';
const DATABASE_URL = 'https://rekindle-fork-default-rtdb.europe-west1.firebasedatabase.app/';
const args = process.argv.slice(2);

if (!args[0]) {
    console.error('Usage: node cleanup_user.js <username_or_uid> [--force]');
    process.exit(1);
}
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('Primary Firebase service account not found at ' + SERVICE_ACCOUNT_PATH);
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
    databaseURL: DATABASE_URL
});

const target = args[0];
const force = args.indexOf('--force') !== -1;
const firestore = admin.firestore();
const rtdb = admin.database();

async function resolveUser() {
    try {
        return await admin.auth().getUser(target);
    } catch (error) {
        if (error.code !== 'auth/user-not-found' && error.code !== 'auth/invalid-uid') throw error;
    }
    const email = target.indexOf('@') === -1 ? target + '@rekindle.ink' : target;
    return admin.auth().getUserByEmail(email);
}

async function deleteFirestoreUser(uid) {
    const ref = firestore.collection('users').doc(uid);
    if (typeof firestore.recursiveDelete === 'function') {
        await firestore.recursiveDelete(ref);
    } else {
        await ref.delete();
    }
}

async function main() {
    const user = await resolveUser();
    console.log('Resolved ' + (user.email || user.uid) + ' (' + user.uid + ')');
    console.log('Primary data: users_private/' + user.uid + ' and users/' + user.uid);
    if (!force) {
        console.log('Dry run only. Add --force to delete primary application data.');
        return;
    }
    await rtdb.ref('users_private/' + user.uid).remove();
    await deleteFirestoreUser(user.uid);
    console.log('Primary application data deleted. Firebase Auth account was preserved.');
}

main().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
