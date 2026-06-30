const axios = require('axios');

const API_URL = 'https://hero-sms.com/stubs/handler_api.php';

// Mashhur servislar (inline button uchun)
const SERVICES = [
  { code: 'tg', name: '✈️ Telegram' },
  { code: 'wa', name: '💬 WhatsApp' },
  { code: 'go', name: '🔍 Google' },
  { code: 'ig', name: '📸 Instagram' },
  { code: 'vk', name: '🅱️ VKontakte' },
  { code: 'tt', name: '🎵 TikTok' },
  { code: 'ds', name: '🎮 Discord' },
  { code: 'fb', name: '👤 Facebook' },
  { code: 'ub', name: '🚗 Uber' },
  { code: 'mb', name: '📦 Wildberries' },
  { code: 'ot', name: '🔣 Boshqa' },
];

// Mashhur mamlakatlar
const COUNTRIES = [
  { code: '0',  name: '🇷🇺 Rossiya' },
  { code: '6',  name: '🇮🇩 Indoneziya' },
  { code: '2',  name: '🇰🇿 Qozogʻiston' },
  { code: '7',  name: '🇵🇭 Filippin' },
  { code: '4',  name: '🇺🇦 Ukraina' },
  { code: '3',  name: '🇨🇳 Xitoy' },
  { code: '1',  name: '🇺🇸 AQSh' },
  { code: '22', name: '🇮🇳 Hindiston' },
  { code: '9',  name: '🇹🇷 Turkiya' },
  { code: '5',  name: '🇬🇧 Buyuk Britaniya' },
  { code: '14', name: '🇲🇾 Malayziya' },
  { code: '13', name: '🇪🇬 Misr' },
];

async function apiRequest(apiKey, params) {
  const res = await axios.get(API_URL, {
    params: { api_key: apiKey, ...params },
    timeout: 15000,
  });
  return res.data;
}

async function getBalance(apiKey) {
  const data = await apiRequest(apiKey, { action: 'getBalance' });
  if (typeof data === 'string' && data.startsWith('ACCESS_BALANCE:')) {
    return parseFloat(data.split(':')[1]);
  }
  throw new Error('Balans olishda xato: ' + data);
}

// Raqam narxini olish (dollarda)
async function getNumberPrice(apiKey, service, country) {
  try {
    const data = await apiRequest(apiKey, {
      action: 'getPrices',
      service,
      country,
    });
    if (typeof data === 'object' && data[country]?.[service]) {
      const info = data[country][service];
      return {
        cost: parseFloat(info.cost || info.retail_price || 0),
        count: parseInt(info.count || 0),
      };
    }
    return { cost: 0.1, count: 0 };
  } catch {
    return { cost: 0.1, count: 0 };
  }
}

async function getNumber(apiKey, service, country) {
  const data = await apiRequest(apiKey, { action: 'getNumber', service, country });
  if (typeof data === 'string' && data.startsWith('ACCESS_NUMBER:')) {
    const parts = data.split(':');
    return { activationId: parts[1], phoneNumber: parts[2] };
  }
  throw new Error(data);
}

async function getStatus(apiKey, activationId) {
  const data = await apiRequest(apiKey, { action: 'getStatus', id: activationId });
  return data;
}

async function setStatus(apiKey, activationId, status) {
  return apiRequest(apiKey, { action: 'setStatus', id: activationId, status });
}

const ERROR_MAP = {
  NO_NUMBERS: '❌ Bu servis/mamlakat uchun raqamlar tugagan.',
  NO_BALANCE: '❌ Tizim balansi yetarli emas. Admin bilan bog\'laning.',
  BAD_SERVICE: '❌ Servis kodi noto\'g\'ri.',
  BAD_KEY: '❌ API kalit xato.',
  ERROR_SQL: '❌ Server xatoligi, qayta urinib ko\'ring.',
};

module.exports = {
  SERVICES,
  COUNTRIES,
  getBalance,
  getNumber,
  getStatus,
  setStatus,
  getNumberPrice,
  ERROR_MAP,
};
