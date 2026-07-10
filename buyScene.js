const { Markup } = require('telegraf');
const { User, Activation } = require('./models');
const { getSetting, calcPriceUSD, fmtUSD } = require('./settings');
const {
  getNumber,
  getStatus,
  setStatus,
  getNumberPrice,
  getCheapestForService,
  getCheapOffers,
  countryName,
  SERVICES,
  getPopularCountries,
  ERROR_MAP,
} = require('./herosms');
const {
  servicesKeyboard,
  countriesKeyboard,
  allCountriesKeyboard,
  confirmBuyKeyboard,
  cancelActivationKeyboard,
  backToMain,
  mainMenu,
  safeEdit,
} = require('./keyboards');

const FULL_COUNTRY_LIST_SERVICES = ['tg'];
const { isAdmin } = require('./admin');

const DIVIDER = '➖➖➖➖➖➖➖➖➖➖';

const activePolls = {};

const MAX_WAIT = 2 * 60 * 1000; // 2 минуты

function findService(code) {
  return SERVICES.find(s => s.code === code);
}
async function findCountry(countryCode) {
  const countries = await getPopularCountries(process.env.HEROSMS_API_KEY);
  return countries.find(c => c.code === countryCode);
}

function maskPhone(phone) {
  const str = String(phone);
  if (str.length <= 4) return str;
  const last4 = str.slice(-4);
  return '*'.repeat(str.length - 4) + last4;
}

async function postProofToChannel(ctx, { countryName, phoneNumber }) {
  const channel = await getSetting('proof_channel');
  if (!channel) return;

  const buyerName = ctx.from.username
    ? `@${ctx.from.username}`
    : (ctx.from.first_name || 'Пользователь');

  const text =
    `✅ <b>Новая покупка совершена!</b>\n${DIVIDER}\n` +
    `🌍 Страна: <b>${countryName}</b>\n` +
    `📱 Номер: <code>${maskPhone(phoneNumber)}</code>\n` +
    `👤 Покупатель: ${buyerName}`;

  try {
    await ctx.telegram.sendMessage(channel, text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🤖 Перейти в бот', `https://t.me/${ctx.botInfo.username}`)],
      ]),
    });
  } catch (e) {
    console.error('Ошибка отправки поста в канал доказательств:', e.message);
  }
}

const calcPrice = calcPriceUSD;

async function showServices(ctx) {
  const text =
    `📱 <b>Выберите сервис</b>\n${DIVIDER}\n` +
    `Нажмите на нужный сервис, затем выберите страну.\n\n` +
    `💡 Если не спешите — кнопка <b>🔥 Самые дешёвые предложения</b> покажет лучшие варианты сразу.`;
  if (ctx.callbackQuery) {
    await safeEdit(ctx, text, { parse_mode: 'HTML', ...servicesKeyboard() });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...servicesKeyboard() });
  }
}

async function handleServiceSelect(ctx, serviceCode) {
  await ctx.answerCbQuery();
  const svc = findService(serviceCode);
  if (!svc) return;

  if (FULL_COUNTRY_LIST_SERVICES.includes(serviceCode)) {
    try {
      await safeEdit(ctx,
        `${svc.name}\n${DIVIDER}\n⏳ Загружаем все страны и цены...`,
        { parse_mode: 'HTML' }
      );
    } catch {}

    const { keyboard, count, shown } = await allCountriesKeyboard(process.env.HEROSMS_API_KEY, serviceCode);

    if (!count) {
      return safeEdit(ctx,
        `📭 <b>Пока недоступно</b>\n${DIVIDER}\n` +
        `Для ${svc.name} нет номеров ни в одной стране. Попробуйте позже.`,
        { parse_mode: 'HTML', ...backToMain() }
      );
    }

    const note = shown < count ? `\n\n(Показаны ${shown} самых дешёвых из ${count} доступных)` : '';
    return safeEdit(ctx,
      `${svc.name}\n${DIVIDER}\n🌍 Выберите страну (${shown} доступно):\n\n` +
      `💰 Цена рядом с каждой страной указана в долларах.${note}`,
      { parse_mode: 'HTML', ...keyboard }
    );
  }

  const kb = await countriesKeyboard(process.env.HEROSMS_API_KEY, serviceCode);
  await safeEdit(ctx,
    `${svc.name}\n${DIVIDER}\n🌍 Выберите страну:\n\n` +
    `💡 Если не знаете, где дешевле — нажмите <b>«🔥 Выбрать самый дешёвый автоматически»</b>.`,
    { parse_mode: 'HTML', ...kb }
  );
}

