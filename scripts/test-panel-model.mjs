import test from 'node:test';
import assert from 'node:assert/strict';
import {presentation, barScales} from '../integrations/gnome/voco-panel@voco.local/model.js';
const state = {version: 1, token: '1:1', status: 'idle', canStop: true, canOpen: true, level: 0.8};
test('idle cannot accidentally offer Stop or a live meter', () => {
    const p = presentation(state);
    assert.equal(p.canStop, false);
    assert.equal(p.level, 0);
    assert.equal(p.label, '');
});
test('active states block opening settings and processing blocks Stop', () => {
    for (const status of ['starting', 'recording', 'processing']) {
        const p = presentation({...state, status});
        assert.equal(p.canOpen, false);
        assert.equal(p.canStop, status !== 'processing');
    }
});
test('meter is finite and bounded even for malformed inputs', () => {
    for (const [level, expected] of [[Infinity, 0], [NaN, 0], [-1, 0], [4, 1], [0.3, 0.3]]) {
        const p = presentation({...state, status: 'recording', level});
        assert.equal(p.level, expected);
        assert.ok(barScales(p.level).every(value => value >= 0.15 && value <= 1));
    }
});
test('unknown protocol fails closed and recovery remains visible', () => {
    assert.throws(() => presentation({...state, version: 2}));
    assert.throws(() => presentation({...state, status: 'unknown'}));
    assert.equal(presentation({...state, status: 'recovery'}).label, 'Review');
});
