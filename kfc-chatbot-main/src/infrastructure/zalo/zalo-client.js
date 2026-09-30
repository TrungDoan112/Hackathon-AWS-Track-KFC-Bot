const DEFAULT_API_BASE_URL = 'https://bot-api.zaloplatforms.com';
const MAX_MESSAGE_LENGTH = 2000;

export class ZaloApiError extends Error {
  constructor(message, { status = 0, code = 'ZALO_API_ERROR', retryable = false } = {}) {
    super(message);
    this.name = 'ZaloApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function splitZaloMessage(text, maxLength = MAX_MESSAGE_LENGTH) {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError('Độ dài tối đa của tin nhắn phải là số nguyên dương.');
  }
  const value = String(text ?? '').trim();
  if (!value) return [];

  const chunks = [];
  let remaining = value;
  while (remaining.length > maxLength) {
    let cutPosition = remaining.lastIndexOf('\n', maxLength);
    if (cutPosition < Math.floor(maxLength / 2)) {
      cutPosition = remaining.lastIndexOf(' ', maxLength);
    }
    if (cutPosition < Math.floor(maxLength / 2)) cutPosition = maxLength;
    const previousCodeUnit = remaining.charCodeAt(cutPosition - 1);
    const nextCodeUnit = remaining.charCodeAt(cutPosition);
    if (
      previousCodeUnit >= 0xD800 && previousCodeUnit <= 0xDBFF
      && nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF
    ) {
      cutPosition -= 1;
    }
    chunks.push(remaining.slice(0, cutPosition).trim());
    remaining = remaining.slice(cutPosition).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateWebhook(webhookUrl, secretToken) {
  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw new ZaloApiError('Webhook URL không hợp lệ.', { code: 'INVALID_WEBHOOK_URL' });
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new ZaloApiError('Webhook URL phải sử dụng HTTPS.', { code: 'INVALID_WEBHOOK_URL' });
  }
  const secret = String(secretToken || '');
  if (secret.length < 8 || secret.length > 256) {
    throw new ZaloApiError('Webhook secret phải dài từ 8 đến 256 ký tự.', {
      code: 'INVALID_WEBHOOK_SECRET',
    });
  }
  return { url: parsedUrl.toString(), secretToken: secret };
}

export function createZaloClient({
  botToken = process.env.ZALO_BOT_TOKEN,
  fetchImpl = globalThis.fetch,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  retryDelayMs = 250,
  requestTimeoutMs = 15000,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ZaloApiError('Môi trường hiện tại không hỗ trợ fetch.', { code: 'FETCH_UNAVAILABLE' });
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new ZaloApiError('Zalo request timeout phải lớn hơn 0.', {
      code: 'INVALID_REQUEST_TIMEOUT',
    });
  }

  function requireToken() {
    if (!botToken) {
      throw new ZaloApiError('ZALO_BOT_TOKEN chưa được cấu hình.', {
        code: 'ZALO_TOKEN_MISSING',
      });
    }
    return botToken;
  }

  async function call(method, body = {}, { retries = 1 } = {}) {
    const token = requireToken();
    const url = `${apiBaseUrl}/bot${token}/${method}`;
    let lastError;

    logger.info?.(`[zalo-client] request ${method}`, {
      apiBaseUrl,
      retries,
      bodyKeys: Object.keys(body),
    });

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        let response;
        try {
          response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        let data;
        try {
          data = await response.json();
        } catch {
          logger.error?.(`[zalo-client] invalid JSON from ${method}`, {
            status: response.status,
          });
          throw new ZaloApiError(`Zalo API ${method} trả về JSON không hợp lệ.`, {
            status: response.status,
            code: 'ZALO_INVALID_RESPONSE',
            retryable: response.status >= 500,
          });
        }

        if (!response.ok || data.ok !== true) {
          const status = response.status;
          logger.error?.(`[zalo-client] API error ${method}`, {
            status,
            description: data.description,
            errorCode: data.error_code,
          });
          throw new ZaloApiError(
            `Zalo API ${method} thất bại: ${data.description || `HTTP ${status}`}`,
            {
              status,
              code: data.error_code ? `ZALO_${data.error_code}` : 'ZALO_API_ERROR',
              retryable: status === 408 || status === 429 || status >= 500,
            },
          );
        }
        logger.info?.(`[zalo-client] response ${method}`, {
          status: response.status,
          ok: true,
        });
        return data.result ?? { ok: true };
      } catch (error) {
        lastError = error instanceof ZaloApiError
          ? error
          : new ZaloApiError(`Không thể kết nối Zalo API ${method}.`, {
              code: 'ZALO_NETWORK_ERROR',
              retryable: true,
            });
        logger.warn?.(`[zalo-client] attempt failed ${method}`, {
          attempt: attempt + 1,
          retries,
          code: lastError.code || lastError.name || 'unknown',
          retryable: Boolean(lastError.retryable),
        });
        if (!lastError.retryable || attempt >= retries) throw lastError;
        await wait(retryDelayMs * (attempt + 1));
      }
    }
    throw lastError;
  }

  return {
    getMe() {
      return call('getMe', {});
    },

    async sendMessage(chatId, text) {
      const chunks = splitZaloMessage(text);
      logger.info?.('[zalo-client] sendMessage split', {
        chatId: String(chatId),
        chunks: chunks.length,
        length: String(text ?? '').length,
      });
      if (chunks.length === 0) {
        throw new ZaloApiError('Không thể gửi tin nhắn Zalo rỗng.', {
          code: 'EMPTY_ZALO_MESSAGE',
        });
      }
      const results = [];
      for (const chunk of chunks) {
        results.push(await call('sendMessage', { chat_id: String(chatId), text: chunk }));
      }
      return results;
    },

    sendTyping(chatId) {
      logger.info?.('[zalo-client] sendChatAction typing', { chatId: String(chatId) });
      return call('sendChatAction', { chat_id: String(chatId), action: 'typing' });
    },

    setWebhook(webhookUrl, secretToken) {
      const validated = validateWebhook(webhookUrl, secretToken);
      logger.info?.('[zalo-client] setWebhook', {
        webhookUrl: validated.url,
      });
      return call('setWebhook', {
        url: validated.url,
        secret_token: validated.secretToken,
      });
    },

    getWebhookInfo() {
      logger.info?.('[zalo-client] getWebhookInfo');
      return call('getWebhookInfo', {});
    },
  };
}

export function sendZaloMessage(chatId, text) {
  return createZaloClient().sendMessage(chatId, text);
}

export function sendZaloTyping(chatId) {
  return createZaloClient().sendTyping(chatId);
}
