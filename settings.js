const { Settings } = require('./models');

const DEFAULTS = {
  markup_percent: 30,          // HeroSMS narxiga qo'shiladigan foiz (%)
  usd_to_uzs: 12700,           // 1 dollar = ? so'm
  topup_fee_percent: 3,        // Balans to'ldirishda ushlab qolinadigan komissiya (%)
  star_to_uzs: 100,            // 1 Telegram Star = ? so'm (Stars orqali to'ldirishda balansga shu kursda qo'shiladi)
  min_balance_uzs: 5000,       // Minimal balans (so'm)
  referral_bonus_uzs: 10,    // Referal uchun bonus (so'm)
  card_number: '9860 1678 4936 3665',
  card_holder: 'Suhrob M',
  support_username: '@suxacyber404',
  force_sub_channels: [],      // Majburiy obuna kanallari roʻyxati (masalan: ['@kanal1', '@kanal2']). Cheksiz qoʻshish mumkin.
  main_menu_image: '',         // Asosiy menyu tugmalari ustida chiqadigan rasm (Telegram file_id). Bo'sh bo'lsa — rasm yo'q.
  proof_channel: '',           // Har bir xariddan keyin "isbot" post yuboriladigan kanal (masalan: @kanalim). Bo'sh bo'lsa — yuborilmaydi.
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
