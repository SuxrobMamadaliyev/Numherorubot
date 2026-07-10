require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const mongoose = require('mongoose');

const { User, Activation } = require('./models');
const { isAdmin, adminOnly, ADMIN_IDS } = require('./admin');
const { mainMenu, backToMain, sendMainMenu, safeEdit } = require('./keyboards');
const { requireChannelSub } = require('./channelSub');
const { fmtUSD } = require('./settings');

const { adminScene, showAdminPanel } = require('./adminScene');
const { topupScene, showTopupMenu, approveTopup, creditStarsPayment } = require('./topupScene');
const {
  showServices,
  handleServiceSelect,
  handleCountrySelect,
  handleCheapestForService,
  showCheapNumbers,
  handleConfirm,
  handleCancelActivation,
  startExpiryWatchdog,
} = require('./buyScene');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ---- MongoDB подключение ----
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB подключён'))
  .catch(err => console.error('❌ Ошибка MongoDB:', err));

startExpiryWatchdog(bot);

// ---- Сцены ----
const stage = new Scenes.Stage([adminScene(), topupScene()]);
bot.use(session());
bot.use(stage.middleware());

// ---- Сохранение пользователя в базу ----
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

// ---- Проверка обязательной подписки на канал ----
bot.use(requireChannelSub);

// ================= START =================
bot.start(async ctx => {
  const admin = isAdmin(ctx.from.id);

  // Реферал
  const payload = ctx.startPayload;
  if (payload && /^\d+$/.test(payload) && parseInt(payload) !== ctx.from.id) {
    const existing = await User.findOne({ telegramId: ctx.from.id });
    if (existing && !existing.referredBy) {
      await User.updateOne({ telegramId: ctx.from.id }, { referredBy: parseInt(payload) });
      const { getSetting, fmtUSD } = require('./settings');
      const bonus = await getSetting('referral_bonus_usd');
      await User.updateOne(
        { telegramId: parseInt(payload) },
        { $inc: { balance: bonus, referralCount: 1 } }
      );
      try {
        await ctx.telegram.sendMessage(
          payload,
          `🎉 По вашей реферальной ссылке зарегистрировался новый пользователь!\n💰 +${fmtUSD(bonus)} зачислено на баланс.`
        );
      } catch {}
    }
  }

  const userDoc = await User.findOne({ telegramId: ctx.from.id });
  const balance = userDoc?.balance || 0;

  await sendMainMenu(
    ctx,
    `👋 Привет, ${ctx.from.first_name}!\n\n` +
    `📱 Через этого бота вы можете купить виртуальные номера для различных сервисов.\n\n` +
    `👛 Ваш баланс: <b>${fmtUSD(balance)}</b>\n\n` +
    `🔥 Нажмите кнопку ниже, чтобы увидеть самые выгодные предложения.`,
    mainMenu(admin),
    { edit: false }
  );
});

// ================= ПРОВЕРКА ПОДПИСКИ НА КАНАЛ =================
bot.action('check_sub', async ctx => {
  const admin = isAdmin(ctx.from.id);
  await ctx.answerCbQuery('✅ Проверено!');
  await sendMainMenu(
    ctx,
    `👋 Добро пожаловать, ${ctx.from.first_name}!\n\nВыберите нужный пункт меню:`,
    mainMenu(admin),
    { edit: true }
  );
});

// ================= ГЛАВНОЕ МЕНЮ =================
bot.action('back_main', async ctx => {
  await ctx.answerCbQuery();
  const admin = isAdmin(ctx.from.id);
  const userDoc = await User.findOne({ telegramId: ctx.from.id });
  const balance = userDoc?.balance || 0;
  const text = `🏠 <b>Главное меню</b>\n\n👛 Ваш баланс: <b>${fmtUSD(balance)}</b>`;
  await sendMainMenu(ctx, text, mainMenu(admin), { edit: true });
});

