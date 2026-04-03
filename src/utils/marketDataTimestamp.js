const DEFAULT_MAX_FUTURE_SEC = 10 * 60;
const DEFAULT_MIN_OFFSET_SEC = 60 * 60;
const DEFAULT_ROUNDING_SEC = 15 * 60;

const normalizePositiveInteger = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

export const parseEpochSeconds = (value) => {
    if (value === undefined || value === null || value === '') return null;

    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 10_000_000_000
            ? Math.floor(numeric / 1000)
            : Math.floor(numeric);
    }

    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return Math.floor(parsed / 1000);
        }
    }

    return null;
};

export const detectFutureClockOffsetSeconds = (value, options = {}) => {
    const epochSec = parseEpochSeconds(value);
    if (!Number.isFinite(epochSec)) return 0;

    const referenceSec = parseEpochSeconds(options.referenceSec ?? Date.now());
    if (!Number.isFinite(referenceSec)) return 0;

    const maxFutureSec = normalizePositiveInteger(options.maxFutureSec, DEFAULT_MAX_FUTURE_SEC);
    const minOffsetSec = normalizePositiveInteger(options.minOffsetSec, DEFAULT_MIN_OFFSET_SEC);
    const roundingSec = normalizePositiveInteger(options.roundingSec, DEFAULT_ROUNDING_SEC);

    const skewSec = epochSec - referenceSec;
    if (skewSec <= maxFutureSec) return 0;

    let offsetSec = Math.round(skewSec / roundingSec) * roundingSec;
    if (!Number.isFinite(offsetSec) || offsetSec < minOffsetSec) {
        return 0;
    }

    const correctedFutureSec = epochSec - offsetSec - referenceSec;
    if (correctedFutureSec > maxFutureSec) {
        const ceiledOffsetSec = Math.ceil(skewSec / roundingSec) * roundingSec;
        if (Number.isFinite(ceiledOffsetSec) && ceiledOffsetSec >= minOffsetSec) {
            offsetSec = ceiledOffsetSec;
        }
    }

    return offsetSec > 0 ? offsetSec : 0;
};

export const normalizeFutureShiftedEpochSeconds = (value, options = {}) => {
    const epochSec = parseEpochSeconds(value);
    if (!Number.isFinite(epochSec)) return null;

    const explicitOffsetSec = Number(options.offsetSec);
    const offsetSec = Number.isFinite(explicitOffsetSec) && explicitOffsetSec > 0
        ? Math.floor(explicitOffsetSec)
        : detectFutureClockOffsetSeconds(epochSec, options);

    return offsetSec > 0 ? epochSec - offsetSec : epochSec;
};
