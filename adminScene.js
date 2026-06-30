const { Scenes, Markup } = require('telegraf');
const { getSetting, setSetting, getAllSettings } = require('./settings');
const { adminPanelKeyboard, backToAdmin } = require('./keyboards');
const { User, Activation } = require('./models');
const { getBalance } = require('./herosms');

// Admin panel asosiy ko'rinish
async function showAdminPanel(ctx) {
  const s = await getAllSettings();
  const text =
    `⚙️ <b>Admin Panel</b>\n\n` +
    `💰 Markup (raqam narxiga): <b>${s.markup_percent}%</b>\n` +
    `📉 Toʻldirish komissiyasi: <b>${s.topup_fee_percent}%</b>\n` +
    `💱 USD/UZS kurs: <b>${s.usd_to_uzs.toLocaleString()} so'm</b>\n` +
    `💳 Karta: <b>${s.card_number}</b>\n` +
    `👤 Egasi: <b>${s.card_holder}</b>\n` +
    `📢 Majburiy kanal: <b>${s.force_sub_channel || 'oʻchirilgan'}</b>\n` +
    `💬 Support: <b>${s.support_username}</b>`;

  const keyboard = adminPanelKeyboard();
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

function channelMenuKeyboard(currentChannel) {
  const rows = [];
  rows.push([Markup.button.callback(currentChannel ? '✏️ Kanalni almashtirish' : '➕ Kanal qoʻshish', 'adm_channel_set')]);
  if (currentChannel) {
    rows.push([Markup.button.callback('🚫 Majburiy obunani oʻchirish', 'adm_channel_remove')]);
  }
  rows.push([Markup.button.callback('🔙 Admin panel', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
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
    adm_markup:     { key: 'markup_percent',     label: 'Yangi markup foizini kiriting (masalan: 25)' },
    adm_usdrate:    { key: 'usd_to_uzs',         label: "1 USD = ? so'm (masalan: 12700)" },
    adm_topupfee:   { key: 'topup_fee_percent',  label: "Balans to'ldirish komissiyasini kiriting % (masalan: 5)" },
    adm_card:       { key: '_card_combo',        label: 'Karta raqami va egasini kiriting:\nFormat: KARTA_RAQAMI|Ism Familiya\nMasalan: 8600 1234 5678 9012|Karimov Karim' },
    adm_support:    { key: 'support_username',   label: 'Support username kiriting (masalan: @admin_support)' },
    adm_channel_set:{ key: 'force_sub_channel',  label: "Kanal username'ini kiriting (masalan: @mychannel).\n❗️Bot kanalda admin bo'lishi shart, aks holda tekshiruv ishlamaydi." },
  };

  // Inline button handler
  scene.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === 'admin_panel' || data === 'back_admin') {
      await ctx.answerCbQuery();
      delete waiting[ctx.from.id];
      return showAdminPanel(ctx);
    }

    if (data === 'adm_channel') {
      await ctx.answerCbQuery();
      const channel = await getSetting('force_sub_channel');
      return ctx.editMessageText(
        `📢 <b>Majburiy kanal obunasi</b>\n\n` +
        `Joriy holat: <b>${channel || 'oʻchirilgan'}</b>\n\n` +
        (channel
          ? "Foydalanuvchilar botdan foydalanishdan oldin shu kanalga aʼzo boʻlishlari shart."
          : "Hozircha majburiy obuna oʻchirilgan — istalgan foydalanuvchi botdan erkin foydalanadi."),
        { parse_mode: 'HTML', ...channelMenuKeyboard(channel) }
      );
    }

    if (data === 'adm_channel_remove') {
      await ctx.answerCbQuery('🚫 Oʻchirildi');
      await setSetting('force_sub_channel', '');
      return ctx.editMessageText(
        '🚫 Majburiy kanal obunasi oʻchirildi. Endi foydalanuvchilar erkin foydalanishadi.',
        { parse_mode: 'HTML', ...backToAdmin() }
      );
    }

    if (data === 'adm_stats') {
      await ctx.answerCbQuery();
      const totalUsers = await User.countDocuments();
      const totalActivations = await Activation.countDocuments();
      const successAct = await Activation.countDocuments({ status: 'success' });

      const agg = await User.aggregate([
        { $group: { _id: null, totalSpent: { $sum: '$totalSpent' }, totalFee: { $sum: '$totalFeeCollected' } } },
      ]);
      const totalSpent = agg[0]?.totalSpent || 0;
      const totalFee = agg[0]?.totalFee || 0;

      let heroBalance = '—';
      try {
        heroBalance = '$' + (await getBalance(process.env.HEROSMS_API_KEY)).toFixed(2);
      } catch {}

      await ctx.editMessageText(
        `📊 <b>Statistika</b>\n\n` +
        `👥 Jami foydalanuvchilar: <b>${totalUsers}</b>\n` +
        `📱 Jami aktivatsiyalar: <b>${totalActivations}</b>\n` +
        `✅ Muvaffaqiyatli: <b>${successAct}</b>\n\n` +
        `💵 Raqamlardan tushgan (sotuv): <b>${totalSpent.toLocaleString()} so'm</b>\n` +
        `📉 To'ldirish komissiyasidan: <b>${totalFee.toLocaleString()} so'm</b>\n\n` +
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
          return ctx.reply("❌ Format xato! Qaytadan urinib ko'ring:\n8600 XXXX XXXX XXXX|Ism Familiya");
        }
        await setSetting('card_number', cardNum);
        await setSetting('card_holder', cardHolder);
        await ctx.reply(`✅ Karta yangilandi:\n💳 ${cardNum}\n👤 ${cardHolder}`, backToAdmin());
      } else if (w.key === 'force_sub_channel') {
        let channel = val.trim();
        if (!channel.startsWith('@') && !channel.startsWith('https://t.me/')) {
          return ctx.reply("❌ Format xato! @username yoki https://t.me/username koʻrinishida kiriting.", backToAdmin());
        }
        await setSetting('force_sub_channel', channel);
        await ctx.reply(`✅ Majburiy kanal oʻrnatildi: ${channel}\n\n❗️Eslatma: botni shu kanalga admin qilib qoʻyishni unutmang, aks holda obuna tekshiruvi ishlamaydi.`, backToAdmin());
      } else {
        const numVal = parseFloat(val);
        if (['markup_percent', 'usd_to_uzs', 'topup_fee_percent'].includes(w.key)) {
          if (isNaN(numVal) || numVal < 0) {
            return ctx.reply("❌ Iltimos, to'g'ri raqam kiriting.", backToAdmin());
          }
          if (w.key === 'topup_fee_percent' && numVal > 100) {
            return ctx.reply("❌ Komissiya 100% dan oshmasligi kerak.", backToAdmin());
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
