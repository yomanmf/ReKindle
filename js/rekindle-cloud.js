(function () {
    "use strict";

    var API_BASE = "https://d5dmoqrf9kg552lo4g69.tmjd4m4j.apigw.yandexcloud.net/api/rekindle";
    var GATEWAY_BASE = API_BASE.slice(0, API_BASE.length - "/api/rekindle".length);
    var authReadyPromise = null;
    var authReadyInstance = null;

    function authError(message, code) {
        var error = new Error(message);
        error.code = code;
        return error;
    }

    function waitForFirebaseAuth() {
        if (typeof firebase === "undefined" || !firebase.auth) {
            return Promise.reject(authError("Please sign in first.", "auth/unavailable"));
        }

        var auth;
        try {
            auth = firebase.auth();
        } catch (error) {
            return Promise.reject(authError("Please sign in first.", "auth/unavailable"));
        }

        if (auth.currentUser) return Promise.resolve(auth.currentUser);
        if (authReadyPromise && authReadyInstance === auth) return authReadyPromise;

        authReadyInstance = auth;
        authReadyPromise = new Promise(function (resolve, reject) {
            var settled = false;
            var unsubscribe = null;
            var timer = setTimeout(function () {
                finish(null, authError("Authentication initialization timed out.", "auth/timeout"));
            }, 10000);

            function finish(user, error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (typeof unsubscribe === "function") unsubscribe();
                if (error) {
                    authReadyPromise = null;
                    reject(error);
                    return;
                }
                resolve(user || null);
            }

            try {
                unsubscribe = auth.onAuthStateChanged(function (user) {
                    finish(user, null);
                }, function () {
                    finish(null, authError("Could not restore the Firebase session.", "auth/restore-failed"));
                });
                if (settled && typeof unsubscribe === "function") unsubscribe();
            } catch (error) {
                finish(null, authError("Could not restore the Firebase session.", "auth/restore-failed"));
            }
        });

        return authReadyPromise;
    }

    async function request(path, options) {
        options = options || {};
        var headers = options.headers || {};
        headers.Accept = "application/json";
        if (options.body !== undefined) headers["Content-Type"] = "application/json";

        if (options.auth !== false) {
            var user = await waitForFirebaseAuth();
            if (!user) {
                throw new Error("Please sign in first.");
            }
            headers["X-Firebase-Token"] = await user.getIdToken();
        }

        var response = await fetch(API_BASE + path, {
            method: options.method || "GET",
            headers: headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: options.signal
        });
        var data = {};
        try {
            data = await response.json();
        } catch (e) {
            data = {};
        }
        if (!response.ok) {
            var error = new Error(data.error || "Cloud request failed (" + response.status + ").");
            error.code = data.code || "cloud/error";
            error.status = response.status;
            error.retryAfter = data.retryAfter || 0;
            error.requestId = data.requestId || "";
            error.quota = data.quota || null;
            throw error;
        }
        return data;
    }

    async function upload(path, blob, contentType) {
        var type = contentType || blob.type || "application/octet-stream";
        var signed = await request("/storage/upload-url", {
            method: "POST",
            body: { path: path, size: blob.size, contentType: type }
        });
        var uploadResponse = await fetch(signed.url, {
            method: "PUT",
            headers: { "Content-Type": signed.contentType || type },
            body: blob
        });
        if (!uploadResponse.ok) {
            throw new Error("File upload failed (" + uploadResponse.status + ").");
        }
        return { fullPath: signed.path };
    }

    window.RekindleCloud = {
        apiBase: API_BASE,
        gatewayBase: GATEWAY_BASE,
        request: request,
        register: function (username, password) {
            return request("/auth/register", {
                method: "POST",
                auth: false,
                body: { username: username, password: password }
            });
        },
        checkIp: function () {
            return request("/auth/check-ip", { method: "POST", body: {} });
        },
        storage: {
            list: function (folder) {
                return request("/storage/list?folder=" + encodeURIComponent(folder));
            },
            upload: upload,
            getDownloadUrl: function (path, download) {
                return request("/storage/download-url", {
                    method: "POST",
                    body: { path: path, download: download === true }
                }).then(function (result) { return result.url; });
            },
            delete: function (path) {
                return request("/storage/object", { method: "DELETE", body: { path: path } });
            }
        }
    };
})();
