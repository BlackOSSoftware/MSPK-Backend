import MarketWatchlistTemplate from '../models/MarketWatchlistTemplate.js';
import { DEFAULT_MARKET_WATCHLIST_TEMPLATES } from '../config/defaultMarketWatchlistTemplates.js';
import { getSelectionBucketKey } from '../utils/userSignalSelection.js';

const DEFAULT_TEMPLATE_SYMBOL_LIMIT = 10;
const MAX_TEMPLATE_SYMBOL_LIMIT = 50;

let defaultsEnsuredPromise = null;

const normalizeTokenArray = (values = [], { uppercase = true } = {}) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .map((value) => (uppercase ? value.toUpperCase() : value))
    )
  );

const normalizeTemplateSelector = (selector = {}) => ({
  bucket: String(selector?.bucket || '').trim().toUpperCase(),
  segments: normalizeTokenArray(selector?.segments),
  exchanges: normalizeTokenArray(selector?.exchanges),
  symbolPrefixes: normalizeTokenArray(selector?.symbolPrefixes),
  symbolIncludes: normalizeTokenArray(selector?.symbolIncludes),
  nameIncludes: normalizeTokenArray(selector?.nameIncludes),
});

const normalizeTemplateDoc = (doc = {}) => {
  const key = String(doc?.key || '').trim().toLowerCase();
  const name = String(doc?.name || '').trim();
  if (!key || !name) return null;

  const symbolLimitRaw = Number(doc?.symbolLimit);
  const symbolLimit = Number.isFinite(symbolLimitRaw)
    ? Math.min(Math.max(Math.floor(symbolLimitRaw), 1), MAX_TEMPLATE_SYMBOL_LIMIT)
    : DEFAULT_TEMPLATE_SYMBOL_LIMIT;

  return {
    key,
    name,
    order: Number.isFinite(Number(doc?.order)) ? Number(doc.order) : 100,
    symbolLimit,
    preferredSymbols: normalizeTokenArray(doc?.preferredSymbols),
    selector: normalizeTemplateSelector(doc?.selector || {}),
  };
};

const buildTemplateMatcher = (selector = {}) => {
  const normalizedSelector = normalizeTemplateSelector(selector);
  const {
    bucket,
    segments,
    exchanges,
    symbolPrefixes,
    symbolIncludes,
    nameIncludes,
  } = normalizedSelector;

  return (doc) => {
    const normalizedDoc = {
      ...doc,
      segment: String(doc?.segment || '').trim().toUpperCase(),
      exchange: String(doc?.exchange || '').trim().toUpperCase(),
      symbol: String(doc?.symbol || '').trim().toUpperCase(),
      name: String(doc?.name || '').trim().toUpperCase(),
      subsegment: String(doc?.subsegment || '').trim().toUpperCase(),
    };

    if (bucket && getSelectionBucketKey(normalizedDoc) === bucket) {
      return true;
    }

    if (segments.length > 0 && segments.includes(normalizedDoc.segment)) {
      return true;
    }

    if (exchanges.length > 0 && exchanges.includes(normalizedDoc.exchange)) {
      return true;
    }

    if (
      symbolPrefixes.length > 0 &&
      symbolPrefixes.some((prefix) => normalizedDoc.symbol.startsWith(prefix))
    ) {
      return true;
    }

    if (
      symbolIncludes.length > 0 &&
      symbolIncludes.some((part) => normalizedDoc.symbol.includes(part))
    ) {
      return true;
    }

    if (
      nameIncludes.length > 0 &&
      nameIncludes.some((part) => normalizedDoc.name.includes(part))
    ) {
      return true;
    }

    return false;
  };
};

const ensureDefaultMarketWatchlistTemplates = async () => {
  if (!defaultsEnsuredPromise) {
    defaultsEnsuredPromise = (async () => {
      for (const rawTemplate of DEFAULT_MARKET_WATCHLIST_TEMPLATES) {
        const normalized = normalizeTemplateDoc(rawTemplate);
        if (!normalized) continue;

        await MarketWatchlistTemplate.updateOne(
          { key: normalized.key },
          {
            $setOnInsert: {
              key: normalized.key,
              name: normalized.name,
              order: normalized.order,
              isActive: true,
              symbolLimit: normalized.symbolLimit,
              preferredSymbols: normalized.preferredSymbols,
              selector: normalized.selector,
            },
          },
          { upsert: true }
        );
      }
    })().catch((error) => {
      defaultsEnsuredPromise = null;
      throw error;
    });
  }

  return defaultsEnsuredPromise;
};

const getActiveMarketWatchlistTemplates = async () => {
  await ensureDefaultMarketWatchlistTemplates();

  const docs = await MarketWatchlistTemplate.find({ isActive: true })
    .sort({ order: 1, createdAt: 1, _id: 1 })
    .lean();

  return docs
    .map((doc) => normalizeTemplateDoc(doc))
    .filter(Boolean)
    .map((template) => ({
      ...template,
      matcher: buildTemplateMatcher(template.selector),
    }));
};

export {
  getActiveMarketWatchlistTemplates,
  ensureDefaultMarketWatchlistTemplates,
};
