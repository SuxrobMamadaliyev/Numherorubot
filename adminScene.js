const { Scenes, Markup } = require('telegraf');
const { getSetting, setSetting, getAllSettings } = require('./settings');
const { adminPanelKeyboard, backToAdmin, safeEdit } = require('./keyboards');
const { User, Activation } = require('./models');
const { getBalance } = require('./herosms');

// Admin panel asosiy ko'rinish
async function showAdminPanel(ctx) {
  const s = await getAllSettings();
  const channels = s.force_sub_channels || [];
  const text =
    `⚙️ <b>Admin Panel</b>\n\n` +
    `💰 Markup (raqam narxiga): <b>${s.markup_percent}%</b>\n` +
    `📉 Toʻldirish komissiyasi: <b>${s.topup_fee_percent}%</b>\n` +
    `⭐ Stars kursi: <b>1⭐ = ${s.star_to_uzs.toLocaleString()} so'm</b>\n` +
    `💱 USD/UZS kurs: <b>${s.usd_to_uzs.toLocaleString()} so'm</b>\n` +
    `💳 Karta: <b>${s.card_number}</b>\n` +
    `👤 Egasi: <b>${s.card_holder}</b>\n` +
    `📢 Majburiy kanallar: <b>${channels.length ? channels.length + ' ta' : 'oʻchirilgan'}</b>\n` +
    `🎁 Referal bonusi: <b>${(s.referral_bonus_uzs || 0).toLocaleString()} so'm</b>\n` +
    `🖼 Bosh menyu rasmi: <b>${s.main_menu_image ? 'oʻrnatilgan' : 'oʻrnatilmagan'}</b>\n` +
    `🧾 Isbot kanali: <b>${s.proof_channel || 'oʻrnatilmagan'}</b>\n` +
    `💬 Support: <b>${s.support_username}</b>`;

  const keyboard = adminPanelKeyboard();
  if (ctx.callbackQuery) {
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

function channelMenuKeyboard(channels) {
  const rows = [];
  channels.forEach((ch, i) => {
    rows.push([Markup.button.callback(`🗑 ${ch}`, `adm_channel_del_${i}`)]);
  });
  rows.push([Markup.button.callback('➕ Kanal qoʻshish', 'adm_channel_add')]);
  if (channels.length) {
    rows.push([Markup.button.callback('🚫 Barchasini oʻchirish', 'adm_channel_clear')]);
  }
  rows.push([Markup.button.callback('🔙 Admin panel', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
}

function imageMenuKeyboard(hasImage) {
  const rows = [];
  rows.push([Markup.button.callback(hasImage ? '✏️ Rasmni almashtirish' : '➕ Rasm qoʻshish', 'adm_image_set')]);
  if (hasImage) {
    rows.push([Markup.button.callback('🗑 Rasmni oʻchirish', 'adm_image_remove')]);
  }
  rows.push([Markup.button.callback('🔙 Admin panel', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
}

// Waiting state: { key, label }
const waiting = {}; // telegramId -> { key, label }
const waitingPhoto = {}; // telegramId -> true (rasm kutilmoqda)

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
    adm_starsrate:  { key: 'star_to_uzs',        label: "1 Telegram Star necha so'mligini kiriting (masalan: 220)" },
    adm_card:       { key: '_card_combo',        label: 'Karta raqami va egasini kiriting:\nFormat: KARTA_RAQAMI|Ism Familiya\nMasalan: 8600 1234 5678 9012|Karimov Karim' },
    adm_support:    { key: 'support_username',   label: 'Support username kiriting (masalan: @admin_support)' },
    adm_refbonus:   { key: 'referral_bonus_uzs', label: "Referal uchun beriladigan bonus miqdorini kiriting, so'mda (masalan: 3000)" },
    adm_proofchannel: {
      key: 'proof_channel',
      label: "Isbot kanali username kiriting (masalan: @kanalim).\n❗️Bot shu kanalda admin boʻlishi shart, aks holda postlar yuborilmaydi.\nOʻchirish uchun \"-\" belgisini yuboring.",
    },
  };

  // Inline button handler
  scene.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === 'admin_panel' || data === 'back_admin') {
      await ctx.answerCbQuery();
      delete waiting[ctx.from.id];
      delete waitingPhoto[ctx.from.id];
      return showAdminPanel(ctx);
    }

    if (data === 'adm_channel') {
      await ctx.answerCbQuery();
      const channels = (await getSetting('force_sub_channels')) || [];
      const listText = channels.length
        ? channels.map((c, i) => `${i + 1}. ${c}`).join('\n')
        : 'Hozircha kanal qoʻshilmagan.';
      return safeEdit(ctx, 
        `📢 <b>Majburiy obuna kanallari</b>\n\n${listText}\n\n` +
        (channels.length
          ? "Foydalanuvchilar botdan foydalanishdan oldin barcha kanallarga aʼzo boʻlishlari shart."
          : "Cheksiz miqdorda kanal qoʻsha olasiz."),
        { parse_mode: 'HTML', ...channelMenuKeyboard(channels) }
      );
    }

    if (data === 'adm_channel_add') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = {
        key: '_channel_add',
        label: "Kanal username yoki linkini kiriting (masalan: @mychannel yoki https://t.me/mychannel).\n❗️Bot shu kanalda admin boʻlishi shart, aks holda tekshiruv ishlamaydi.",
      };
      return safeEdit(ctx, 
        `✏️ ${waiting[ctx.from.id].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'adm_channel')]]) }
      );
    }

    if (data.startsWith('adm_channel_del_')) {
      const idx = parseInt(data.replace('adm_channel_del_', ''), 10);
      const channels = (await getSetting('force_sub_channels')) || [];
      const removed = channels[idx];
      if (Number.isInteger(idx) && removed !== undefined) {
        channels.splice(idx, 1);
        await setSetting('force_sub_channels', channels);
      }
      await ctx.answerCbQuery(removed ? `🗑 Oʻchirildi: ${removed}` : 'Topilmadi');
      const listText = channels.length
        ? channels.map((c, i) => `${i + 1}. ${c}`).join('\n')
        : 'Hozircha kanal qoʻshilmagan.';
      return safeEdit(ctx, 
        `📢 <b>Majburiy obuna kanallari</b>\n\n${listText}`,
        { parse_mode: 'HTML', ...channelMenuKeyboard(channels) }
      );
    }

    if (data === 'adm_channel_clear') {
      await ctx.answerCbQuery('🚫 Barchasi oʻchirildi');
      await setSetting('force_sub_channels', []);
      return safeEdit(ctx, 
        '🚫 Barcha majburiy kanallar oʻchirildi. Endi foydalanuvchilar erkin foydalanishadi.',
        { parse_mode: 'HTML', ...backToAdmin() }
      );
    }

    if (data === 'adm_image') {
      await ctx.answerCbQuery();
      const image = await getSetting('main_menu_image');
      return safeEdit(ctx, 
        `🖼 <b>Bosh menyu rasmi</b>\n\n` +
        `Joriy holat: <b>${image ? 'oʻrnatilgan' : 'oʻrnatilmagan'}</b>\n\n` +
        (image
          ? "Bu rasm foydalanuvchilarga bosh menyu tugmalari ustida koʻrsatiladi."
          : "Hozircha rasm oʻrnatilmagan — bosh menyu oddiy matn sifatida chiqadi."),
        { parse_mode: 'HTML', ...imageMenuKeyboard(!!image) }
      );
    }

    if (data === 'adm_image_set') {
      await ctx.answerCbQuery();
      delete waiting[ctx.from.id];
      waitingPhoto[ctx.from.id] = true;
      return safeEdit(ctx, 
        '🖼 Bosh menyu uchun rasm yuboring (surat sifatida, fayl emas).',
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'adm_image')]]) }
      );
    }

    if (data === 'adm_image_remove') {
      await ctx.answerCbQuery('🗑 Oʻchirildi');
      await setSetting('main_menu_image', '');
      return safeEdit(ctx, 
        '🗑 Bosh menyu rasmi oʻchirildi.',
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

      await safeEdit(ctx, 
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
      await safeEdit(ctx, 
        `✏️ ${promptMap[data].label}`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'admin_panel')]]) }
      );
      return;
    }

    return next();
  });

  // Bosh menyu rasmini yuklash
  scene.on('photo', async ctx => {
    if (!waitingPhoto[ctx.from.id]) return;
    delete waitingPhoto[ctx.from.id];

    try {
      const photos = ctx.message.photo;
      const fileId = photos[photos.length - 1].file_id; // eng katta o'lchamdagisi
      await setSetting('main_menu_image', fileId);
      await ctx.reply('✅ Bosh menyu rasmi saqlandi!', backToAdmin());
    } catch (e) {
      await ctx.reply('❌ Xatolik: ' + e.message, backToAdmin());
    }
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
      } else if (w.key === '_channel_add') {
        let channel = val.trim();
        if (!channel.startsWith('@') && !channel.startsWith('https://t.me/')) {
          return ctx.reply("❌ Format xato! @username yoki https://t.me/username koʻrinishida kiriting.", backToAdmin());
        }
        const channels = (await getSetting('force_sub_channels')) || [];
        if (channels.includes(channel)) {
          return ctx.reply('⚠️ Bu kanal allaqachon roʻyxatda mavjud.', backToAdmin());
        }
        channels.push(channel);
        await setSetting('force_sub_channels', channels);
        await ctx.reply(`✅ Kanal qoʻshildi: ${channel}\n\n❗️Eslatma: botni shu kanalga admin qilib qoʻyishni unutmang, aks holda obuna tekshiruvi ishlamaydi.\n\n📋 Jami kanallar: ${channels.length} ta`, backToAdmin());
      } else if (w.key === 'proof_channel') {
        if (val === '-') {
          await setSetting('proof_channel', '');
          await ctx.reply('🗑 Isbot kanali oʻchirildi.', backToAdmin());
        } else {
          let channel = val;
          if (!channel.startsWith('@') && !channel.startsWith('https://t.me/')) {
            return ctx.reply("❌ Format xato! @username koʻrinishida kiriting.", backToAdmin());
          }
          await setSetting('proof_channel', channel);
          await ctx.reply(`✅ Isbot kanali oʻrnatildi: ${channel}\n\n❗️Eslatma: botni shu kanalga admin qilib qoʻyishni unutmang.`, backToAdmin());
        }
      } else {
        const numVal = parseFloat(val);
        if (['markup_percent', 'usd_to_uzs', 'topup_fee_percent', 'star_to_uzs', 'referral_bonus_uzs'].includes(w.key)) {
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
