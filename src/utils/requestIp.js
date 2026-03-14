const LOOPBACK_VALUES = new Set([
  '::1',
  '127.0.0.1',
  '0:0:0:0:0:0:0:1',
  'localhost',
]);

const UNKNOWN_VALUES = new Set(['', 'unknown', 'null', 'undefined']);

const normalizeIp = (value) => {
  if (typeof value !== 'string') return null;

  let ip = value.trim().replace(/^for=/i, '');
  ip = ip.replace(/^"|"$/g, '');

  if (!ip || UNKNOWN_VALUES.has(ip.toLowerCase())) return null;

  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  const ipv4PortMatch = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4PortMatch) {
    ip = ipv4PortMatch[1];
  }

  return ip;
};

const isLoopbackIp = (value) => {
  const normalized = normalizeIp(value);
  if (!normalized) return false;
  return LOOPBACK_VALUES.has(normalized.toLowerCase());
};

const extractForwardedIps = (forwardedHeader) => {
  if (typeof forwardedHeader !== 'string' || !forwardedHeader.trim()) return [];

  return forwardedHeader
    .split(',')
    .map((entry) => entry.trim())
    .flatMap((entry) =>
      entry
        .split(';')
        .map((part) => part.trim())
        .filter((part) => /^for=/i.test(part))
        .map((part) => normalizeIp(part))
    )
    .filter(Boolean);
};

export const resolveClientIp = (req) => {
  const candidates = [
    ...(typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',').map((item) => normalizeIp(item))
      : []),
    normalizeIp(req.headers['x-real-ip']),
    normalizeIp(req.headers['cf-connecting-ip']),
    normalizeIp(req.headers['true-client-ip']),
    normalizeIp(req.headers['x-client-ip']),
    normalizeIp(req.headers['x-cluster-client-ip']),
    ...extractForwardedIps(req.headers.forwarded),
    normalizeIp(req.ip),
    normalizeIp(req.socket?.remoteAddress),
    normalizeIp(req.connection?.remoteAddress),
  ].filter(Boolean);

  const preferred = candidates.find((ip) => !isLoopbackIp(ip));
  if (preferred) return preferred;

  return candidates.find(Boolean) || null;
};

export const formatStoredClientIp = (value) => {
  const normalized = normalizeIp(value);
  return normalized || null;
};

export const isLoopbackClientIp = isLoopbackIp;
