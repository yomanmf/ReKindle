const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('every application page loads the current shared theme script', function () {
    var pages = fs.readdirSync(root).filter(function (name) {
        return name.endsWith('.html');
    });
    var releaseManifest = read('yandex/FRONTEND-RELEASE-MANIFEST.txt').split(/\r?\n/);

    pages.forEach(function (page) {
        assert.match(read(page), /theme\.js\?v=24/, page + ' must load theme.js?v=24');
        assert.ok(releaseManifest.includes(page), page + ' must ship in the dark-theme release');
    });
});

test('production HTTP visits upgrade before origin-scoped state is read', function () {
    var theme = read('theme.js');
    var redirect = theme.indexOf("window.location.protocol === 'http:'");

    assert.ok(redirect > -1);
    assert.match(theme, /window\.location\.hostname === 'rekindle\.website\.yandexcloud\.net'/);
    assert.match(theme, /window\.location\.replace\('https:\/\/rekindle\.website\.yandexcloud\.net'/);
    assert.ok(redirect < theme.indexOf('localStorage.getItem'));
});

test('dark, automatic, and legacy system modes remain supported without exposing system in Settings', function () {
    var theme = read('theme.js');
    var settings = read('settings.html');
    var modernHome = read('index.html');
    var classicHome = read('index_old.html');

    assert.match(theme, /localStorage\.getItem\(THEME_KEY\) \|\| 'light'/);
    assert.match(theme, /mode === 'dark'/);
    assert.match(theme, /mode === 'auto'/);
    assert.match(theme, /mode === 'system'/);
    assert.match(theme, /prefers-color-scheme: dark/);
    assert.match(theme, /systemThemeQuery\.addListener/);
    assert.match(theme, /getItem\('rekindle_timezone_offset'\)/);
    assert.match(settings, /updateSettingsSelectValue\('theme-select', theme\)/);
    assert.match(settings, /updateSettingsSelectValue\('theme-select', syncedTheme\)/);
    assert.doesNotMatch(settings, /option value="system"/);
    assert.doesNotMatch(settings, /theme-select[^>]+disabled/);
    assert.doesNotMatch(settings, /Dark mode is temporarily disabled/);
    assert.match(settings, /var syncedTheme = data\.themeMode/);
    assert.match(modernHome, /var syncedTheme = data\.themeMode/);
    assert.match(classicHome, /var syncedTheme = data\.themeMode/);
});

test('dark theme preserves raster, canvas, and embedded content colors', function () {
    var theme = read('theme.js');

    assert.match(theme, /:root\[data-theme="dark"\]/);
    assert.match(theme, /img, \\n/);
    assert.match(theme, /canvas,\\n/);
    assert.match(theme, /iframe,\\n/);
    assert.match(theme, /filter: invert\(1\) hue-rotate\(180deg\)/);
});

test('double tapping the bottom-left corner toggles the effective theme', function () {
    var theme = read('theme.js');

    assert.match(theme, /document\.addEventListener\('click'/);
    assert.match(theme, /event\.clientX > 64/);
    assert.match(theme, /window\.innerHeight - 64/);
    assert.match(theme, /now - cornerTapAt <= 600/);
    assert.match(theme, /hasAttribute\('data-theme'\) \? 'light' : 'dark'/);
    assert.match(theme, /saveThemePreference/);
});

test('gesture and Settings save the same local and cloud theme preference', function () {
    var theme = read('theme.js');
    var settings = read('settings.html');
    var modernHome = read('index.html');
    var classicHome = read('index_old.html');

    assert.match(theme, /localStorage\.setItem\(THEME_KEY, mode\)/);
    assert.match(theme, /localStorage\.setItem\(THEME_PENDING_SYNC_KEY, mode\)/);
    assert.match(theme, /set\(\{ themeMode: mode \}, \{ merge: true \}\)/);
    assert.match(theme, /settingsLastUpdated: firebase\.firestore\.FieldValue\.serverTimestamp\(\)/);
    assert.match(theme, /window\.addEventListener\('load', syncPendingTheme\)/);
    assert.match(settings, /window\.rekindleSaveThemePreference\(val\)/);
    assert.match(settings, /data\.themeMode && !localStorage\.getItem\('rekindle_theme_pending_sync'\)/);
    assert.match(modernHome, /data\.themeMode && !localStorage\.getItem\('rekindle_theme_pending_sync'\)/);
    assert.match(classicHome, /data\.themeMode && !localStorage\.getItem\('rekindle_theme_pending_sync'\)/);
});
