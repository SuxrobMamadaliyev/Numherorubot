const { Scenes, Markup } = require('telegraf');
const { User } = require('./models');
const { getAllSettings } = require('./settings');
const { backToMain, safeEdit } = require('./keyboards');
const { ADMIN_IDS } = require('./admin');

// Состояние ожидания: telegramId -> { step, method, amount, fee, credited }
const waiting = {};

function methodKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⭐ Telegram Stars (автоматически)', 'topup_method_stars')],
    [Markup.button.callback('💳 Банковская карта (с чеком)', 'topup_method_card')],
    [Markup.button.callback('💳 Visa / международная карта', 'topup_method_visa')],
    [Markup.button.callback('❌ Отмена', 'back_main')],
  ]);
}

async function showTopupMenu(ctx) {
  const user = await User.findOne({ telegramId: ctx.from.id });
  const text =
    `👛 <b>Пополнение баланса</b>\n\n` +
    `💰 Текущий баланс: <b>${(user?.balance || 0).toLocaleString()} сум</b>\n\n` +
    `Выберите способ пополнения:`;

  waiting[ctx.from.id] = { step: 'choose_method' };

  if (ctx.callbackQuery) {
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...methodKeyboard() });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...methodKeyboard() });
  }
}

function calcFee(amount, feePercent) {
  const fee = Math.round(amount * feePercent / 100);
  const credited = amount - fee;
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

    if (data === 'topup_method_card') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = { step: 'amount', method: 'card' };
      const s = await getAllSettings();
      return safeEdit(ctx,
        `💳 <b>Пополнение через банковскую карту</b>\n\n` +
        `ℹ️ Комиссия за пополнение: <b>${s.topup_fee_percent}%</b>\n\n` +
        `Введите сумму пополнения в сумах, например: <code>50000</code>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'topup')]]) }
      );
    }

    if (data === 'topup_method_stars') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = { step: 'amount', method: 'stars' };
      const s = await getAllSettings();
      return safeEdit(ctx,
        `⭐ <b>Пополнение через Telegram Stars</b>\n\n` +
        `ℹ️ Курс: 1 ⭐ = ${s.star_to_uzs.toLocaleString()} сум\n` +
        `✅ Без комиссии, баланс зачисляется автоматически.\n\n` +
        `Введите сумму пополнения в сумах, например: <code>50000</code>`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'topup')]]) }
      );
    }

    if (data === 'topup_method_visa') {
      await ctx.answerCbQuery();
      waiting[ctx.from.id] = { step: 'amount', method: 'visa' };
      const s = await getAllSettings();
      const visaDetails = s.visa_details || 'Реквизиты не настроены. Обратитесь к администратору.';
      const visaHolder = s.visa_holder || '';
      return safeEdit(ctx,
        `💳 <b>Пополнение через Visa / международную карту</b>\n\n` +
        `ℹ️ Комиссия за пополнение: <b>${s.topup_fee_percent}%</b>\n\n` +
        `Введите сумму пополнения в сумах, например: <code>50000</code>`,
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

    const amount = parseInt(ctx.message.text.replace(/\D/g, ''));
    if (!amount || amount < 1000) {
      return ctx.reply('❌ Пожалуйста, введите корректную сумму (минимум 1000 сум).');
    }

    const s = await getAllSettings();

    if (w.method === 'stars') {
      const starsAmount = Math.ceil(amount / s.star_to_uzs);
      delete waiting[ctx.from.id];

      try {
        await ctx.replyWithInvoice({
          title: 'Пополнение баланса',
          description: `На ваш баланс будет зачислено ${amount.toLocaleString()} сум.`,
          payload: `topup_${ctx.from.id}_${amount}_${Date.now()}`,
          provider_token: '',
          currency: 'XTR',
          prices: [{ label: 'Пополнение баланса', amount: starsAmount }],
        });
        await ctx.reply(
          `⭐ Счёт выставлен: <b>${starsAmount} Stars</b> (≈ ${amount.toLocaleString()} сум)\n\n` +
          `Нажмите кнопку «Pay» в сообщении выше для оплаты.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        await ctx.reply('❌ Ошибка при создании счёта: ' + e.message, backToMain());
      }
      return;
    }

    // Карта / Visa — требуем чек
    const { fee, credited } = calcFee(amount, s.topup_fee_percent);
    waiting[ctx.from.id] = { step: 'receipt', method: w.method, amount, fee, credited };

    let paymentDetails = '';
    let methodLabel = '';

    if (w.method === 'visa') {
      const visaDetails = s.visa_details || 'Реквизиты не настроены';
      const visaHolder = s.visa_holder || '';
      methodLabel = 'Visa / международная карта';
      paymentDetails =
        `💳 <code>${visaDetails}</code>\n` +
        (visaHolder ? `👤 ${visaHolder}\n` : '');
    } else {
      methodLabel = 'Банковская карта';
      paymentDetails =
        `💳 <code>${s.card_number}</code>\n` +
        `👤 ${s.card_holder}\n`;
    }

    await ctx.reply(
      `💳 <b>Оплата</b>\n\n` +
      `💰 Сумма перевода: <b>${amount.toLocaleString()} сум</b>\n` +
      `📉 Комиссия (${s.topup_fee_percent}%): <b>−${fee.toLocaleString()} сум</b>\n` +
      `✅ Будет зачислено на баланс: <b>${credited.toLocaleString()} сум</b>\n\n` +
      `Переведите ${amount.toLocaleString()} сум на следующие реквизиты:\n\n` +
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

    const { amount, fee, credited, method } = w;
    const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    const methodLabel = method === 'visa' ? 'Visa / международная карта' : 'Банковская карта';

    const caption =
      `🧾 <b>Запрос на пополнение баланса</b>\n` +
      `💳 Метод: <b>${methodLabel}</b>\n\n` +
      `👤 Пользователь: ${ctx.from.first_name} (@${ctx.from.username || '—'})\n` +
      `🆔 ID: <code>${ctx.from.id}</code>\n\n` +
      `💰 Переведено: <b>${amount.toLocaleString()} сум</b>\n` +
      `📉 Комиссия: <b>${fee.toLocaleString()} сум</b>\n` +
      `✅ К зачислению: <b>${credited.toLocaleString()} сум</b>`;

    for (const adminId of ADMIN_IDS) {
      try {
        await ctx.telegram.sendPhoto(adminId, photo, {
          caption,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Подтвердить', `approve_topup_${ctx.from.id}_${credited}_${fee}`),
              Markup.button.callback('❌ Отклонить', `reject_topup_${ctx.from.id}`),
            ],
          ]),
        });
      } catch {}
    }

    await ctx.reply(
      `✅ Чек отправлен администратору.\n\n` +
      `💰 Оплата: ${amount.toLocaleString()} сум\n` +
      `📉 Комиссия: ${fee.toLocaleString()} сум\n` +
      `✅ После подтверждения будет зачислено: <b>${credited.toLocaleString()} сум</b>`,
      { parse_mode: 'HTML', ...backToMain() }
    );
    await ctx.scene.leave();
  });

  return scene;
}

