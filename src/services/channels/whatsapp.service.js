import axios from 'axios';
import config from '../../config/config.js';
import logger from '../../config/log.js';
import msg91Service from '../msg91.service.js';

const DEFAULT_ULTRAMSG_BASE_URL = 'https://api.ultramsg.com';
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

const normalizeProvider = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();

  if (['ultramsg', 'ultra', 'ultra_msg'].includes(normalized)) return 'ultramsg';
  if (['meta', 'cloud', 'whatsapp-cloud'].includes(normalized)) return 'meta';
  if (normalized === 'msg91') return 'msg91';

  return '';
};

const trimTrailingSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const toPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed);
  }
  return fallback;
};

const getRequestTimeoutMs = () =>
  toPositiveInteger(process.env.WHATSAPP_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);

const isPlaceholderValue = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes('your_') ||
    normalized.includes('example') ||
    normalized === 'null' ||
    normalized === 'undefined'
  );
};

const isChatId = (value = '') => /@(?:c|g)\.us$/i.test(String(value || '').trim());

const normalizeRecipient = (value, provider, defaultCountryCode = '91') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isChatId(raw)) return raw;

  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 10 && defaultCountryCode) {
    digits = `${defaultCountryCode}${digits}`;
  }

  return provider === 'ultramsg' ? `+${digits}` : digits;
};

const resolveWhatsAppConfig = (rawConfig = null) => {
  const source =
    rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};

  const envProvider = normalizeProvider(config.whatsapp?.provider || process.env.WHATSAPP_PROVIDER);
  const provider =
    normalizeProvider(source.provider) ||
    envProvider ||
    (config.whatsapp?.ultramsg?.instanceId && config.whatsapp?.ultramsg?.token ? 'ultramsg' : '') ||
    (config.whatsapp?.meta?.accessToken && config.whatsapp?.meta?.phoneNumberId ? 'meta' : '') ||
    (process.env.MSG91_AUTH_KEY && process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER ? 'msg91' : '');

  const defaultCountryCode =
    String(
      source.defaultCountryCode ||
        config.whatsapp?.defaultCountryCode ||
        process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ||
        '91'
    ).trim() || '91';

  const ultramsgConfig = source.ultramsg && typeof source.ultramsg === 'object' ? source.ultramsg : {};
  const metaConfig = source.meta && typeof source.meta === 'object' ? source.meta : {};

  return {
    enabled: source.enabled !== false && Boolean(provider),
    provider,
    defaultCountryCode,
    ultramsg: {
      baseUrl: trimTrailingSlash(
        ultramsgConfig.baseUrl ||
          source.baseUrl ||
          source.apiUrl ||
          config.whatsapp?.ultramsg?.baseUrl ||
          DEFAULT_ULTRAMSG_BASE_URL
      ),
      instanceId: String(
        ultramsgConfig.instanceId ||
          source.instanceId ||
          source.instance ||
          config.whatsapp?.ultramsg?.instanceId ||
          ''
      ).trim(),
      token: String(
        ultramsgConfig.token || source.token || source.apiToken || config.whatsapp?.ultramsg?.token || ''
      ).trim(),
      priority: toPositiveInteger(
        ultramsgConfig.priority ??
          source.priority ??
          config.whatsapp?.ultramsg?.priority ??
          process.env.ULTRAMSG_PRIORITY,
        10
      ),
    },
    meta: {
      accessToken: String(
        metaConfig.accessToken ||
          source.accessToken ||
          source.apiKey ||
          config.whatsapp?.meta?.accessToken ||
          ''
      ).trim(),
      phoneNumberId: String(
        metaConfig.phoneNumberId ||
          source.phoneNumberId ||
          source.phoneId ||
          config.whatsapp?.meta?.phoneNumberId ||
          ''
      ).trim(),
    },
  };
};

const isConfigured = (rawConfig = null) => {
  const resolved = resolveWhatsAppConfig(rawConfig);
  if (!resolved.enabled || !resolved.provider) return false;

  if (resolved.provider === 'ultramsg') {
    return Boolean(
      resolved.ultramsg.baseUrl && resolved.ultramsg.instanceId && resolved.ultramsg.token
    );
  }

  if (resolved.provider === 'meta') {
    return Boolean(resolved.meta.accessToken && resolved.meta.phoneNumberId);
  }

  if (resolved.provider === 'msg91') {
    return Boolean(
      process.env.MSG91_AUTH_KEY &&
        process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER &&
        !isPlaceholderValue(process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER)
    );
  }

  return false;
};

const getProviderName = (rawConfig = null) => resolveWhatsAppConfig(rawConfig).provider || 'disabled';

const buildWhatsAppText = ({ text, title, message }) => {
  const explicitText = String(text || '').trim();
  if (explicitText) return explicitText;

  const parts = [String(title || '').trim(), String(message || '').trim()].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : 'MSPK Trade Solutions notification';
};

const extractMessageId = (payload) =>
  payload?.id ||
  payload?.messageId ||
  payload?.message_id ||
  payload?.data?.id ||
  payload?.messages?.[0]?.id ||
  null;

