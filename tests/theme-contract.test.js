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

    assert.equal(pages.length, 96);
    pages.forEach(function (page) {
        assert.match(read(page), /theme\.js\?v=20/, page + ' must load theme.js?v=20');
    });
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
