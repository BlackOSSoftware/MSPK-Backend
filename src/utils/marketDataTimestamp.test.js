import test from 'node:test';
import assert from 'node:assert/strict';

import {
    detectFutureClockOffsetSeconds,
    normalizeFutureShiftedEpochSeconds,
    parseEpochSeconds,
} from './marketDataTimestamp.js';

test('parseEpochSeconds accepts seconds, milliseconds, and dates', () => {
    assert.equal(parseEpochSeconds(1775243400), 1775243400);
    assert.equal(parseEpochSeconds(1775243400000), 1775243400);
    assert.equal(parseEpochSeconds(new Date('2026-04-03T19:10:00.000Z')), 1775243400);
});

test('detectFutureClockOffsetSeconds rounds large future skew to a quarter-hour offset', () => {
    const offsetSec = detectFutureClockOffsetSeconds(1775243400, {
        referenceSec: 1775232210,
        maxFutureSec: 10 * 60,
        minOffsetSec: 60 * 60,
        roundingSec: 15 * 60,
    });

    assert.equal(offsetSec, 3 * 60 * 60);
});

test('normalizeFutureShiftedEpochSeconds removes the detected upstream clock offset', () => {
    const normalizedSec = normalizeFutureShiftedEpochSeconds(1775243400, {
        referenceSec: 1775232210,
        maxFutureSec: 10 * 60,
        minOffsetSec: 60 * 60,
        roundingSec: 15 * 60,
    });

    assert.equal(normalizedSec, 1775232600);
});

test('normalizeFutureShiftedEpochSeconds keeps plausible near-real-time values unchanged', () => {
    const normalizedSec = normalizeFutureShiftedEpochSeconds(1775232600, {
        referenceSec: 1775232210,
        maxFutureSec: 10 * 60,
        minOffsetSec: 60 * 60,
        roundingSec: 15 * 60,
    });

    assert.equal(normalizedSec, 1775232600);
});
