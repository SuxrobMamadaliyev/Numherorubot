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

// Juda arzon (odatda $0.02–0.03 atrofida) raqamlar ko'pincha allaqachon
// ishlatilgan/bloklangan bo'lib, SMS kelmasligi ehtimoli yuqori bo'ladi.
// Shu sabab "eng arzon takliflar"da bu chegaradan pastdagilar chiqarib tashlanadi.
const MIN_RELIABLE_COST_USD = 0.05;

async function apiRequest(apiKey, params) {
  const res = await axios.get(API_URL, {
    params: { api_key: apiKey, ...params },
    timeout: 15000,
  });
  return res.data;
}

// Arminiya va Qirg'iziston uchun mamlakat ID'lari provayderlar orasida farq
// qilishi mumkin, shuning uchun ularni statik ro'yxatda qattiq yozib qo'yish
// xavfli (noto'g'ri davlat raqami berilib qolishi mumkin). Buning o'rniga
// haqiqiy ID'lar HeroSMS'ning o'z getCountries javobidan nomi bo'yicha
// (eng/rus) qidirib topiladi va 24 soatga keshlanadi.
const EXTRA_POPULAR_COUNTRIES = [
  { match: ['armenia', 'армения'], label: '🇦🇲 Arminiya' },
  { match: ['kyrgyzstan', 'киргизия', 'кыргызстан'], label: '🇰🇬 Qirgʻiziston' },
];
let extraCountryCache = { data: null, ts: 0 };
const EXTRA_COUNTRY_TTL = 24 * 60 * 60 * 1000;

async function getExtraPopularCountries(apiKey) {
  const now = Date.now();
  if (extraCountryCache.data && now - extraCountryCache.ts < EXTRA_COUNTRY_TTL) {
    return extraCountryCache.data;
  }
  try {
    const all = await getAllCountries(apiKey);
    const found = [];
    for (const wanted of EXTRA_POPULAR_COUNTRIES) {
      for (const code of Object.keys(all || {})) {
        const meta = all[code] || {};
        const names = [meta.eng, meta.rus].filter(Boolean).map(n => String(n).toLowerCase());
        if (wanted.match.some(m => names.includes(m))) {
          found.push({ code: String(code), name: wanted.label });
          break;
        }
      }
    }
    extraCountryCache = { data: found, ts: now };
    return found;
  } catch {
    return extraCountryCache.data || [];
  }
}

// COUNTRIES ro'yxatini Arminiya/Qirg'iziston bilan birga qaytaradi (mavjud bo'lsa).
async function getPopularCountries(apiKey) {
  const extra = await getExtraPopularCountries(apiKey);
  return [...COUNTRIES, ...extra];
}

async function getBalance(apiKey) {
  const data = await apiRequest(apiKey, { action: 'getBalance' });
  if (typeof data === 'string' && data.startsWith('ACCESS_BALANCE:')) {
    return parseFloat(data.split(':')[1]);
  }
  throw new Error('Balans olishda xato: ' + data);
}

// Mamlakat kodidan chiroyli nom topish (mavjud bo'lmasa — kodni ko'rsatadi)
function countryName(code) {
  const c = COUNTRIES.find(x => x.code === String(code));
  if (c) return c.name;
  const meta = countryListCache.data && countryListCache.data[String(code)];
  if (meta) return `🌍 ${meta.eng || meta.rus || code}`;
  return `🌍 Mamlakat #${code}`;
}

// HeroSMS APIdagi BARCHA mamlakatlar roʻyxati (id -> {eng, rus, ...}).
// 24 soat keshlanadi — bu roʻyxat kamdan-kam oʻzgaradi.
let countryListCache = { data: null, ts: 0 };
const COUNTRY_LIST_TTL = 24 * 60 * 60 * 1000;

async function getAllCountries(apiKey) {
  const now = Date.now();
  if (countryListCache.data && now - countryListCache.ts < COUNTRY_LIST_TTL) {
    return countryListCache.data;
  }
  try {
    const data = await apiRequest(apiKey, { action: 'getCountries' });
    if (typeof data === 'object' && data) {
      countryListCache = { data, ts: now };
      return data;
    }
  } catch {}
  return countryListCache.data || {};
}

