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
        assert.match(read(page), /theme\.js\?v=22/, page + ' must load theme.js?v=22');
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

test('dark and automatic modes remain enabled across local and cloud settings', function () {
    var theme = read('theme.js');
    var settings = read('settings.html');
    var modernHome = read('index.html');
    var classicHome = read('index_old.html');

    assert.match(theme, /localStorage\.getItem\(THEME_KEY\) \|\| 'light'/);
    assert.match(theme, /mode === 'dark'/);
    assert.match(theme, /mode === 'auto'/);
    assert.match(theme, /getItem\('rekindle_timezone_offset'\)/);
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
