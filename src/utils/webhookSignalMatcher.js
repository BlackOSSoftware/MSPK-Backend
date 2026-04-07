import { parseSignalTimestamp } from './signalTimestamp.js';
import { buildTimeframeAliases, normalizeSignalTimeframe } from './timeframe.js';

export const getWebhookSignalStartTimeMs = (signal) => {
  const rawValue = signal?.signalTime || signal?.createdAt || signal?.updatedAt;
  if (!rawValue) return Number.NEGATIVE_INFINITY;

  const parsed = parseSignalTimestamp(rawValue) || new Date(rawValue);
  const timestamp = parsed instanceof Date ? parsed.getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

export const resolveExitedSignalType = (tradeType) => {
  const normalized = String(tradeType || '').trim().toUpperCase();
  if (!normalized) return null;

  const isExitEvent = normalized.includes('EXIT') || normalized.includes('CLOSE');
  if (!isExitEvent) return null;
  if (normalized.includes('BUY')) return 'BUY';
  if (normalized.includes('SELL')) return 'SELL';
  return null;
};

const dedupeSignals = (signals = []) => {
  const uniqueSignals = new Map();
  signals.forEach((candidate) => {
    if (!candidate?._id) return;
    uniqueSignals.set(String(candidate._id), candidate);
  });
  return Array.from(uniqueSignals.values());
};

const sortCandidates = (signals = []) =>
  [...signals].sort((left, right) => {
    const leftStartedAt = getWebhookSignalStartTimeMs(left);
    const rightStartedAt = getWebhookSignalStartTimeMs(right);

    if (leftStartedAt !== rightStartedAt) {
      return rightStartedAt - leftStartedAt;
    }

    const leftUpdated = new Date(left?.updatedAt || left?.createdAt || 0).getTime();
    const rightUpdated = new Date(right?.updatedAt || right?.createdAt || 0).getTime();
    return rightUpdated - leftUpdated;
  });

export const selectWebhookSignalCandidate = ({
  signals = [],
  eventTime = null,
  timeframe = null,
  expectedType = null,
} = {}) => {
  const parsedEventTime = parseSignalTimestamp(eventTime) || null;
  const normalizedExpectedType = String(expectedType || '').trim().toUpperCase();
  const timeframeAliases = new Set(buildTimeframeAliases(timeframe));
  const timeframeProvided = timeframeAliases.size > 0;

  let candidates = sortCandidates(dedupeSignals(signals));
  if (candidates.length === 0) {
    return { signal: null, ambiguous: false };
  }

  if (normalizedExpectedType) {
    candidates = candidates.filter(
      (candidate) => String(candidate?.type || '').trim().toUpperCase() === normalizedExpectedType
    );
    if (candidates.length === 0) {
      return { signal: null, ambiguous: false };
    }
  }

  if (timeframeProvided) {
    candidates = candidates.filter((candidate) => {
      const candidateTimeframe =
        normalizeSignalTimeframe(candidate?.timeframe) || String(candidate?.timeframe || '').trim();
      return timeframeAliases.has(candidateTimeframe);
    });
    if (candidates.length === 0) {
      return { signal: null, ambiguous: false };
    }
  }

  if (parsedEventTime instanceof Date && !Number.isNaN(parsedEventTime.getTime())) {
    const eventTimeMs = parsedEventTime.getTime();
    const eligibleCandidates = candidates.filter((candidate) => {
      const startedAt = getWebhookSignalStartTimeMs(candidate);
      return Number.isFinite(startedAt) && startedAt <= eventTimeMs;
    });

    if (eligibleCandidates.length === 1) {
      return { signal: eligibleCandidates[0], ambiguous: false };
    }

    if (eligibleCandidates.length > 1) {
      if (!timeframeProvided) {
        const distinctEligibleTimeframes = new Set(
          eligibleCandidates
            .map(
              (candidate) =>
                normalizeSignalTimeframe(candidate?.timeframe) || String(candidate?.timeframe || '').trim()
            )
            .filter(Boolean)
        );
        if (distinctEligibleTimeframes.size > 1) {
          return { signal: null, ambiguous: true };
        }
      }

      // During reversal bars, EXIT and new ENTRY can share the same timestamp.
      // Prefer signals that existed strictly before the event timestamp so EXIT
      // settles the prior leg instead of the freshly opened leg.
      const strictlyEarlierCandidates = eligibleCandidates.filter(
        (candidate) => getWebhookSignalStartTimeMs(candidate) < eventTimeMs
      );
      const candidatePool =
        strictlyEarlierCandidates.length > 0 ? strictlyEarlierCandidates : eligibleCandidates;
      const latestStartedAt = Math.max(
        ...candidatePool.map((candidate) => getWebhookSignalStartTimeMs(candidate))
      );
      const closestCandidates = candidatePool.filter(
        (candidate) => getWebhookSignalStartTimeMs(candidate) === latestStartedAt
      );

      if (closestCandidates.length === 1) {
        return { signal: closestCandidates[0], ambiguous: false };
      }

      return { signal: null, ambiguous: true };
    }
  }

  const distinctTimeframes = new Set(
    candidates
      .map((candidate) => normalizeSignalTimeframe(candidate?.timeframe) || String(candidate?.timeframe || '').trim())
      .filter(Boolean)
  );

  if (distinctTimeframes.size > 1) {
    return { signal: null, ambiguous: true };
  }

  return { signal: candidates[0], ambiguous: false };
};
