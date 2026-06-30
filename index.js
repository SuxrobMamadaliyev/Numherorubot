require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const mongoose = require('mongoose');

const { User, Activation } = require('./models');
const { isAdmin, adminOnly, ADMIN_IDS } = require('./admin');
const { mainMenu, backToMain } = require('./keyboards');
const { requireChannelSub } = require('./channelSub');

const { adminScene, showAdminPanel } = require('./adminScene');
const { topupScene, showTopupMenu, approveTopup } = require('./topupScene');
const {
  showServices,
  handleServiceSelect,
  handleCountrySelect,
  handleConfirm,
  handleCancelActivation,
} = require('./buyScene');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ---- MongoDB ulanish ----
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB ulandi'))
  .catch(err => console.error('❌ MongoDB xatosi:', err));

// ---- Scenes ----
const stage = new Scenes.Stage([adminScene(), topupScene()]);
bot.use(session());
bot.use(stage.middleware());

// ---- Foydalanuvchini bazaga yozish ----
bot.use(async (ctx, next) => {
  if (ctx.from) {
    await User.findOneAndUpdate(
      { telegramId: ctx.from.id },
      {
        $setOnInsert: {
          telegramId: ctx.from.id,
          username: ctx.from.username,
          fullName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
        },
      },
      { upsert: true }
    );
  }
  return next();
});

// ---- Majburiy kanal obunasi tekshiruvi ----
bot.use(requireChannelSub);

// ================= START =================
bot.start(async ctx => {
  const admin = isAdmin(ctx.from.id);

  // Referal
  const payload = ctx.startPayload;
  if (payload && /^\d+$/.test(payload) && parseInt(payload) !== ctx.from.id) {
    const existing = await User.findOne({ telegramId: ctx.from.id });
    if (existing && !existing.referredBy) {
      await User.updateOne({ telegramId: ctx.from.id }, { referredBy: parseInt(payload) });
      const { getSetting } = require('./settings');
      const bonus = await getSetting('referral_bonus_uzs');
      await User.updateOne(
        { telegramId: parseInt(payload) },
        { $inc: { balance: bonus, referralCount: 1 } }
      );
      try {
        await ctx.telegram.sendMessage(
          payload,
          `🎉 Sizning referalingiz orqali yangi foydalanuvchi qo'shildi!\n💰 +${bonus.toLocaleString()} so'm balansga qo'shildi.`
        );
      } catch {}
    }
  }

  await ctx.reply(
    `👋 Assalomu alaykum, ${ctx.from.first_name}!\n\n` +
    `📱 Bu bot orqali turli xizmatlar uchun virtual raqamlar sotib olishingiz mumkin.\n\n` +
    `Quyidagi menyudan foydalaning:`,
    mainMenu(admin)
  );
});

// ================= KANAL OBUNASINI TEKSHIRISH =================
bot.action('check_sub', async ctx => {
  const admin = isAdmin(ctx.from.id);
  await ctx.answerCbQuery('✅ Tekshirildi!');
  try {
    await ctx.editMessageText(
      `👋 Xush kelibsiz, ${ctx.from.first_name}!\n\n` +
      `Quyidagi menyudan foydalaning:`,
      { parse_mode: 'HTML', ...mainMenu(admin) }
    );
  } catch {
    await ctx.reply('🏠 Bosh menyu', mainMenu(admin));
  }
});

// ================= MAIN MENU =================
bot.action('back_main', async ctx => {
  await ctx.answerCbQuery();
  const admin = isAdmin(ctx.from.id);
  try {
    await ctx.editMessageText('🏠 <b>Bosh menyu</b>', { parse_mode: 'HTML', ...mainMenu(admin) });
  } catch {
    await ctx.reply('🏠 <b>Bosh menyu</b>', { parse_mode: 'HTML', ...mainMenu(admin) });
  }
});

bot.action('help', async ctx => {
  await ctx.answerCbQuery();
  const { getSetting } = require('./settings');
  const support = await getSetting('support_username');
  await ctx.editMessageText(
    `❓ <b>Yordam</b>\n\n` +
    `📱 "Raqam olish" — virtual raqam sotib olish\n` +
    `👤 "Kabinet" — balans va tarix\n` +
    `👛 "Balans to'ldirish" — karta orqali to'lov\n\n` +
    `💬 Savollar bo'yicha: ${support}`,
    { parse_mode: 'HTML', ...backToMain() }
  );
});

// ================= CABINET =================
bot.action('cabinet', async ctx => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const activations = await Activation.find({ telegramId: ctx.from.id }).sort({ createdAt: -1 }).limit(5);

  let histText = activations.length
    ? activations.map(a => `• ${a.service} (${a.status === 'success' ? '✅' : a.status === 'pending' ? '⏳' : '❌'}) — ${a.pricePaid.toLocaleString()} so'm`).join('\n')
    : 'Tarix mavjud emas.';

  const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;

  await ctx.editMessageText(
    `👤 <b>Kabinet</b>\n\n` +
    `🆔 ID: <code>${ctx.from.id}</code>\n` +
    `👛 Balans: <b>${(user?.balance || 0).toLocaleString()} so'm</b>\n` +
    `💸 Jami sarflangan: <b>${(user?.totalSpent || 0).toLocaleString()} so'm</b>\n` +
    `👥 Referallar: <b>${user?.referralCount || 0}</b>\n\n` +
    `📜 <b>Oxirgi xaridlar:</b>\n${histText}\n\n` +
    `🔗 Referal havola:\n<code>${refLink}</code>`,
    { parse_mode: 'HTML', ...backToMain() }
  );
});

