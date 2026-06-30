const { Markup } = require('telegraf');
const { SERVICES, COUNTRIES } = require('./herosms');

function mainMenu(isAdmin = false) {
  const rows = [
    [
      Markup.button.callback('📱 Raqam olish', 'buy_number'),
      Markup.button.callback('👤 Kabinet', 'cabinet'),
    ],
    [
      Markup.button.callback('👛 Balans to\'ldirish', 'topup'),
      Markup.button.callback('❓ Yordam', 'help'),
    ],
  ];
  if (isAdmin) {
    rows.push([Markup.button.callback('⚙️ Admin panel', 'admin_panel')]);
  }
  return Markup.inlineKeyboard(rows);
}

function servicesKeyboard() {
  const buttons = SERVICES.map(s =>
    Markup.button.callback(s.name, `svc_${s.code}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback('🔙 Orqaga', 'back_main')]);
  return Markup.inlineKeyboard(rows);
}

function countriesKeyboard(serviceCode) {
  const buttons = COUNTRIES.map(c =>
    Markup.button.callback(c.name, `cnt_${serviceCode}_${c.code}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback('🔙 Servislar', 'buy_number')]);
  return Markup.inlineKeyboard(rows);
}

function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Markup %', 'adm_markup'),
      Markup.button.callback('💱 USD kurs', 'adm_usdrate'),
    ],
    [
      Markup.button.callback('📉 Toʻldirish komissiyasi', 'adm_topupfee'),
      Markup.button.callback('💳 Karta', 'adm_card'),
    ],
    [
      Markup.button.callback('📢 Majburiy kanal', 'adm_channel'),
      Markup.button.callback('📊 Statistika', 'adm_stats'),
    ],
    [Markup.button.callback('🔙 Bosh menyu', 'back_main')],
  ]);
}


function backToAdmin() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Admin panel', 'admin_panel')]]);
}

function backToMain() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Bosh menyu', 'back_main')]]);
}

function confirmBuyKeyboard(serviceCode, countryCode) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Tasdiqlash', `confirm_${serviceCode}_${countryCode}`)],
    [Markup.button.callback('❌ Bekor qilish', 'back_main')],
  ]);
}

function cancelActivationKeyboard(activationId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚫 Bekor qilish', `cancel_act_${activationId}`)],
  ]);
}

module.exports = {
  mainMenu,
  servicesKeyboard,
  countriesKeyboard,
  adminPanelKeyboard,
  backToAdmin,
  backToMain,
  confirmBuyKeyboard,
  cancelActivationKeyboard,
};