async function approveTopup(ctx, targetUserId, credited, fee) {
  const updated = await User.findOneAndUpdate(
    { telegramId: targetUserId },
    { $inc: { balance: credited, totalFeeCollected: fee } },
    { upsert: true, new: true }
  );
  try {
    await ctx.telegram.sendMessage(
      targetUserId,
      `✅ Баланс пополнен!\n\n` +
      `➕ Зачислено: <b>${credited.toLocaleString()} сум</b>\n` +
      `📉 Комиссия (удержана): <b>${fee.toLocaleString()} сум</b>\n` +
      `👛 Текущий баланс: <b>${updated.balance.toLocaleString()} сум</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('Ошибка отправки сообщения пользователю:', e.message);
  }
  return updated;
}

async function creditStarsPayment(ctx, telegramId, amountUZS, starsCount) {
  await User.findOneAndUpdate(
    { telegramId },
    { $inc: { balance: amountUZS } },
    { upsert: true }
  );
  await ctx.reply(
    `✅ <b>Оплата прошла успешно!</b>\n\n` +
    `⭐ Оплачено: <b>${starsCount} Stars</b>\n` +
    `➕ Зачислено на баланс: <b>${amountUZS.toLocaleString()} сум</b>`,
    { parse_mode: 'HTML', ...backToMain() }
  );
}

module.exports = { topupScene, showTopupMenu, approveTopup, calcFee, creditStarsPayment };
