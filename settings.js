const { Settings } = require('./models');

const DEFAULTS = {
  markup_percent: 30,          // HeroSMS narxiga qo'shiladigan foiz (%)
  usd_to_uzs: 12700,           // 1 dollar = ? so'm
  sub_1month_uzs: 29000,       // 1 oylik obuna narxi (so'm)
  sub_3month_uzs: 79000,       // 3 oylik obuna narxi (so'm)
  sub_lifetime_uzs: 199000,    // Umrbod obuna narxi (so'm)
  min_balance_uzs: 5000,       // Minimal balans (so'm)
  referral_bonus_uzs: 3000,    // Referal uchun bonus (so'm)
  card_number: '8600 0000 0000 0000',
  card_holder: 'Abdullayev Abdulla',
  support_username: '@admin_support',
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

module.exports = { getSetting, setSetting, getAllSettings, DEFAULTS };
