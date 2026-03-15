const normalizeSignalTimeframe = (value) => {
  if (value === null || value === undefined) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  const normalized = raw.toUpperCase();

  if (normalized === 'S' || normalized === 'SCALP') return 'Scalp';
  if (/^\d+S$/.test(normalized)) return `${Number.parseInt(normalized, 10)}s`;
  if (/^\d+M$/.test(normalized)) return `${Number.parseInt(normalized, 10)}m`;
  if (/^\d+H$/.test(normalized)) return `${Number.parseInt(normalized, 10)}h`;
  if (['D', '1D', 'DAY'].includes(normalized)) return '1D';
  if (['W', '1W', 'WEEK'].includes(normalized)) return '1W';
  if (['M', '1M', 'MO', 'MON', 'MN', 'MONTH', '1MO', '1MON', '1MONTH'].includes(normalized)) {
    return '1M';
  }

  if (/^\d+$/.test(normalized)) {
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0) return raw;
    if (amount < 60) return `${amount}m`;
    if (amount < 1440 && amount % 60 === 0) return `${amount / 60}h`;
    if (amount === 1440) return '1D';
    if (amount === 10080) return '1W';
    if (amount === 43200) return '1M';
    return `${amount}m`;
  }

  return raw;
};

const addAlias = (target, value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return;

  target.add(raw);
  target.add(raw.toLowerCase());
  target.add(raw.toUpperCase());
};

const buildTimeframeAliases = (value) => {
  const raw = String(value ?? '').trim();
  const canonical = normalizeSignalTimeframe(raw);
  const aliases = new Set();

  addAlias(aliases, raw);
  addAlias(aliases, canonical);

  if (!canonical) {
    return Array.from(aliases);
  }

  if (canonical === 'Scalp') {
    addAlias(aliases, 'S');
    addAlias(aliases, 'Scalp');
    return Array.from(aliases);
  }

  const secondsMatch = canonical.match(/^(\d+)s$/i);
  if (secondsMatch) {
    const seconds = Number(secondsMatch[1]);
    addAlias(aliases, `${seconds}S`);
    addAlias(aliases, `${seconds}s`);
    return Array.from(aliases);
  }

  const minutesMatch = canonical.match(/^(\d+)m$/i);
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1]);
    addAlias(aliases, String(minutes));
    addAlias(aliases, `${minutes}M`);
    addAlias(aliases, `${minutes}m`);

    if (minutes < 10) {
      const padded = String(minutes).padStart(2, '0');
      addAlias(aliases, padded);
      addAlias(aliases, `${padded}M`);
      addAlias(aliases, `${padded}m`);
    }

    return Array.from(aliases);
  }

  const hoursMatch = canonical.match(/^(\d+)h$/i);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    const minutes = hours * 60;
    addAlias(aliases, `${hours}H`);
    addAlias(aliases, `${hours}h`);
    addAlias(aliases, `${hours}HR`);
    addAlias(aliases, `${hours}hr`);
    addAlias(aliases, `${hours}HOUR`);
    addAlias(aliases, `${hours}hour`);
    addAlias(aliases, String(minutes));
    addAlias(aliases, `${minutes}M`);
    addAlias(aliases, `${minutes}m`);
    return Array.from(aliases);
  }

  if (canonical === '1D') {
    addAlias(aliases, 'D');
    addAlias(aliases, 'DAY');
    addAlias(aliases, '1440');
    addAlias(aliases, '1440M');
    return Array.from(aliases);
  }

  if (canonical === '1W') {
    addAlias(aliases, 'W');
    addAlias(aliases, 'WEEK');
    addAlias(aliases, '10080');
    addAlias(aliases, '10080M');
    return Array.from(aliases);
  }

  if (canonical === '1M') {
    ['M', 'MO', 'MON', 'MN', 'MONTH', '1M', '1MO', '1MON', '1MONTH', '43200', '43200M'].forEach(
      (alias) => addAlias(aliases, alias)
    );
  }

  return Array.from(aliases);
};

const buildTimeframeQuery = (fieldName, value) => {
  const aliases = buildTimeframeAliases(value);
  if (aliases.length === 0) return null;

  return {
    [fieldName]: { $in: aliases },
  };
};

export {
  buildTimeframeAliases,
  buildTimeframeQuery,
  normalizeSignalTimeframe,
};
