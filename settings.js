const { Settings } = require('./models');

const DEFAULTS = {
  markup_percent: 30,
  usd_to_uzs: 12700,
  topup_fee_percent: 3,
  star_to_uzs: 100,
  min_balance_uzs: 5000,
  referral_bonus_uzs: 10,
  card_number: '9860 1678 4936 3665',
  card_holder: 'Suhrob M',
  visa_details: '4231 2000 8587 6505 ',        // Номер Visa / международной карты
  visa_holder: 'Suhrob M',         // Имя владельца Visa
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

async function calcPriceUZS(costUSD) {
  const rate = await getSetting('usd_to_uzs');
  const markup = await getSetting('markup_percent');
  const base = costUSD * rate;
  return Math.ceil(base * (1 + markup / 100) / 100) * 100;
}

module.exports = { getSetting, setSetting, getAllSettings, calcPriceUZS, DEFAULTS };