bot.action('help', async ctx => {
  await ctx.answerCbQuery();
  const { getSetting } = require('./settings');
  const support = await getSetting('support_username');
  await safeEdit(ctx,
    `❓ <b>Помощь</b>\n\n` +
    `🔥 «Дешёвые номера» — список самых выгодных предложений по всем сервисам\n` +
    `📱 «Купить номер» — выберите сервис и страну, чтобы купить виртуальный номер\n` +
    `👤 «Кабинет» — баланс и история покупок\n` +
    `👛 «Пополнить баланс» — оплата через Telegram Stars, карту или Visa\n\n` +
    `💡 После выбора сервиса кнопка «🔥 Выбрать самый дешёвый автоматически» найдёт самую выгодную страну.\n\n` +
    `💬 По вопросам: ${support}`,
    { parse_mode: 'HTML', ...backToMain() }
  );
});

// ================= КАБИНЕТ =================
bot.action('cabinet', async ctx => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: ctx.from.id });
  const activations = await Activation.find({ telegramId: ctx.from.id }).sort({ createdAt: -1 }).limit(5);

  let histText = activations.length
    ? activations.map(a => `• ${a.service} (${a.status === 'success' ? '✅' : a.status === 'pending' ? '⏳' : '❌'}) — ${fmtUSD(a.pricePaid)}`).join('\n')
    : 'История пуста.';

  const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;

  await safeEdit(ctx,
    `👤 <b>Кабинет</b>\n\n` +
    `🆔 ID: <code>${ctx.from.id}</code>\n` +
    `👛 Баланс: <b>${fmtUSD(user?.balance)}</b>\n` +
    `💸 Всего потрачено: <b>${fmtUSD(user?.totalSpent)}</b>\n` +
    `👥 Рефералов: <b>${user?.referralCount || 0}</b>\n\n` +
    `📜 <b>Последние покупки:</b>\n${histText}\n\n` +
    `🔗 Реферальная ссылка:\n<code>${refLink}</code>`,
    { parse_mode: 'HTML', ...backToMain() }
  );
});

// ================= КУПИТЬ НОМЕР =================
bot.action('buy_number', async ctx => {
  await ctx.answerCbQuery();
  await showServices(ctx);
});

bot.action('cheap_numbers', async ctx => {
  await showCheapNumbers(ctx);
});

bot.action(/^svc_(.+)$/, async ctx => {
  await handleServiceSelect(ctx, ctx.match[1]);
});

bot.action(/^cheapest_(.+)$/, async ctx => {
  await handleCheapestForService(ctx, ctx.match[1]);
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

// ================= ПОПОЛНЕНИЕ БАЛАНСА =================
bot.action('topup', async ctx => {
  await ctx.answerCbQuery();
  await ctx.scene.enter('topup_flow');
});

// ================= АДМИН ПАНЕЛЬ =================
bot.action('admin_panel', adminOnly, async ctx => {
  await ctx.answerCbQuery();
  await ctx.scene.enter('admin');
});

// ================= ADMIN: подтверждение / отклонение пополнения =================
bot.action(/^approve_topup_(\d+)_(\d+)_(\d+)$/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Нет доступа', { show_alert: true });
  await ctx.answerCbQuery('✅ Подтверждено');
  const targetUserId = parseInt(ctx.match[1]);
  const credited = parseInt(ctx.match[2]);
  const fee = parseInt(ctx.match[3]);
  try {
    const updated = await approveTopup(ctx, targetUserId, credited, fee);
    await ctx.editMessageCaption(
      ctx.callbackQuery.message.caption +
        `\n\n✅ <b>ПОДТВЕРЖДЕНО</b> (новый баланс: ${fmtUSD(updated.balance)})`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('Ошибка подтверждения пополнения:', e);
    try {
      await ctx.editMessageCaption(
        ctx.callbackQuery.message.caption + `\n\n❌ <b>ОШИБКА:</b> ${e.message}`,
        { parse_mode: 'HTML' }
      );
    } catch {}
  }
});

bot.action(/^reject_topup_(\d+)$/, async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Нет доступа', { show_alert: true });
  await ctx.answerCbQuery('❌ Отклонено');
  const targetUserId = parseInt(ctx.match[1]);
  try {
    await ctx.telegram.sendMessage(targetUserId, "❌ Ваш чек об оплате отклонён. Пожалуйста, свяжитесь с администратором или попробуйте ещё раз.", backToMain());
  } catch {}
  try {
    await ctx.editMessageCaption(
      ctx.callbackQuery.message.caption + '\n\n❌ <b>ОТКЛОНЕНО</b>',
      { parse_mode: 'HTML' }
    );
  } catch {}
});

// ================= ADMIN: добавление баланса командой =================
// /addbalance <telegram_id> <сумма>
bot.command('addbalance', async ctx => {
  if (!isAdmin(ctx.from.id)) return;
  const parts = ctx.message.text.split(' ').filter(Boolean);
  if (parts.length !== 3) {
    return ctx.reply('Формат: /addbalance <telegram_id> <сумма>\nПример: /addbalance 123456789 10');
  }
  const [, targetId, amountStr] = parts;
  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return ctx.reply('❌ Неверная сумма.');

  await User.findOneAndUpdate(
    { telegramId: parseInt(targetId) },
    { $inc: { balance: amount } },
    { upsert: true }
  );
  await ctx.reply(`✅ Пользователю ${targetId} начислено ${fmtUSD(amount)}.`);
  try {
    await ctx.telegram.sendMessage(targetId, `💰 На ваш баланс зачислено ${fmtUSD(amount)}!`);
  } catch {}
});

// ================= ОПЛАТА ЧЕРЕЗ TELEGRAM STARS =================
bot.on('pre_checkout_query', async ctx => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.error('Ошибка pre_checkout:', e.message);
  }
});

