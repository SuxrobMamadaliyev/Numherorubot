const { Markup } = require('telegraf');
const { User, Activation } = require('./models');
const { getSetting } = require('./settings');
const {
  getNumber,
  getStatus,
  setStatus,
  getNumberPrice,
  getCheapestForService,
  getCheapOffers,
  countryName,
  SERVICES,
  COUNTRIES,
  ERROR_MAP,
} = require('./herosms');
const {
  servicesKeyboard,
  countriesKeyboard,
  confirmBuyKeyboard,
  cancelActivationKeyboard,
  backToMain,
  mainMenu,
} = require('./keyboards');
const { isAdmin } = require('./admin');

const DIVIDER = '➖➖➖➖➖➖➖➖➖➖';

// Faol polllar: telegramId -> timeout
const activePolls = {};

function findService(code) {
  return SERVICES.find(s => s.code === code);
}
function findCountry(code) {
  return COUNTRIES.find(c => c.code === code);
}

// Narx hisoblash: dollardagi narxni so'mga o'tkazib, markup qo'shish
async function calcPrice(costUSD) {
  const rate = await getSetting('usd_to_uzs');
  const markup = await getSetting('markup_percent');
  const base = costUSD * rate;
  const final = Math.ceil(base * (1 + markup / 100) / 100) * 100; // 100 so'mga yaxlitlash
  return final;
}

async function showServices(ctx) {
  const text =
    `📱 <b>Servisni tanlang</b>\n${DIVIDER}\n` +
    `Kerakli xizmatni bosing, keyin mamlakatni tanlaysiz.\n\n` +
    `💡 Shoshilmasangiz — pastdagi <b>🔥 Eng arzon takliflar</b> tugmasi orqali eng arzon variantlarni darhol koʻrishingiz mumkin.`;
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...servicesKeyboard() });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', ...servicesKeyboard() });
  }
}

async function handleServiceSelect(ctx, serviceCode) {
  await ctx.answerCbQuery();
  const svc = findService(serviceCode);
  if (!svc) return;
  await ctx.editMessageText(
    `${svc.name}\n${DIVIDER}\n🌍 Mamlakatni tanlang:\n\n` +
    `💡 Qaysi mamlakat arzonroqligini bilmasangiz — <b>"🔥 Eng arzonini avtomatik tanlash"</b> tugmasini bosing.`,
    { parse_mode: 'HTML', ...countriesKeyboard(serviceCode) }
  );
}

// Tanlangan servis/mamlakat uchun buyurtma xulosasini chiqaradi.
// Bu funksiya ctx.answerCbQuery() ni ICHIDA chaqirmaydi — buni chaqiruvchi oʻzi bajaradi
// (bir xabarga ikki marta answerCbQuery yuborilib qolmasligi uchun).
async function renderCountryOffer(ctx, serviceCode, countryCode) {
  const svc = findService(serviceCode);
  const cnt = findCountry(countryCode) || { code: countryCode, name: countryName(countryCode) };
  if (!svc) return;

  const { cost, count, ok } = await getNumberPrice(process.env.HEROSMS_API_KEY, serviceCode, countryCode);

  // Narx aniqlanmasa — foydalanuvchiga yolgʻon/tasodifiy narx koʻrsatmaymiz
  if (!ok) {
    return ctx.editMessageText(
      `⚠️ <b>Narxni aniqlab boʻlmadi</b>\n${DIVIDER}\n` +
      `${svc.name} — ${cnt.name} uchun HeroSMS serveridan javob olinmadi.\n` +
      `Birozdan keyin qaytadan urinib koʻring.`,
      { parse_mode: 'HTML', ...countriesKeyboard(serviceCode) }
    );
  }

  if (count <= 0 || !(cost > 0)) {
    return ctx.editMessageText(
      `📭 <b>Raqamlar tugagan</b>\n${DIVIDER}\n` +
      `${svc.name} — ${cnt.name} uchun hozircha mavjud raqam yoʻq.\n` +
      `Boshqa mamlakatni tanlang yoki "🔥 Eng arzonini avtomatik tanlash"dan foydalaning.`,
      { parse_mode: 'HTML', ...countriesKeyboard(serviceCode) }
    );
  }

  const priceUZS = await calcPrice(cost);

  const user = await User.findOne({ telegramId: ctx.from.id });
  const balance = user?.balance || 0;
  const enough = balance >= priceUZS;

  const text =
    `📋 <b>Buyurtma maʼlumotlari</b>\n${DIVIDER}\n` +
    `🔧 Servis: <b>${svc.name}</b>\n` +
    `🌍 Mamlakat: <b>${cnt.name}</b>\n` +
    `💰 Narx: <b>${priceUZS.toLocaleString()} so'm</b>\n` +
    `📦 Mavjud raqamlar: <b>${count} dona</b>\n${DIVIDER}\n` +
    `👛 Balansingiz: <b>${balance.toLocaleString()} so'm</b>\n\n` +
    (enough
      ? `✅ Balans yetarli. Tasdiqlaysizmi?`
      : `❌ Balans yetarli emas. Iltimos, avval balansni toʻldiring.`);

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    ...(enough ? confirmBuyKeyboard(serviceCode, countryCode) : backToMain()),
  });
}