const sendUltraMsgText = async (resolvedConfig, { to, text, priority }) => {
  const recipient = normalizeRecipient(
    to,
    'ultramsg',
    resolvedConfig.defaultCountryCode
  );

  if (!recipient) {
    throw new Error('Valid WhatsApp recipient is required');
  }

  const url = `${resolvedConfig.ultramsg.baseUrl}/${resolvedConfig.ultramsg.instanceId}/messages/chat`;
  const payload = new URLSearchParams({
    token: resolvedConfig.ultramsg.token,
    to: recipient,
    body: text,
    priority: String(
      toPositiveInteger(priority, resolvedConfig.ultramsg.priority) || resolvedConfig.ultramsg.priority
    ),
  });

  const response = await axios.post(url, payload.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: getRequestTimeoutMs(),
  });

  logger.info(`WhatsApp UltraMsg send accepted for ${recipient}`);

  return {
    provider: 'ultramsg',
    to: recipient,
    raw: response.data,
    queued: Boolean(response.data?.queue || response.data?.queued),
    messageId: extractMessageId(response.data),
  };
};

const sendMetaText = async (resolvedConfig, { to, text }) => {
  const recipient = normalizeRecipient(to, 'meta', resolvedConfig.defaultCountryCode);

  if (!recipient || isChatId(recipient)) {
    throw new Error('Meta WhatsApp provider requires a valid phone number');
  }

  const url = `https://graph.facebook.com/v17.0/${resolvedConfig.meta.phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'text',
    text: {
      preview_url: false,
      body: text,
    },
  };

  let response;
  try {
    response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${resolvedConfig.meta.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: getRequestTimeoutMs(),
    });
  } catch (error) {
    const providerError = error?.response?.data?.error;
    if (providerError?.code === 190) {
      throw new Error('WhatsApp Meta access token has expired or is invalid. Update WHATSAPP_ACCESS_TOKEN.');
    }
    throw error;
  }

  logger.info(`WhatsApp Meta send accepted for ${recipient}`);

  return {
    provider: 'meta',
    to: recipient,
    raw: response.data,
    queued: false,
    messageId: extractMessageId(response.data),
  };
};

const validateChannel = async (rawConfig = null) => {
  const resolvedConfig = resolveWhatsAppConfig(rawConfig);
  if (!isConfigured(resolvedConfig)) {
    throw new Error('WhatsApp channel is not configured');
  }

  if (resolvedConfig.provider === 'meta') {
    const url = `https://graph.facebook.com/v17.0/${resolvedConfig.meta.phoneNumberId}`;

    try {
      await axios.get(url, {
        headers: {
          Authorization: `Bearer ${resolvedConfig.meta.accessToken}`,
        },
        params: {
          fields: 'id',
        },
        timeout: Math.min(getRequestTimeoutMs(), 8000),
      });
    } catch (error) {
      const providerError = error?.response?.data?.error;
      if (providerError?.code === 190) {
        throw new Error('WhatsApp Meta access token has expired or is invalid. Update WHATSAPP_ACCESS_TOKEN.');
      }
      throw new Error(providerError?.message || error?.message || 'WhatsApp provider validation failed');
    }
  }

  return {
    provider: resolvedConfig.provider,
  };
};

const buildMsg91Payload = ({ signal, announcement, title, message }) => {
  if (signal) {
    return {
      templateName: 'signal_alert',
      components: {
        '1': String(signal.symbol || '-'),
        '2': String(signal.type || '-'),
        '3': String(signal.entryPrice ?? '-'),
        '4': String(signal.stopLoss ?? '-'),
        '5': String(signal.targets?.target1 ?? '-'),
      },
    };
  }

  return {
    templateName: 'announcement_alert',
    components: {
      '1': String(announcement?.title || title || 'MSPK Alert'),
      '2': String(announcement?.message || message || ''),
    },
  };
};

const sendMsg91Notification = async (resolvedConfig, { to, signal, announcement, title, message }) => {
  const recipient = normalizeRecipient(to, 'msg91', resolvedConfig.defaultCountryCode);
  if (!recipient || isChatId(recipient)) {
    throw new Error('MSG91 provider requires a valid phone number');
  }

  const payload = buildMsg91Payload({ signal, announcement, title, message });
  await msg91Service.sendWhatsapp(recipient, payload.templateName, payload.components);

  return {
    provider: 'msg91',
    to: recipient,
    raw: null,
    queued: false,
    messageId: null,
  };
};

const sendText = async (rawConfig = null, { to, text, title, message, priority } = {}) => {
  const resolvedConfig = resolveWhatsAppConfig(rawConfig);
  if (!isConfigured(resolvedConfig)) {
    throw new Error('WhatsApp channel is not configured');
  }

  const body = buildWhatsAppText({ text, title, message });

  if (resolvedConfig.provider === 'ultramsg') {
    return sendUltraMsgText(resolvedConfig, { to, text: body, priority });
  }

  if (resolvedConfig.provider === 'meta') {
    return sendMetaText(resolvedConfig, { to, text: body });
  }

  throw new Error('Plain text WhatsApp send is not supported for the configured provider');
};

const sendNotification = async (
  rawConfig = null,
  { to, text, title, message, signal = null, announcement = null, priority } = {}
) => {
  const resolvedConfig = resolveWhatsAppConfig(rawConfig);
  if (!isConfigured(resolvedConfig)) {
    throw new Error('WhatsApp channel is not configured');
  }

  if (resolvedConfig.provider === 'msg91') {
    return sendMsg91Notification(resolvedConfig, { to, signal, announcement, title, message });
  }

  return sendText(resolvedConfig, {
    to,
    text,
    title,
    message,
    priority,
  });
};

export default {
  getProviderName,
  isConfigured,
  normalizeRecipient,
  resolveWhatsAppConfig,
  validateChannel,
  sendNotification,
  sendText,
};