// Bitta servis uchun APIdagi BARCHA mamlakatlar boʻyicha narx/mavjudlikni qaytaradi
// (faqat mavjud, ya'ni count > 0 boʻlganlarini) — mamlakat nomi bilan birga.
async function getAllOffersForService(apiKey, serviceCode) {
  const [prices, countries] = await Promise.all([
    apiRequest(apiKey, { action: 'getPrices', service: serviceCode }),
    getAllCountries(apiKey),
  ]);

  if (typeof prices !== 'object' || !prices) return [];

  const offers = [];
  for (const code of Object.keys(prices)) {
    const info = prices[code]?.[serviceCode];
    if (!info) continue;
    const cost = parseFloat(info.cost || info.retail_price || 0);
    const count = parseInt(info.count || 0);
    if (!(cost >= MIN_RELIABLE_COST_USD) || count <= 0) continue;

    const staticC = COUNTRIES.find(x => x.code === String(code));
    const meta = countries?.[code];
    const name = staticC ? staticC.name : `🌍 ${meta?.eng || meta?.rus || `Mamlakat #${code}`}`;

    offers.push({ code: String(code), name, cost, count });
  }

  offers.sort((a, b) => a.cost - b.cost);
  return offers;
}

// Raqam narxini olish (dollarda).
// MUHIM: xato yoki nomaʼlum javob holatida yolgʻon narx (masalan 0.1$) qaytarilmaydi —
// buning oʻrniga ok:false qaytariladi, chaqiruvchi tomon foydalanuvchiga aniq xabar koʻrsatadi.
async function getNumberPrice(apiKey, service, country) {
  try {
    const data = await apiRequest(apiKey, {
      action: 'getPrices',
      service,
      country,
    });
    const info = typeof data === 'object' && data ? data[country]?.[service] : null;
    if (info) {
      return {
        cost: parseFloat(info.cost || info.retail_price || 0),
        count: parseInt(info.count || 0),
        ok: true,
      };
    }
    return { cost: 0, count: 0, ok: false };
  } catch {
    return { cost: 0, count: 0, ok: false };
  }
}

// Bitta servis uchun BARCHA mamlakatlar orasidan eng arzon va mavjud (count > 0) taklifni topadi
async function getCheapestForService(apiKey, serviceCode) {
  try {
    const data = await apiRequest(apiKey, { action: 'getPrices', service: serviceCode });
    if (typeof data !== 'object' || !data) return null;

    let best = null;
    for (const countryCode of Object.keys(data)) {
      const info = data[countryCode]?.[serviceCode];
      if (!info) continue;
      const cost = parseFloat(info.cost || info.retail_price || 0);
      const count = parseInt(info.count || 0);
      if (count > 0 && cost >= MIN_RELIABLE_COST_USD && (!best || cost < best.cost)) {
        best = { countryCode: String(countryCode), cost, count };
      }
    }
    return best;
  } catch {
    return null;
  }
}

// Barcha mashhur servislar boʻyicha eng arzon takliflarni topadi (2 daqiqa keshlanadi,
// bu HeroSMS APIga ortiqcha soʻrov yubormaslik — "aniq va tejamli" ishlatish uchun)
let cheapCache = { data: null, ts: 0 };
const CHEAP_CACHE_TTL = 2 * 60 * 1000;

async function getCheapOffers(apiKey, { force = false } = {}) {
  const now = Date.now();
  if (!force && cheapCache.data && now - cheapCache.ts < CHEAP_CACHE_TTL) {
    return cheapCache.data;
  }

  const results = await Promise.all(
    SERVICES.filter(s => s.code !== 'ot').map(async svc => {
      const best = await getCheapestForService(apiKey, svc.code);
      if (!best) return null;
      return { service: svc, ...best };
    })
  );

  const offers = results.filter(Boolean).sort((a, b) => a.cost - b.cost);
  cheapCache = { data: offers, ts: now };
  return offers;
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
  getCheapestForService,
  getCheapOffers,
  getAllCountries,
  getAllOffersForService,
  getPopularCountries,
  countryName,
  ERROR_MAP,
};