async function handleCountrySelect(ctx, serviceCode, countryCode) {
  await ctx.answerCbQuery('⏳ Narx tekshirilmoqda...');
  await renderCountryOffer(ctx, serviceCode, countryCode);
}

// "Eng arzonini avtomatik tanlash" — servis uchun barcha mamlakatlar orasidan eng arzonini topib,
// toʻgʻridan-toʻgʻri buyurtma xulosasiga oʻtkazadi (foydalanuvchiga qulaylik uchun)
async function handleCheapestForService(ctx, serviceCode) {
  await ctx.answerCbQuery('⏳ Eng arzon mamlakat qidirilmoqda...');
  const svc = findService(serviceCode);
  if (!svc) return;

  const best = await getCheapestForService(process.env.HEROSMS_API_KEY, serviceCode);
  if (!best) {
    return ctx.editMessageText(
      `📭 <b>Hozircha mavjud emas</b>\n${DIVIDER}\n` +
      `${svc.name} uchun hech qaysi mamlakatda raqam topilmadi. Birozdan keyin urinib koʻring.`,
      { parse_mode: 'HTML', ...countriesKeyboard(serviceCode) }
    );
  }

  await renderCountryOffer(ctx, serviceCode, best.countryCode);
}

// "🔥 Arzon nomerlar" — barcha mashhur servislar boʻyicha eng arzon takliflar roʻyxati
async function showCheapNumbers(ctx) {
  await ctx.answerCbQuery('⏳ Qidirilmoqda...');
  try {
    await ctx.editMessageText(
      `🔥 <b>Eng arzon takliflar qidirilmoqda...</b>\n\n⏳ Iltimos, kuting (bir necha soniya)...`,
      { parse_mode: 'HTML' }
    );
  } catch {}

  const offers = await getCheapOffers(process.env.HEROSMS_API_KEY);

  if (!offers.length) {
    return ctx.editMessageText(
      `❌ <b>Hozircha takliflar topilmadi</b>\n${DIVIDER}\n` +
      `HeroSMS serverida vaqtinchalik nosozlik boʻlishi mumkin. Birozdan keyin qaytadan urinib koʻring.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  }

  const top = offers.slice(0, 8);
  const rows = [];
  let text = `🔥 <b>Eng arzon nomerlar</b> (TOP-${top.length})\n${DIVIDER}\n\n`;

  for (const o of top) {
    const priceUZS = await calcPrice(o.cost);
    const cName = countryName(o.countryCode);
    text += `${o.service.name} — ${cName}\n💰 <b>${priceUZS.toLocaleString()} so'm</b>  ·  📦 ${o.count} dona\n\n`;
    rows.push([
      Markup.button.callback(
        `${o.service.name} — ${priceUZS.toLocaleString()} so'm`,
        `cnt_${o.service.code}_${o.countryCode}`
      ),
    ]);
  }

  text += `💡 Har qanday taklifni bosib, darhol xarid qilishingiz mumkin.`;
  rows.push([Markup.button.callback('🔙 Bosh menyu', 'back_main')]);

  await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
}

async function handleConfirm(ctx, serviceCode, countryCode) {
  await ctx.answerCbQuery('⏳ Raqam olinmoqda...');

  const svc = findService(serviceCode);
  const cnt = findCountry(countryCode) || { code: countryCode, name: countryName(countryCode) };
  const user = await User.findOne({ telegramId: ctx.from.id });

  // Tasdiqlash bosilgunga qadar narx/mavjudlik oʻzgargan boʻlishi mumkin — qayta tekshiramiz
  const { cost, count, ok } = await getNumberPrice(process.env.HEROSMS_API_KEY, serviceCode, countryCode);

  if (!ok) {
    return ctx.editMessageText(
      `⚠️ Narxni tasdiqlab boʻlmadi. Birozdan keyin qaytadan urinib koʻring.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  }
  if (count <= 0 || !(cost > 0)) {
    return ctx.editMessageText(
      `📭 Afsuski, bu oraliqda raqamlar tugab qoldi. Boshqa mamlakatni tanlang.`,
      { parse_mode: 'HTML', ...countriesKeyboard(serviceCode) }
    );
  }

  const priceUZS = await calcPrice(cost);

  if ((user?.balance || 0) < priceUZS) {
    return ctx.editMessageText('❌ Balans yetarli emas!', { parse_mode: 'HTML', ...backToMain() });
  }

  let numData;
  try {
    numData = await getNumber(process.env.HEROSMS_API_KEY, serviceCode, countryCode);
  } catch (e) {
    const errText = ERROR_MAP[e.message] || ('❌ Xato: ' + e.message);
    return ctx.editMessageText(errText, backToMain());
  }

  // Balansdan ayirish
  await User.updateOne(
    { telegramId: ctx.from.id },
    { $inc: { balance: -priceUZS, totalSpent: priceUZS } }
  );

  // Aktivatsiyani saqlash
  await Activation.create({
    telegramId: ctx.from.id,
    activationId: numData.activationId,
    service: serviceCode,
    country: countryCode,
    phoneNumber: numData.phoneNumber,
    pricePaid: priceUZS,
    status: 'pending',
  });

  await ctx.editMessageText(
    `✅ <b>Raqam tayyor!</b>\n${DIVIDER}\n` +
    `📱 Raqam: <code>+${numData.phoneNumber}</code>\n` +
    `🔧 Servis: <b>${svc.name}</b>\n` +
    `🌍 Mamlakat: <b>${cnt.name}</b>\n` +
    `💰 To'landi: <b>${priceUZS.toLocaleString()} so'm</b>\n${DIVIDER}\n` +
    `⏳ SMS kutilmoqda (20 daqiqagacha)...`,
    { parse_mode: 'HTML', ...cancelActivationKeyboard(numData.activationId) }
  );

  // Polling boshlash
  pollForCode(ctx, numData.activationId, ctx.from.id);
}

function pollForCode(ctx, activationId, telegramId) {
  const startTime = Date.now();
  const MAX_WAIT = 20 * 60 * 1000;

  const check = async () => {
    if (Date.now() - startTime > MAX_WAIT) {
      await Activation.updateOne({ activationId }, { status: 'timeout' });
      await ctx.telegram.sendMessage(
        telegramId,
        '⏰ Vaqt tugadi (20 daqiqa). SMS kelmadi. Balans qaytarilmaydi (raqam band qilindi).',
        backToMain()
      );
      delete activePolls[telegramId];
      return;
    }

    try {
      const status = await getStatus(process.env.HEROSMS_API_KEY, activationId);

      if (typeof status === 'string' && status.startsWith('STATUS_OK:')) {
        const code = status.split(':')[1];
        await setStatus(process.env.HEROSMS_API_KEY, activationId, 6); // complete
        await Activation.updateOne({ activationId }, { status: 'success', code });
        await ctx.telegram.sendMessage(
          telegramId,
          `📩 <b>SMS kodi keldi!</b>\n\n🔑 Kod: <code>${code}</code>\n\n✅ Aktivatsiya muvaffaqiyatli yakunlandi.`,
          { parse_mode: 'HTML', ...backToMain() }
        );
        delete activePolls[telegramId];
        return;
      }

      if (status === 'STATUS_CANCEL') {
        await Activation.updateOne({ activationId }, { status: 'cancelled' });
        await ctx.telegram.sendMessage(telegramId, '🚫 Aktivatsiya bekor qilindi.', backToMain());
        delete activePolls[telegramId];
        return;
      }

      // STATUS_WAIT_CODE — davom etamiz
      activePolls[telegramId] = setTimeout(check, 5000);
    } catch {
      activePolls[telegramId] = setTimeout(check, 5000);
    }
  };

  activePolls[telegramId] = setTimeout(check, 3000);
}

async function handleCancelActivation(ctx, activationId) {
  await ctx.answerCbQuery();
  try {
    await setStatus(process.env.HEROSMS_API_KEY, activationId, 8); // cancel
    await Activation.updateOne({ activationId }, { status: 'cancelled' });
    if (activePolls[ctx.from.id]) {
      clearTimeout(activePolls[ctx.from.id]);
      delete activePolls[ctx.from.id];
    }
    await ctx.editMessageText('🚫 Aktivatsiya bekor qilindi.', backToMain());
  } catch (e) {
    await ctx.editMessageText('❌ Bekor qilishda xato: ' + e.message, backToMain());
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
};