async function renderCountryOffer(ctx, serviceCode, countryCode) {
  const svc = findService(serviceCode);
  const cnt = (await findCountry(countryCode)) || { code: countryCode, name: countryName(countryCode) };
  if (!svc) return;

  const { cost, count, ok } = await getNumberPrice(process.env.HEROSMS_API_KEY, serviceCode, countryCode);

  if (!ok) {
    return safeEdit(ctx,
      `⚠️ <b>Не удалось получить цену</b>\n${DIVIDER}\n` +
      `Сервер HeroSMS не ответил для ${svc.name} — ${cnt.name}.\n` +
      `Попробуйте позже.`,
      { parse_mode: 'HTML', ...(await countriesKeyboard(process.env.HEROSMS_API_KEY, serviceCode)) }
    );
  }

  if (count <= 0 || !(cost > 0)) {
    return safeEdit(ctx,
      `📭 <b>Номера закончились</b>\n${DIVIDER}\n` +
      `Для ${svc.name} — ${cnt.name} сейчас нет доступных номеров.\n` +
      `Выберите другую страну или воспользуйтесь «🔥 Выбрать самый дешёвый автоматически».`,
      { parse_mode: 'HTML', ...(await countriesKeyboard(process.env.HEROSMS_API_KEY, serviceCode)) }
    );
  }

  const priceUSD = await calcPrice(cost);

  const user = await User.findOne({ telegramId: ctx.from.id });
  const balance = user?.balance || 0;
  const enough = balance >= priceUSD;

  const text =
    `📋 <b>Информация о заказе</b>\n${DIVIDER}\n` +
    `🔧 Сервис: <b>${svc.name}</b>\n` +
    `🌍 Страна: <b>${cnt.name}</b>\n` +
    `💰 Цена: <b>${fmtUSD(priceUSD)}</b>\n` +
    `📦 Доступно номеров: <b>${count} шт.</b>\n${DIVIDER}\n` +
    `👛 Ваш баланс: <b>${fmtUSD(balance)}</b>\n\n` +
    (enough
      ? `✅ Баланса достаточно. Подтвердить?`
      : `❌ Недостаточно средств. Пожалуйста, пополните баланс.`);

  await safeEdit(ctx, text, {
    parse_mode: 'HTML',
    ...(enough ? confirmBuyKeyboard(serviceCode, countryCode) : backToMain()),
  });
}

async function handleCountrySelect(ctx, serviceCode, countryCode) {
  await ctx.answerCbQuery('⏳ Проверяем цену...');
  await renderCountryOffer(ctx, serviceCode, countryCode);
}

async function handleCheapestForService(ctx, serviceCode) {
  await ctx.answerCbQuery('⏳ Ищем самую дешёвую страну...');
  const svc = findService(serviceCode);
  if (!svc) return;

  const best = await getCheapestForService(process.env.HEROSMS_API_KEY, serviceCode);
  if (!best) {
    return safeEdit(ctx,
      `📭 <b>Пока недоступно</b>\n${DIVIDER}\n` +
      `Для ${svc.name} нет доступных номеров ни в одной стране. Попробуйте позже.`,
      { parse_mode: 'HTML', ...(await countriesKeyboard(process.env.HEROSMS_API_KEY, serviceCode)) }
    );
  }

  await renderCountryOffer(ctx, serviceCode, best.countryCode);
}

