const { Scenes, Markup } = require('telegraf');
const { getSetting, setSetting, getAllSettings } = require('../settings');
const {
  adminPanelKeyboard,
  adminSubPricesKeyboard,
  backToAdmin,
} = require('../keyboards');
const { User, Activation } = require('../models');
const { getBalance } = require('../herosms');

// Admin panel asosiy ko'rinish
async function showAdminPanel(ctx) {
  const s = await getAllSettings();
  const text =
    `⚙️ <b>Admin Panel</b>\n\n` +
    `💰 Markup: <b>${s.markup_percent}%</b>\n` +
    `💱 USD/UZS kurs: <b>${s.usd_to_uzs.toLocaleString()} so'm</b>\n` +
    `📦 1 oy obuna: <b>${s.sub_1month_uzs.toLocaleString()} so'm</b>\n` +
    `📦 3 oy obuna: <b>${s.sub_3month_uzs.toLocaleString()} so'm</b>\n` +
    `📦 Umrbod: <b>${s.sub_lifetime_uzs.toLocaleString()} so'm</b>\n` +
    `💳 Karta: <b>${s.card_number}</b>\n` +
    `👤 Egasi: <b>${s.card_holder}</b>\n` +
    `🎁 Referal bonus: <b>${s.referral_bonus_uzs.toLocaleString()} so'm</b>\n` +
    `💬 Support: <b>${s.support_username}</b>`;

  const keyboard = adminPanelKeyboard();
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

// Waiting state: { key, label }
const waiting = {}; // telegramId -> { key, label }

function adminScene() {
  const scene = new Scenes.BaseScene('admin');

  scene.enter(async ctx => {
    await showAdminPanel(ctx);
  });

  // Har bir tugma uchun "qiymat kirit" so'rash
  const promptMap = {
    adm_markup:    { key: 'markup_percent',     label: 'Yangi markup foizini kiriting (masalan: 25)' },
    adm_usdrate:   { key: 'usd_to_uzs',         label: "1 USD = ? so'm (masalan: 12700)" },
    adm_sub1:      { key: 'sub_1month_uzs',     label: "1 oylik obuna narxi (so'm)" },
    adm_sub3:      { key: 'sub_3month_uzs',     label: "3 oylik obuna narxi (so'm)" },
    adm_sublife:   { key: 'sub_lifetime_uzs',   label: "Umrbod obuna narxi (so'm)" },
    adm_referral:  { key: 'referral_bonus_uzs', label: "Referal bonus (so'm)" },
    adm_card:      { key: '_card_combo',         label: 'Karta raqami va egasini kiriting:\nFormat: KARTA_RAQAMI|Ism Familiya\nMasalan: 8600 1234 5678 9012|Karimov Karim' },
    adm_support:   { key: 'support_username',   label: 'Support username kiriting (masalan: @admin_support)' },
  };

  // Inline button handler
  scene.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === 'admin_panel' || data === 'back_admin') {
      await ctx.answerCbQuery();
      delete waiting[ctx.from.id];
      return showAdminPanel(ctx);
    }

    if (data === 'adm_subprices') {
      await ctx.answerCbQuery();
      return ctx.editMessageText(
        '📦 Qaysi obuna narxini o\'zgartirmoqchisiz?',
        adminSubPricesKeyboard()
      );
    }

    if (data === 'adm_stats') {
      await ctx.answerCbQuery();
      const totalUsers = await User.countDocuments();
      const totalActivations = await Activation.countDocuments();
      const successAct = await Activation.countDocuments({ status: 'success' });
      let heroBalance = '—';
      try {
        heroBalance = '$' + (await getBalance(process.env.HEROSMS_API_KEY)).toFixed(2);
      } catch {}
      await ctx.editMessageText(
        `📊 <b>Statistika</b>\n\n` +
        `👥 Jami foydalanuvchilar: <b>${totalUsers}</b>\n` +
        `📱 Jami aktivatsiyalar: <b>${totalActivations}</b>\n` +
        `✅ Muvaffaqiyatli: <b>${successAct}</b>\n` +
        `💰 HeroSMS balansi: <b>${heroBalance}</b>`,
        { parse_mode: 'HTML', ...backToAdmin() }
      );
      return;
    }

    if (promptMap[data]) {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = promptMap[data];
      await ctx.editMessageText(
        `✏️ ${promptMap[data].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'admin_panel')]]) }
      );
      return;
    }

    return next();
  });

  // Matn kiritish
  scene.on('text', async ctx => {
    const w = waiting[ctx.from.id];
    if (!w) return;

    const val = ctx.message.text.trim();
    delete waiting[ctx.from.id];

    try {
      if (w.key === '_card_combo') {
        const [cardNum, cardHolder] = val.split('|').map(s => s.trim());
        if (!cardNum || !cardHolder) {
          return ctx.reply('❌ Format xato! Qaytadan urinib ko\'ring:\n8600 XXXX XXXX XXXX|Ism Familiya');
        }
        await setSetting('card_number', cardNum);
        await setSetting('card_holder', cardHolder);
        await ctx.reply(`✅ Karta yangilandi:\n💳 ${cardNum}\n👤 ${cardHolder}`, backToAdmin());
      } else {
        const numVal = parseFloat(val);
        if (['markup_percent', 'usd_to_uzs', 'sub_1month_uzs', 'sub_3month_uzs', 'sub_lifetime_uzs', 'referral_bonus_uzs'].includes(w.key)) {
          if (isNaN(numVal) || numVal <= 0) {
            return ctx.reply('❌ Iltimos, to\'g\'ri raqam kiriting.', backToAdmin());
          }
          await setSetting(w.key, numVal);
        } else {
          await setSetting(w.key, val);
        }
        await ctx.reply(`✅ Saqlandi!`, backToAdmin());
      }
    } catch (e) {
      await ctx.reply('❌ Xatolik: ' + e.message, backToAdmin());
    }
  });

  return scene;
}

module.exports = { adminScene, showAdminPanel };