bot.on('successful_payment', async ctx => {
  const payment = ctx.message.successful_payment;
  if (payment.currency !== 'XTR') return;

  const starsCount = payment.total_amount;
  const parts = (payment.invoice_payload || '').split('_');
  const amountCents = parseInt(parts[2]) || 0;

  if (amountCents > 0) {
    await creditStarsPayment(ctx, ctx.from.id, amountCents, starsCount);
  } else {
    await ctx.reply('✅ Платёж получен, но не удалось определить сумму. Обратитесь к администратору.');
  }
});

// ================= ОБРАБОТКА ОШИБОК =================
bot.catch((err, ctx) => {
  console.error('Ошибка бота:', err);
  try {
    ctx.reply('❌ Произошла техническая ошибка. Пожалуйста, попробуйте позже.');
  } catch {}
});

// ================= ЗАПУСК (WEBHOOK + HEALTH CHECK) =================
const express = require('express');
const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL;
const WEBHOOK_PATH = `/webhook/${process.env.BOT_TOKEN}`;

if (!DOMAIN) {
  console.error('❌ WEBHOOK_URL или RENDER_EXTERNAL_URL не найден. Добавьте WEBHOOK_URL в .env');
  process.exit(1);
}

const app = express();
app.use(express.json());

app.get('/ping', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.status(200).send('Бот работает'));

app.use(bot.webhookCallback(WEBHOOK_PATH));

async function setWebhookWithRetry(retries = 8, delaySeconds = 3) {
  try {
    await bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`);
    console.log(`✅ Webhook установлен: ${DOMAIN}${WEBHOOK_PATH}`);
  } catch (err) {
    const retryAfter = err?.response?.parameters?.retry_after || delaySeconds;
    console.error(`❌ Ошибка установки webhook: ${err.message}`);
    if (retries > 0) {
      console.warn(`⏳ Повтор через ${retryAfter}с... (осталось попыток: ${retries})`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return setWebhookWithRetry(retries - 1, Math.min(delaySeconds * 2, 30));
    }
    console.error('❌ Webhook не установлен после всех попыток. Сервер продолжает работу.');
  }
}

app.get('/set-webhook', async (req, res) => {
  try {
    await bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`);
    res.status(200).send('✅ Webhook переустановлен');
  } catch (err) {
    res.status(500).send('❌ Ошибка: ' + err.message);
  }
});

app.listen(PORT, async () => {
  console.log(`🌐 Сервер запущен на порту ${PORT}`);
  setWebhookWithRetry();
  console.log('🤖 Бот запущен (webhook)');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
