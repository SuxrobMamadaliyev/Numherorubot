const { Scenes, Markup } = require('telegraf');
const { User, Subscription } = require('./models');
const { getSetting, getAllSettings } = require('./settings');
const { subscriptionKeyboard, backToMain } = require('./keyboards');

const PLAN_DAYS = {
  sub_1month: 30,
  sub_3month: 90,
  sub_lifetime: 36500, // ~100 yil = umrbod
};

const PLAN_LABEL = {
  sub_1month: '1 oylik',
  sub_3month: '3 oylik',
  sub_lifetime: 'Umrbod',
};

async function showSubscriptionMenu(ctx) {
  const s = await getAllSettings();
  const user = await User.findOne({ telegramId: ctx.from.id });

  let statusText = '❌ Sizda faol obuna yo\'q.';
  if (user?.isPremium) {
    statusText = user.premiumUntil && user.premiumUntil.getFullYear() < 2100
      ? `✅ Faol obuna: <b>${user.premiumUntil.toLocaleDateString('uz-UZ')}</b> gacha`
      : '✅ Faol obuna: <b>Umrbod</b>';
  }

  const text =
    `💎 <b>Majburiy obuna</b>\n\n` +
    `Botdan foydalanish uchun obuna talab qilinadi.\n\n` +
    `${statusText}\n\n` +
    `Quyidagi rejalardan birini tanlang:`;

  const keyboard = subscriptionKeyboard(s);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

async function handlePlanSelect(ctx, planKey) {
  await ctx.answerCbQuery();
  const s = await getAllSettings();
  const priceKey = planKey + '_uzs';
  const price = s[priceKey];
  const label = PLAN_LABEL[planKey];

  const text =
    `💳 <b>To'lov</b>\n\n` +
    `📦 Reja: <b>${label}</b>\n` +
    `💰 Narx: <b>${price.toLocaleString()} so'm</b>\n\n` +
    `Quyidagi kartaga to'lovni amalga oshiring:\n\n` +
    `💳 <code>${s.card_number}</code>\n` +
    `👤 ${s.card_holder}\n\n` +
    `❗️To'lovdan so'ng chek rasmini shu yerga yuboring. Admin tasdiqlagach obuna faollashadi.\n\n` +
    `💬 Savol bo'lsa: ${s.support_username}`;

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📤 Chek yubordim', `receipt_${planKey}`)],
      [Markup.button.callback('🔙 Orqaga', 'subscription')],
    ]),
  });
}

// Waiting state for receipt photo: telegramId -> planKey
const waitingReceipt = {};

function subscriptionScene() {
  const scene = new Scenes.BaseScene('subscription_flow');

  scene.enter(async ctx => showSubscriptionMenu(ctx));

  scene.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === 'subscription') {
      await ctx.answerCbQuery();
      return showSubscriptionMenu(ctx);
    }

    if (data.startsWith('sub_')) {
      return handlePlanSelect(ctx, data);
    }

    if (data.startsWith('receipt_')) {
      await ctx.answerCbQuery();
      const planKey = data.replace('receipt_', '');
      waitingReceipt[ctx.from.id] = planKey;
      return ctx.editMessageText(
        '📸 Iltimos, to\'lov chekining rasmini (screenshot) shu yerga yuboring.',
        Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor', 'subscription')]])
      );
    }

    return next();
  });

  scene.on('photo', async ctx => {
    const planKey = waitingReceipt[ctx.from.id];
    if (!planKey) return;
    delete waitingReceipt[ctx.from.id];

    const s = await getAllSettings();
    const price = s[planKey + '_uzs'];
    const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    const { ADMIN_IDS } = require('./admin');
    const caption =
      `🧾 <b>Yangi to'lov cheki</b>\n\n` +
      `👤 Foydalanuvchi: ${ctx.from.first_name} (@${ctx.from.username || '—'})\n` +
      `🆔 ID: <code>${ctx.from.id}</code>\n` +
      `📦 Reja: <b>${PLAN_LABEL[planKey]}</b>\n` +
      `💰 Narx: <b>${price.toLocaleString()} so'm</b>`;

    for (const adminId of ADMIN_IDS) {
      try {
        await ctx.telegram.sendPhoto(adminId, photo, {
          caption,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Tasdiqlash', `approve_sub_${ctx.from.id}_${planKey}`),
              Markup.button.callback('❌ Rad etish', `reject_sub_${ctx.from.id}`),
            ],
          ]),
        });
      } catch {}
    }

    await ctx.reply(
      '✅ Chek adminga yuborildi. Tasdiqlangach obunangiz faollashadi.',
      backToMain()
    );
  });

  return scene;
}

// Admin tasdiqlaganda chaqiriladi (bot.js da global handler sifatida ulanadi)
async function approveSubscription(ctx, targetUserId, planKey) {
  const days = PLAN_DAYS[planKey];
  const until = new Date();
  until.setDate(until.getDate() + days);

  await User.findOneAndUpdate(
    { telegramId: targetUserId },
    { isPremium: true, premiumUntil: until },
    { upsert: true }
  );

  const s = await getAllSettings();
  await Subscription.create({
    telegramId: targetUserId,
    plan: planKey,
    priceUZS: s[planKey + '_uzs'],
    endDate: until,
    active: true,
  });

  await ctx.telegram.sendMessage(
    targetUserId,
    `✅ <b>Obunangiz faollashtirildi!</b>\n\n📦 Reja: ${PLAN_LABEL[planKey]}\n📅 Amal qiladi: ${planKey === 'sub_lifetime' ? 'Umrbod' : until.toLocaleDateString('uz-UZ')}`,
    { parse_mode: 'HTML' }
  );
}

module.exports = {
  subscriptionScene,
  showSubscriptionMenu,
  approveSubscription,
  PLAN_LABEL,
};