// ================= BUY NUMBER =================
bot.action('buy_number', async ctx => {
  await ctx.answerCbQuery();
  await showServices(ctx);
});

bot.action(/^svc_(.+)$/, async ctx => {
  await handleServiceSelect(ctx, ctx.match[1]);
});

bot.action(/^cnt_(.+)_(.+)$/, async ctx => {
  await handleCountrySelect(ctx, ctx.match[1], ctx.match[2]);
});

bot.action(/^confirm_(.+)_(.+)$/, async ctx => {
  await handleConfirm(ctx, ctx.match[1], ctx.match[2]);
});

bot.action(/^cancel_act_(.+)$/, async ctx => {
  await handleCancelActivation(ctx, ctx.match[1]);
});

// ================= BALANS TO'LDIRISH (entry point) =================
bot.action('topup', async ctx => {
  await ctx.answerCbQuery();
  await ctx.scene.enter('topup_flow');
});

// ================= ADMIN PANEL (entry point) =================
bot.action('admin_panel', adminOnly, async ctx => {
  await ctx.answerCbQuery();
  await ctx.scene.enter('admin');
});

// ================= ADMIN: balans to'ldirish tasdiqlash / rad etish =================
bot.action(/^approve_topup_(\d+)_(\d+)_(\d+)$/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Ruxsat yoq', { show_alert: true });
  await ctx.answerCbQuery('✅ Tasdiqlandi');
  const targetUserId = parseInt(ctx.match[1]);
  const credited = parseInt(ctx.match[2]);
  const fee = parseInt(ctx.match[3]);
  await approveTopup(ctx, targetUserId, credited, fee);
  try {
    await ctx.editMessageCaption(
      ctx.callbackQuery.message.caption + '\n\n✅ <b>TASDIQLANDI</b>',
      { parse_mode: 'HTML' }
    );
  } catch {}
});

bot.action(/^reject_topup_(\d+)$/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Ruxsat yoq', { show_alert: true });
  await ctx.answerCbQuery('❌ Rad etildi');
  const targetUserId = parseInt(ctx.match[1]);
  try {
    await ctx.telegram.sendMessage(targetUserId, "❌ To'lov chekingiz rad etildi. Iltimos, admin bilan bog'laning yoki qaytadan urinib ko'ring.", backToMain());
  } catch {}
  try {
    await ctx.editMessageCaption(
      ctx.callbackQuery.message.caption + '\n\n❌ <b>RAD ETILDI</b>',
      { parse_mode: 'HTML' }
    );
  } catch {}
});

// ================= ADMIN: balans qo'shish komandasi =================
// /addbalance <telegram_id> <miqdor>
bot.command('addbalance', async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  const parts = ctx.message.text.split(' ').filter(Boolean);
  if (parts.length !== 3) {
    return ctx.reply('Format: /addbalance <telegram_id> <miqdor>\nMasalan: /addbalance 123456789 50000');
  }
  const [, targetId, amountStr] = parts;
  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return ctx.reply("❌ Miqdor noto'g'ri.");

  await User.findOneAndUpdate(
    { telegramId: parseInt(targetId) },
    { $inc: { balance: amount } },
    { upsert: true }
  );
  await ctx.reply(`✅ ${targetId} ga ${amount.toLocaleString()} so'm qo'shildi.`);
  try {
    await ctx.telegram.sendMessage(targetId, `💰 Balansingizga ${amount.toLocaleString()} so'm qo'shildi!`);
  } catch {}
});

// ================= ERROR HANDLING =================
bot.catch((err, ctx) => {
  console.error('Bot xatosi:', err);
  try {
    ctx.reply("❌ Texnik xatolik yuz berdi. Iltimos, keyinroq urinib ko'ring.");
  } catch {}
});

// ================= LAUNCH (WEBHOOK) =================
const PORT = process.env.PORT || 3000;
// RENDER_EXTERNAL_URL Render tomonidan avtomatik beriladi (masalan: https://my-bot.onrender.com)
// Agar boshqa hostingda bo'lsa, WEBHOOK_URL ni .env orqali qo'lda bering.
const DOMAIN = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL;
const WEBHOOK_PATH = `/webhook/${process.env.BOT_TOKEN}`;

if (!DOMAIN) {
  console.error('❌ WEBHOOK_URL yoki RENDER_EXTERNAL_URL topilmadi. .env ga WEBHOOK_URL qo\'shing (masalan: https://your-app.onrender.com)');
  process.exit(1);
}

bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`).then(() => {
  console.log(`✅ Webhook o'rnatildi: ${DOMAIN}${WEBHOOK_PATH}`);
});

bot.launch({
  webhook: {
    domain: DOMAIN,
    hookPath: WEBHOOK_PATH,
    port: PORT,
  },
}).then(() => console.log(`🤖 Bot ishga tushdi (webhook, port ${PORT})`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
