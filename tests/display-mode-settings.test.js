const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const settings = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');

test('display mode refreshes the visible custom select when settings load', function () {
    assert.match(settings, /function updateSettingsSelectValue\(selectId, value\)/);
    assert.match(settings, /select\.dispatchEvent\(new Event\('change'\)\)/);
    assert.equal(
        settings.match(/updateSettingsSelectValue\('display-mode-select',/g).length,
        3,
        'local initialization, window load, and cloud sync must all refresh the custom select'
    );
    assert.doesNotMatch(
        settings,
        /getElementById\('display-mode-select'\)\.value\s*=/,
        'display mode must not bypass the visible custom-select refresh'
    );
});
