const { Scenes, Markup } = require('telegraf');
const { User } = require('./models');
const { getAllSettings, fmtUSD } = require('./settings');
const { backToMain, safeEdit } = require('./keyboards');
const { ADMIN_IDS } = require('./admin');

// Состояние ожидания: telegramId -> { step, method, amount, fee, credited }
const waiting = {};

function methodKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Telegram Stars (автоматически)', 'topup_method_stars')],
    [Markup.button.callback('💳 Visa / международная карта', 'topup_method_visa')],
    [Markup.button.callback('❌ Отмена', 'back_main')],
  ]);
}

async function showTopupMenu(ctx) {
  const user = await User.findOne({ telegramId: ctx.from.id });
  const text =
    `👛 <b>Пополнение баланса</b>\n\n` +
    `💰 Текущий баланс: <b>${fmtUSD(user?.balance)}</b>\n\n` +
    `Выберите способ пополнения:`;

  waiting[ctx.from.id] = { step: 'choose_method' };

  if (ctx.callbackQuery) {
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...methodKeyboard() });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...methodKeyboard() });
  }
}

// amount, fee, credited barchasi dollarda, sentgacha aniqlikda.
function calcFeeUSD(amountUSD, feePercent) {
  const fee = Math.round(amountUSD * feePercent / 100 * 100) / 100;
  const credited = Math.round((amountUSD - fee) * 100) / 100;
  return { fee, credited };
}

