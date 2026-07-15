"use strict";

var admin = require("firebase-admin");
var fs = require("fs");

var serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || "../service-account.json";
var databaseUrl = "https://rekindle-fork-default-rtdb.europe-west1.firebasedatabase.app/";
var force = process.argv.slice(2).indexOf("--force") !== -1;

if (!fs.existsSync(serviceAccountPath)) {
    console.error("Primary Firebase service account not found at " + serviceAccountPath);
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
    databaseURL: databaseUrl
});

var database = admin.database();

function isBirthday(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function main() {
    var profilesSnapshot = await database.ref("users_public").once("value");
    var profiles = profilesSnapshot.val() || {};
    var profileIds = Object.keys(profiles);
    var birthdayIds = profileIds.filter(function (uid) {
        return isBirthday(profiles[uid] && profiles[uid].birthday);
    });

    console.log("Retired public profiles: " + profileIds.length);
    console.log("Life birthdays available to migrate: " + birthdayIds.length);
    if (!force) {
        console.log("Dry run only. Add --force to migrate birthdays and remove users_public/user_cards.");
        return;
    }

    var migrated = 0;
    for (var index = 0; index < birthdayIds.length; index += 1) {
        var uid = birthdayIds[index];
        var birthdayRef = database.ref("users_private/" + uid + "/life/birthday");
        var existing = await birthdayRef.once("value");
        if (!existing.exists()) {
            await birthdayRef.set(profiles[uid].birthday);
            migrated += 1;
        }
    }

    await database.ref("users_public").remove();
    await database.ref("user_cards").remove();
    console.log("Migrated birthdays: " + migrated);
    console.log("Retired public profile and avatar-card trees removed.");
}

main().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
