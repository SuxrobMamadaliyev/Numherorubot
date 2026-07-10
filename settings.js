const { Settings } = require('./models');

const DEFAULTS = {
  markup_percent: 30,
  topup_fee_percent: 3,
  star_to_usd: 0.02,          // 1 Telegram Star qancha dollar turadi
  min_balance_usd: 0.5,
  referral_bonus_usd: 0.1,
  visa_details: '4231 2000 8587 6505',   // Visa / xalqaro karta rekvizitlari
  visa_holder: 'Suhrob M',
  support_username: '@suxacyber404',
  force_sub_channels: [],
  main_menu_image: '',
  proof_channel: '',
};

async function getSetting(key) {
  const doc = await Settings.findOne({ key });
  if (doc) return doc.value;
  return DEFAULTS[key] ?? null;
}

async function setSetting(key, value) {
  await Settings.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
}

async function getAllSettings() {
  const docs = await Settings.find({});
  const result = { ...DEFAULTS };
  for (const d of docs) result[d.key] = d.value;
  return result;
}

// Raqam narxini dollarda hisoblaydi: HeroSMS narxi ($) ustiga markup qo'shiladi.
// Natija sentgacha yaxlitlanadi (yuqoriga), so'mga o'tkazish shart emas —
// HeroSMS API narxlari allaqachon $ da qaytadi.
async function calcPriceUSD(costUSD) {
  const markup = await getSetting('markup_percent');
  const base = costUSD * (1 + markup / 100);
  return Math.ceil(base * 100) / 100;
}

function fmtUSD(amount) {
  return '$' + Number(amount || 0).toFixed(2);
}

module.exports = { getSetting, setSetting, getAllSettings, calcPriceUSD, fmtUSD, DEFAULTS };