async function showCheapNumbers(ctx) {
  await ctx.answerCbQuery('⏳ Поиск...');
  try {
    await safeEdit(ctx,
      `🔥 <b>Ищем самые дешёвые предложения...</b>\n\n⏳ Пожалуйста, подождите несколько секунд...`,
      { parse_mode: 'HTML' }
    );
  } catch {}

  const offers = await getCheapOffers(process.env.HEROSMS_API_KEY);

  if (!offers.length) {
    return safeEdit(ctx,
      `❌ <b>Предложения не найдены</b>\n${DIVIDER}\n` +
      `Возможно, временные проблемы на сервере HeroSMS. Попробуйте позже.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  }

  const top = offers.slice(0, 8);
  const rows = [];
  let text = `🔥 <b>Самые дешёвые номера</b> (ТОП-${top.length})\n${DIVIDER}\n\n`;

  for (const o of top) {
    const priceUSD = await calcPrice(o.cost);
    const cName = countryName(o.countryCode);
    text += `${o.service.name} — ${cName}\n💰 <b>${fmtUSD(priceUSD)}</b>  ·  📦 ${o.count} шт.\n\n`;
    rows.push([
      Markup.button.callback(
        `${o.service.name} — ${fmtUSD(priceUSD)}`,
        `cnt_${o.service.code}_${o.countryCode}`
      ),
    ]);
  }

  text += `💡 Нажмите на любое предложение, чтобы сразу купить.`;
  rows.push([Markup.button.callback('🔙 Главное меню', 'back_main')]);

  await safeEdit(ctx, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
}

async function handleConfirm(ctx, serviceCode, countryCode) {
  await ctx.answerCbQuery('⏳ Получаем номер...');

  const svc = findService(serviceCode);
  const cnt = (await findCountry(countryCode)) || { code: countryCode, name: countryName(countryCode) };
  const user = await User.findOne({ telegramId: ctx.from.id });

  const { cost, count, ok } = await getNumberPrice(process.env.HEROSMS_API_KEY, serviceCode, countryCode);

  if (!ok) {
    return safeEdit(ctx,
      `⚠️ Не удалось проверить цену. Попробуйте позже.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  }
  if (count <= 0 || !(cost > 0)) {
    return safeEdit(ctx,
      `📭 Номера закончились за это время. Выберите другую страну.`,
      { parse_mode: 'HTML', ...(await countriesKeyboard(process.env.HEROSMS_API_KEY, serviceCode)) }
    );
  }

  const priceUSD = await calcPrice(cost);

  if ((user?.balance || 0) < priceUSD) {
    return safeEdit(ctx, '❌ Недостаточно средств!', { parse_mode: 'HTML', ...backToMain() });
  }

  let numData;
  try {
    numData = await getNumber(process.env.HEROSMS_API_KEY, serviceCode, countryCode);
  } catch (e) {
    const errText = ERROR_MAP[e.message] || ('❌ Ошибка: ' + e.message);
    return safeEdit(ctx, errText, backToMain());
  }

  await User.updateOne(
    { telegramId: ctx.from.id },
    { $inc: { balance: -priceUSD, totalSpent: priceUSD } }
  );

  await Activation.create({
    telegramId: ctx.from.id,
    activationId: numData.activationId,
    service: serviceCode,
    country: countryCode,
    phoneNumber: numData.phoneNumber,
    pricePaid: priceUSD,
    status: 'pending',
  });

  await safeEdit(ctx,
    `✅ <b>Номер получен!</b>\n${DIVIDER}\n` +
    `📱 Номер: <code>+${numData.phoneNumber}</code>\n` +
    `🔧 Сервис: <b>${svc.name}</b>\n` +
    `🌍 Страна: <b>${cnt.name}</b>\n` +
    `💰 Оплачено: <b>${fmtUSD(priceUSD)}</b>\n${DIVIDER}\n` +
    `⏳ Ожидаем SMS (до ${Math.round(MAX_WAIT / 60000)} минут)...`,
    { parse_mode: 'HTML', ...cancelActivationKeyboard(numData.activationId) }
  );

  postProofToChannel(ctx, { countryName: cnt.name, phoneNumber: numData.phoneNumber });

  pollForCode(ctx, numData.activationId, ctx.from.id);
}

function pollForCode(ctx, activationId, telegramId) {
  const startTime = Date.now();

  const check = async () => {
    if (Date.now() - startTime > MAX_WAIT) {
      await refundIfExpired(activationId, telegramId, ctx.telegram);
      delete activePolls[telegramId];
      return;
    }

    try {
      const status = await getStatus(process.env.HEROSMS_API_KEY, activationId);

      if (typeof status === 'string' && status.startsWith('STATUS_OK:')) {
        const code = status.split(':')[1];
        await setStatus(process.env.HEROSMS_API_KEY, activationId, 6);
        await Activation.updateOne({ activationId }, { status: 'success', code });
        await ctx.telegram.sendMessage(
          telegramId,
          `📩 <b>SMS-код получен!</b>\n\n🔑 Код: <code>${code}</code>\n\n✅ Активация успешно завершена.`,
          { parse_mode: 'HTML', ...backToMain() }
        );
        delete activePolls[telegramId];
        return;
      }

      if (status === 'STATUS_CANCEL') {
        await Activation.updateOne({ activationId }, { status: 'cancelled' });
        await ctx.telegram.sendMessage(telegramId, '🚫 Активация отменена.', backToMain());
        delete activePolls[telegramId];
        return;
      }

      activePolls[telegramId] = setTimeout(check, 5000);
    } catch {
      activePolls[telegramId] = setTimeout(check, 5000);
    }
  };

  activePolls[telegramId] = setTimeout(check, 3000);
}

async function refundIfExpired(activationId, telegramId, telegram) {
  const activation = await Activation.findOneAndUpdate(
    { activationId, status: 'pending' },
    { status: 'timeout' }
  );
  if (!activation) return;

  try {
    await setStatus(process.env.HEROSMS_API_KEY, activationId, 8);
  } catch {}

  await User.updateOne(
    { telegramId },
    { $inc: { balance: activation.pricePaid, totalSpent: -activation.pricePaid } }
  );

  try {
    await telegram.sendMessage(
      telegramId,
      `⏰ <b>Время истекло (${Math.round(MAX_WAIT / 60000)} мин.)</b>\n${DIVIDER}\n` +
      `📵 SMS на номер не пришла.\n` +
      `💰 <b>${fmtUSD(activation.pricePaid)}</b> возвращено на ваш баланс.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  } catch {}
}

const WATCHDOG_INTERVAL = 20 * 1000;

function startExpiryWatchdog(bot) {
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - MAX_WAIT);
      const expired = await Activation.find({ status: 'pending', createdAt: { $lte: cutoff } }).lean();
      for (const act of expired) {
        await refundIfExpired(act.activationId, act.telegramId, bot.telegram);
      }
    } catch (e) {
      console.error('Ошибка сторожевого таймера:', e.message);
    }
  }, WATCHDOG_INTERVAL);
}

async function handleCancelActivation(ctx, activationId) {
  await ctx.answerCbQuery();
  try {
    await setStatus(process.env.HEROSMS_API_KEY, activationId, 8);
    const activation = await Activation.findOneAndUpdate(
      { activationId, status: 'pending' },
      { status: 'cancelled' }
    );
    if (activePolls[ctx.from.id]) {
      clearTimeout(activePolls[ctx.from.id]);
      delete activePolls[ctx.from.id];
    }

    let text = '🚫 Активация отменена.';
    if (activation) {
      await User.updateOne(
        { telegramId: ctx.from.id },
        { $inc: { balance: activation.pricePaid, totalSpent: -activation.pricePaid } }
      );
      text = `🚫 <b>Активация отменена</b>\n${DIVIDER}\n` +
        `💰 <b>${fmtUSD(activation.pricePaid)}</b> возвращено на ваш баланс.`;
    }

    await safeEdit(ctx, text, { parse_mode: 'HTML', ...backToMain() });
  } catch (e) {
    await safeEdit(ctx, '❌ Ошибка при отмене: ' + e.message, backToMain());
  }
}

module.exports = {
  showServices,
  handleServiceSelect,
  handleCountrySelect,
  handleCheapestForService,
  showCheapNumbers,
  handleConfirm,
  handleCancelActivation,
  startExpiryWatchdog,
};