function topupScene() {
  const scene = new Scenes.BaseScene('topup_flow');

  scene.enter(async ctx => showTopupMenu(ctx));

  scene.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    if (data === 'back_main') {
      await ctx.answerCbQuery();
      delete waiting[ctx.from.id];
      return ctx.scene.leave();
    }

    if (data === 'topup_method_stars') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = { step: 'amount', method: 'stars' };
      const s = await getAllSettings();
      return safeEdit(ctx,
        `⭐ <b>Пополнение через Telegram Stars</b>\n\n` +
        `ℹ️ Курс: 1 ⭐ ≈ ${fmtUSD(s.star_to_usd)}\n` +
        `✅ Без комиссии, баланс зачисляется автоматически.\n\n` +
        `Введите сумму пополнения в долларах, например: <code>5</code>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'topup')]]) }
      );
    }

    if (data === 'topup_method_visa') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = { step: 'amount', method: 'visa' };
      const s = await getAllSettings();
      return safeEdit(ctx,
        `💳 <b>Пополнение через Visa / международную карту</b>\n\n` +
        `ℹ️ Комиссия за пополнение: <b>${s.topup_fee_percent}%</b>\n\n` +
        `Введите сумму пополнения в долларах, например: <code>10</code>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'topup')]]) }
      );
    }

    if (data === 'topup') {
      await ctx.answerCbQuery();
      return showTopupMenu(ctx);
    }

    return next();
  });

  scene.on('text', async ctx => {
    const w = waiting[ctx.from.id];
    if (!w || w.step !== 'amount') return;

    const amount = parseFloat(ctx.message.text.replace(',', '.').trim());
    if (!amount || amount < 1) {
      return ctx.reply('❌ Пожалуйста, введите корректную сумму (минимум $1).');
    }
    const amountUSD = Math.round(amount * 100) / 100;

    const s = await getAllSettings();

    if (w.method === 'stars') {
      const starsAmount = Math.ceil(amountUSD / s.star_to_usd);
      delete waiting[ctx.from.id];

      try {
        await ctx.replyWithInvoice({
          title: 'Пополнение баланса',
          description: `На ваш баланс будет зачислено ${fmtUSD(amountUSD)}.`,
          payload: `topup_${ctx.from.id}_${Math.round(amountUSD * 100)}_${Date.now()}`,
          provider_token: '',
          currency: 'XTR',
          prices: [{ label: 'Пополнение баланса', amount: starsAmount }],
        });
        await ctx.reply(
          `⭐ Счёт выставлен: <b>${starsAmount} Stars</b> (≈ ${fmtUSD(amountUSD)})\n\n` +
          `Нажмите кнопку «Pay» в сообщении выше для оплаты.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        await ctx.reply('❌ Ошибка при создании счёта: ' + e.message, backToMain());
      }
      return;
    }

    // Visa — требуем чек
    const { fee, credited } = calcFeeUSD(amountUSD, s.topup_fee_percent);
    waiting[ctx.from.id] = { step: 'receipt', method: w.method, amount: amountUSD, fee, credited };

    const visaDetails = s.visa_details || 'Реквизиты не настроены. Обратитесь к администратору.';
    const visaHolder = s.visa_holder || '';
    const paymentDetails =
      `💳 <code>${visaDetails}</code>\n` +
      (visaHolder ? `👤 ${visaHolder}\n` : '');

    await ctx.reply(
      `💳 <b>Оплата</b>\n\n` +
      `💰 Сумма перевода: <b>${fmtUSD(amountUSD)}</b>\n` +
      `📉 Комиссия (${s.topup_fee_percent}%): <b>−${fmtUSD(fee)}</b>\n` +
      `✅ Будет зачислено на баланс: <b>${fmtUSD(credited)}</b>\n\n` +
      `Переведите ${fmtUSD(amountUSD)} на следующие реквизиты:\n\n` +
      paymentDetails + '\n' +
      `❗️После оплаты отправьте скриншот чека прямо сюда. Баланс будет пополнен после проверки администратором.\n\n` +
      `💬 Вопросы: ${s.support_username}`,
      { parse_mode: 'HTML' }
    );
  });

  scene.on('photo', async ctx => {
    const w = waiting[ctx.from.id];
    if (!w || w.step !== 'receipt') return;
    delete waiting[ctx.from.id];

    const { amount, fee, credited } = w;
    const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    const caption =
      `🧾 <b>Запрос на пополнение баланса</b>\n` +
      `💳 Метод: <b>Visa / международная карта</b>\n\n` +
      `👤 Пользователь: ${ctx.from.first_name} (@${ctx.from.username || '—'})\n` +
      `🆔 ID: <code>${ctx.from.id}</code>\n\n` +
      `💰 Переведено: <b>${fmtUSD(amount)}</b>\n` +
      `📉 Комиссия: <b>${fmtUSD(fee)}</b>\n` +
      `✅ К зачислению: <b>${fmtUSD(credited)}</b>`;

    for (const adminId of ADMIN_IDS) {
      try {
        await ctx.telegram.sendPhoto(adminId, photo, {
          caption,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Подтвердить', `approve_topup_${ctx.from.id}_${Math.round(credited * 100)}_${Math.round(fee * 100)}`),
              Markup.button.callback('❌ Отклонить', `reject_topup_${ctx.from.id}`),
            ],
          ]),
        });
      } catch {}
    }

    await ctx.reply(
      `✅ Чек отправлен администратору.\n\n` +
      `💰 Оплата: ${fmtUSD(amount)}\n` +
      `📉 Комиссия: ${fmtUSD(fee)}\n` +
      `✅ После подтверждения будет зачислено: <b>${fmtUSD(credited)}</b>`,
      { parse_mode: 'HTML', ...backToMain() }
    );
    await ctx.scene.leave();
  });

  return scene;
}

// credited va fee sentlarda (integer) keladi — approve_topup_ tugmasidan.
async function approveTopup(ctx, targetUserId, creditedCents, feeCents) {
  const credited = creditedCents / 100;
  const fee = feeCents / 100;
  const updated = await User.findOneAndUpdate(
    { telegramId: targetUserId },
    { $inc: { balance: credited, totalFeeCollected: fee } },
    { upsert: true, new: true }
  );
  try {
    await ctx.telegram.sendMessage(
      targetUserId,
      `✅ Баланс пополнен!\n\n` +
      `➕ Зачислено: <b>${fmtUSD(credited)}</b>\n` +
      `📉 Комиссия (удержана): <b>${fmtUSD(fee)}</b>\n` +
      `👛 Текущий баланс: <b>${fmtUSD(updated.balance)}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('Ошибка отправки сообщения пользователю:', e.message);
  }
  return updated;
}

// amountCents — Stars invoice payload'ida sentlarda kelgan summa.
async function creditStarsPayment(ctx, telegramId, amountCents, starsCount) {
  const amountUSD = amountCents / 100;
  await User.findOneAndUpdate(
    { telegramId },
    { $inc: { balance: amountUSD } },
    { upsert: true }
  );
  await ctx.reply(
    `✅ <b>Оплата прошла успешно!</b>\n\n` +
    `⭐ Оплачено: <b>${starsCount} Stars</b>\n` +
    `➕ Зачислено на баланс: <b>${fmtUSD(amountUSD)}</b>`,
    { parse_mode: 'HTML', ...backToMain() }
  );
}

module.exports = { topupScene, showTopupMenu, approveTopup, calcFeeUSD, creditStarsPayment };
