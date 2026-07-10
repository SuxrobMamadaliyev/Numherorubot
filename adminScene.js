const { Scenes, Markup } = require('telegraf');
const { getSetting, setSetting, getAllSettings, fmtUSD } = require('./settings');
const { adminPanelKeyboard, balancesMenuKeyboard, balancesResetConfirmKeyboard, backToAdmin, safeEdit } = require('./keyboards');
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
    `⭐ Stars kursi: <b>1⭐ ≈ ${fmtUSD(s.star_to_usd)}</b>\n` +
    `💳 Visa: <b>${s.visa_details || 'oʻrnatilmagan'}</b>\n` +
    `👤 Egasi: <b>${s.visa_holder || '—'}</b>\n` +
    `📢 Majburiy kanallar: <b>${channels.length ? channels.length + ' ta' : 'oʻchirilgan'}</b>\n` +
    `🎁 Referal bonusi: <b>${fmtUSD(s.referral_bonus_usd)}</b>\n` +
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

const BALANCES_PAGE_SIZE = 15;
const DIVIDER_CHAR = '➖➖➖➖➖➖➖➖➖➖';

// Foydalanuvchilar balanslari roʻyxatini sahifalab koʻrsatadi
async function showBalancesPage(ctx, page = 0) {
  const totalUsers = await User.countDocuments();
  const totalPages = Math.max(1, Math.ceil(totalUsers / BALANCES_PAGE_SIZE));
  page = Math.min(Math.max(0, page), totalPages - 1);

  const users = await User.find({})
    .sort({ balance: -1 })
    .skip(page * BALANCES_PAGE_SIZE)
    .limit(BALANCES_PAGE_SIZE)
    .lean();

  const totalAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$balance' } } }]);
  const totalBalance = totalAgg[0]?.total || 0;

  const lines = users.map((u, i) => {
    const num = page * BALANCES_PAGE_SIZE + i + 1;
    const name = u.username ? `@${u.username}` : (u.fullName || `ID:${u.telegramId}`);
    return `${num}. ${name} — <b>${fmtUSD(u.balance)}</b>`;
  });

  const text =
    `👥 <b>Foydalanuvchilar balansi</b>\n\n` +
    (lines.length ? lines.join('\n') : 'Foydalanuvchilar topilmadi.') +
    `\n\n💰 Jami balans (barcha foydalanuvchilar): <b>${fmtUSD(totalBalance)}</b>\n` +
    `📄 Sahifa: ${page + 1}/${totalPages}`;

  await safeEdit(ctx, text, { parse_mode: 'HTML', ...balancesMenuKeyboard(page, totalPages) });
}

