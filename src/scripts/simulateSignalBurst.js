import axios from 'axios';

const parseNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getArg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
};

const count = parseNumber(
  getArg('count', process.env.SIGNAL_COUNT),
  100
);
const concurrency = parseNumber(
  getArg('concurrency', process.env.SIGNAL_CONCURRENCY),
  50
);
const duplicates = parseNumber(
  getArg('duplicates', process.env.SIGNAL_DUPLICATES),
  0
);
const webhookUrl =
  getArg('url', process.env.SIGNAL_WEBHOOK_URL) ||
  'http://localhost:5000/v1/webhooks/signals';

const now = new Date();

const buildPayload = (index, duplicateOf = null) => {
  const uniqId = duplicateOf ?? `BURST-${now.getTime()}-${index}`;
  const symbol = `NSE:TEST${index}-EQ`;

  return {
    event: 'ENTRY',
    uniq_id: uniqId,
    symbol,
    segment: 'NSE',
    trade_type: index % 2 === 0 ? 'BUY' : 'SELL',
    timeframe: '5m',
    entry_price: 100 + index,
    stop_loss: 95 + index,
    targets: { t1: 110 + index, t2: 120 + index, t3: 130 + index },
    signal_time: new Date(now.getTime() + index * 1000).toISOString(),
    is_free: true,
  };
};

const payloads = [];
for (let i = 0; i < count; i += 1) {
  const duplicateKey = duplicates > 0 && i < duplicates ? `DUPLICATE-${now.getTime()}` : null;
  payloads.push(buildPayload(i + 1, duplicateKey));
}

const results = {
  ok: 0,
  duplicate_blocked: 0,
  not_found: 0,
  error: 0,
};

const queue = [...payloads];
const workers = Array.from({ length: Math.max(concurrency, 1) }).map(async () => {
  while (queue.length > 0) {
    const payload = queue.shift();
    if (!payload) return;
    try {
      const response = await axios.post(webhookUrl, payload, { timeout: 15000 });
      const status = response?.data?.status || 'ok';
      if (status === 'duplicate_blocked') results.duplicate_blocked += 1;
      else if (status === 'not_found') results.not_found += 1;
      else results.ok += 1;
    } catch (error) {
      results.error += 1;
      const message = error?.response?.data?.message || error?.message || 'Unknown error';
      console.error('[BurstTest] Request failed:', message);
    }
  }
});

Promise.all(workers).then(() => {
  console.log('[BurstTest] Completed');
  console.log(JSON.stringify({ count, concurrency, duplicates, results }, null, 2));
  process.exit(0);
});
