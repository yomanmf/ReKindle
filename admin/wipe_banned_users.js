const admin = require('firebase-admin');
const fs = require('fs');

const SERVICE_ACCOUNT_PATH = '../service-account.json';
const DATABASE_URL = 'https://rekindle-fork-default-rtdb.europe-west1.firebasedatabase.app/';
const force = process.argv.slice(2).indexOf('--force') !== -1;

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('Primary Firebase service account not found at ' + SERVICE_ACCOUNT_PATH);
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
    databaseURL: DATABASE_URL
});

const firestore = admin.firestore();
const rtdb = admin.database();

async function disabledUsers() {
    const users = [];
    let pageToken;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        page.users.forEach(function (user) {
            if (user.disabled) users.push(user);
        });
        pageToken = page.pageToken;
    } while (pageToken);
    return users;
}

async function deleteFirestoreUser(uid) {
    const ref = firestore.collection('users').doc(uid);
    if (typeof firestore.recursiveDelete === 'function') await firestore.recursiveDelete(ref);
    else await ref.delete();
}

async function main() {
    const users = await disabledUsers();
    console.log('Disabled primary accounts: ' + users.length);
    users.forEach(function (user) {
        console.log('- ' + (user.email || user.uid) + ' (' + user.uid + ')');
    });
    if (!force) {
        console.log('Dry run only. Add --force to delete their primary application data.');
        return;
    }
    for (const user of users) {
        await rtdb.ref('users_private/' + user.uid).remove();
        await deleteFirestoreUser(user.uid);
    }
    console.log('Primary application data removed for disabled accounts. Auth records were preserved.');
}

main().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