// Barcha foydalanuvchilarga xabar yuborish (cursor orqali xotirani tejab, birma-bir yuboriladi).
// Telegramning global cheklovi (~30 xabar/soniya) ga tushib qolmaslik uchun har birida kichik pauza qilinadi.
async function broadcastToAllUsers(ctx, content) {
  const cursor = User.find({}, { telegramId: 1 }).lean().cursor();
  let sent = 0, failed = 0, total = 0;

  for (let user = await cursor.next(); user != null; user = await cursor.next()) {
    total++;
    try {
      if (content.type === 'photo') {
        await ctx.telegram.sendPhoto(user.telegramId, content.photo, {
          caption: content.caption || undefined,
          parse_mode: 'HTML',
        });
      } else {
        await ctx.telegram.sendMessage(user.telegramId, content.text, { parse_mode: 'HTML' });
      }
      sent++;
    } catch (e) {
      failed++; // bloklangan, chat topilmadi va h.k.
    }
    await new Promise(r => setTimeout(r, 40));
  }

  return { sent, failed, total };
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
const pendingBroadcast = {}; // adminTelegramId -> { type: 'text'|'photo', text?, photo?, caption? }

function adminScene() {
  const scene = new Scenes.BaseScene('admin');

  scene.enter(async ctx => {
    await showAdminPanel(ctx);
  });

  // Har bir tugma uchun "qiymat kirit" so'rash
  const promptMap = {
    adm_markup:     { key: 'markup_percent',     label: 'Yangi markup foizini kiriting (masalan: 25)' },
    adm_topupfee:   { key: 'topup_fee_percent',  label: "Balans to'ldirish komissiyasini kiriting % (masalan: 5)" },
    adm_starsrate:  { key: 'star_to_usd',        label: "1 Telegram Star necha dollar turishini kiriting (masalan: 0.02)" },
    adm_visa:       { key: '_visa_combo',        label: "Visa/xalqaro karta rekvizitlari va egasini kiriting:\nFormat: REKVIZIT|Ism Familiya\nMasalan: 4231 2000 8587 6505|Suhrob M" },
    adm_support:    { key: 'support_username',   label: 'Support username kiriting (masalan: @admin_support)' },
    adm_refbonus:   { key: 'referral_bonus_usd', label: "Referal uchun beriladigan bonus miqdorini dollarda kiriting (masalan: 0.5)" },
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

    if (data === 'adm_balances') {
      await ctx.answerCbQuery();
      return showBalancesPage(ctx, 0);
    }

    if (data.startsWith('adm_balances_page_')) {
      await ctx.answerCbQuery();
      const page = parseInt(data.replace('adm_balances_page_', ''), 10) || 0;
      return showBalancesPage(ctx, page);
    }

    if (data === 'adm_balances_reset_confirm') {
      await ctx.answerCbQuery();
      return safeEdit(ctx,
        `⚠️ <b>Diqqat!</b>\n\nHaqiqatan ham BARCHA foydalanuvchilarning balansini 0 ga tushirmoqchimisiz?\nBu amalni ortga qaytarib boʻlmaydi.`,
        { parse_mode: 'HTML', ...balancesResetConfirmKeyboard() }
      );
    }

    if (data === 'adm_balances_reset_do') {
      await ctx.answerCbQuery('✅ Bajarildi');
      const result = await User.updateMany({}, { $set: { balance: 0 } });
      await safeEdit(ctx,
        `✅ Barcha foydalanuvchilar balansi 0 qilindi.\n👥 Yangilangan foydalanuvchilar: <b>${result.modifiedCount ?? result.nModified ?? 0}</b>`,
        { parse_mode: 'HTML', ...backToAdmin() }
      );
      return;
    }

    if (data === 'adm_broadcast') {
      await ctx.answerCbQuery();
      delete pendingBroadcast[ctx.from.id];
      waiting[ctx.from.id] = { key: '_broadcast' };
      return safeEdit(ctx,
        `📣 <b>Barchaga xabar yuborish</b>\n\n` +
        `Yubormoqchi boʻlgan xabar matnini kiriting yoki rasm (izoh bilan) yuboring.\n\n` +
        `ℹ️ HTML formatlash qoʻllab-quvvatlanadi (masalan: <b>qalin</b>, <i>qiya</i>).`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'admin_panel')]]) }
      );
    }

    if (data === 'adm_broadcast_send') {
      await ctx.answerCbQuery();
      const pending = pendingBroadcast[ctx.from.id];
      if (!pending) {
        return safeEdit(ctx, "❌ Yuborish uchun xabar topilmadi. Qaytadan urinib koʻring.", { parse_mode: 'HTML', ...backToAdmin() });
      }
      delete pendingBroadcast[ctx.from.id];
      await ctx.reply('⏳ Xabar yuborilmoqda... Foydalanuvchilar soniga qarab bir necha daqiqa vaqt olishi mumkin.');
      const result = await broadcastToAllUsers(ctx, pending);
      await ctx.reply(
        `✅ <b>Xabar yuborish yakunlandi</b>\n\n` +
        `📤 Yuborildi: <b>${result.sent}</b>\n` +
        `🚫 Yuborilmadi (bloklangan/xato): <b>${result.failed}</b>\n` +
        `👥 Jami foydalanuvchilar: <b>${result.total}</b>`,
        { parse_mode: 'HTML', ...backToAdmin() }
      );
      return;
    }

    if (data === 'adm_broadcast_cancel') {
      await ctx.answerCbQuery('❌ Bekor qilindi');
      delete pendingBroadcast[ctx.from.id];
      return showAdminPanel(ctx);
    }

    if (data === 'adm_stats') {
      await ctx.answerCbQuery();
      const totalUsers = await User.countDocuments();
      const totalActivations = await Activation.countDocuments();
      const successAct = await Activation.countDocuments({ status: 'success' });

      // Sotuvdan tushgan pul — faqat SMS kelib, muvaffaqiyatli yakunlangan
      // aktivatsiyalar hisobga olinadi (pending/bekor/timeout hisoblanmaydi).
      const salesAgg = await Activation.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: null, total: { $sum: '$pricePaid' } } },
      ]);
      const totalSales = salesAgg[0]?.total || 0;

      const feeAgg = await User.aggregate([
        { $group: { _id: null, totalFee: { $sum: '$totalFeeCollected' } } },
      ]);
      const totalFee = feeAgg[0]?.totalFee || 0;

      let heroBalance = '—';
      try {
        heroBalance = '$' + (await getBalance(process.env.HEROSMS_API_KEY)).toFixed(2);
      } catch {}

      let starsBalance = '—';
      try {
        const res = await ctx.telegram.callApi('getMyStarBalance', {});
        starsBalance = `${res.amount ?? 0}⭐`;
      } catch (e) {
        console.error('Stars balansini olishda xato:', e.message);
      }

      await safeEdit(ctx, 
        `📊 <b>Statistika</b>\n\n` +
        `👥 Jami foydalanuvchilar: <b>${totalUsers}</b>\n` +
        `📱 Jami aktivatsiyalar: <b>${totalActivations}</b>\n` +
        `✅ Muvaffaqiyatli: <b>${successAct}</b>\n\n` +
        `💵 Raqamlardan tushgan (sotuv): <b>${fmtUSD(totalSales)}</b>\n` +
        `📉 To'ldirish komissiyasidan: <b>${fmtUSD(totalFee)}</b>\n\n` +
        `💰 HeroSMS balansi: <b>${heroBalance}</b>\n` +
        `⭐ Bot Stars balansi: <b>${starsBalance}</b>`,
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

  // Bosh menyu rasmini yuklash / Broadcast uchun rasm qabul qilish
  scene.on('photo', async ctx => {
    const w = waiting[ctx.from.id];

    if (w && w.key === '_broadcast') {
      delete waiting[ctx.from.id];
      const photos = ctx.message.photo;
      const fileId = photos[photos.length - 1].file_id;
      const caption = ctx.message.caption || '';
      pendingBroadcast[ctx.from.id] = { type: 'photo', photo: fileId, caption };

      const confirmKb = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yuborish', 'adm_broadcast_send'), Markup.button.callback('❌ Bekor', 'adm_broadcast_cancel')],
      ]);
      try {
        await ctx.replyWithPhoto(fileId, {
          caption: `📣 <b>Preview</b>\n${DIVIDER_CHAR}\n${caption}`,
          parse_mode: 'HTML',
          ...confirmKb,
        });
      } catch (e) {
        delete pendingBroadcast[ctx.from.id];
        await ctx.reply('❌ Xabar formatida xato: ' + e.message, backToAdmin());
      }
      return;
    }

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

    if (w.key === '_broadcast') {
      delete waiting[ctx.from.id];
      const text = ctx.message.text;
      pendingBroadcast[ctx.from.id] = { type: 'text', text };

      const confirmKb = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yuborish', 'adm_broadcast_send'), Markup.button.callback('❌ Bekor', 'adm_broadcast_cancel')],
      ]);
      try {
        await ctx.reply(`📣 <b>Preview</b>\n${DIVIDER_CHAR}\n${text}`, { parse_mode: 'HTML', ...confirmKb });
      } catch (e) {
        delete pendingBroadcast[ctx.from.id];
        await ctx.reply('❌ Xabar formatida xato: ' + e.message, backToAdmin());
      }
      return;
    }

    const val = ctx.message.text.trim();
    delete waiting[ctx.from.id];

    try {
      if (w.key === '_visa_combo') {
        const [details, holder] = val.split('|').map(s => s.trim());
        if (!details || !holder) {
          return ctx.reply("❌ Format xato! Qaytadan urinib ko'ring:\nREKVIZIT|Ism Familiya");
        }
        await setSetting('visa_details', details);
        await setSetting('visa_holder', holder);
        await ctx.reply(`✅ Visa rekvizitlari yangilandi:\n💳 ${details}\n👤 ${holder}`, backToAdmin());
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
        if (['markup_percent', 'topup_fee_percent', 'star_to_usd', 'referral_bonus_usd'].includes(w.key)) {
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
