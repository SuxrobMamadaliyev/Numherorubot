const { Markup } = require('telegraf');
const { SERVICES, COUNTRIES } = require('./herosms');
const { getSetting } = require('./settings');

function mainMenu(isAdmin = false) {
  const rows = [
    [Markup.button.callback('🔥 Arzon nomerlar', 'cheap_numbers')],
    [
      Markup.button.callback('📱 Raqam olish', 'buy_number'),
      Markup.button.callback('👤 Kabinet', 'cabinet'),
    ],
    [
      Markup.button.callback("👛 Balans to'ldirish", 'topup'),
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
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([Markup.button.callback('🔥 Eng arzon takliflar', 'cheap_numbers')]);
  rows.push([Markup.button.callback('🔙 Bosh menyu', 'back_main')]);
  return Markup.inlineKeyboard(rows);
}

function countriesKeyboard(serviceCode) {
  const buttons = COUNTRIES.map(c =>
    Markup.button.callback(c.name, `cnt_${serviceCode}_${c.code}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([Markup.button.callback('🔥 Eng arzonini avtomatik tanlash', `cheapest_${serviceCode}`)]);
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
      Markup.button.callback('⭐ Stars kursi', 'adm_starsrate'),
    ],
    [
      Markup.button.callback('💳 Karta', 'adm_card'),
      Markup.button.callback('📢 Majburiy kanallar', 'adm_channel'),
    ],
    [Markup.button.callback('🎁 Referal bonusi', 'adm_refbonus')],
    [Markup.button.callback('🧾 Isbot kanali', 'adm_proofchannel')],
    [Markup.button.callback('🖼 Bosh menyu rasmi', 'adm_image')],
    [Markup.button.callback('📊 Statistika', 'adm_stats')],
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

// Asosiy menyuni (matn + tugmalar) admin tomonidan o'rnatilgan rasm bilan yoki rasmsiz chiqaradi.
// edit=true bo'lsa, mavjud xabarni tahrirlashga harakat qiladi (callback orqali chaqirilganda).
async function sendMainMenu(ctx, text, keyboard, { edit = false } = {}) {
  const image = await getSetting('main_menu_image');

  if (image) {
    if (edit && ctx.callbackQuery) {
      try {
        await ctx.editMessageMedia(
          { type: 'photo', media: image, caption: text, parse_mode: 'HTML' },
          keyboard
        );
        return;
      } catch (e) {
        // Eski xabar rasm emas edi (matn xabar) — uni o'chirib, yangi rasm xabarini yuboramiz
        try { await ctx.deleteMessage(); } catch {}
      }
    }
    try {
      await ctx.replyWithPhoto(image, { caption: text, parse_mode: 'HTML', ...keyboard });
      return;
    } catch (e) {
      console.error('Bosh menyu rasmini yuborishda xato:', e.message);
      // rasm yuborib bo'lmadi — pastda matn sifatida yuboramiz
    }
  }

  if (edit && ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      return;
    } catch {}
  }
  await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

// Xabarni tahrirlashga urinadi; agar joriy xabar matn bo'lmasa (masalan rasm bo'lsa)
// yoki boshqa sababdan tahrirlab bo'lmasa, eski xabarni o'chirib, yangisini yuboradi.
async function safeEdit(ctx, text, extra = {}) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (e) {
    try { await ctx.deleteMessage(); } catch {}
    return ctx.reply(text, extra);
  }
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
  sendMainMenu,
  safeEdit,
};
