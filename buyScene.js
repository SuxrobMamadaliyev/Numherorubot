const { Markup } = require('telegraf');
const { User, Activation } = require('./models');
const { getSetting, calcPriceUZS } = require('./settings');
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
  allCountriesKeyboard,
  confirmBuyKeyboard,
  cancelActivationKeyboard,
  backToMain,
  mainMenu,
  safeEdit,
} = require('./keyboards');

// Barcha davlatlar (API dan) koʻrsatiladigan servislar. Hozircha faqat Telegram ('tg').
const FULL_COUNTRY_LIST_SERVICES = ['tg'];
const { isAdmin } = require('./admin');

const DIVIDER = '➖➖➖➖➖➖➖➖➖➖';

// Faol polllar: telegramId -> timeout
const activePolls = {};

// SMS kutish vaqti (necha millisekunddan keyin avtomatik bekor qilib pul qaytariladi)
const MAX_WAIT = 2 * 60 * 1000; // 2 daqiqa

function findService(code) {
  return SERVICES.find(s => s.code === code);
}
function findCountry(code) {
  return COUNTRIES.find(c => c.code === code);
}

// Nomerni maxfiylash uchun oxirgi 4 ta raqamidan tashqarisini yulduzcha bilan yopadi
function maskPhone(phone) {
  const str = String(phone);
  if (str.length <= 4) return str;
  const last4 = str.slice(-4);
  return '*'.repeat(str.length - 4) + last4;
}

// Har bir muvaffaqiyatli xariddan keyin "isbot" kanaliga post tashlaydi
// (kanal sozlanmagan bo'lsa yoki bot admin bo'lmasa — indamay o'tkazib yuboradi)
async function postProofToChannel(ctx, { countryName, phoneNumber }) {
  const channel = await getSetting('proof_channel');
  if (!channel) return;

  const buyerName = ctx.from.username
    ? `@${ctx.from.username}`
    : (ctx.from.first_name || 'Foydalanuvchi');

  const text =
    `✅ <b>Yangi xarid amalga oshirildi!</b>\n${DIVIDER}\n` +
    `🌍 Davlat: <b>${countryName}</b>\n` +
    `📱 Nomer: <code>${maskPhone(phoneNumber)}</code>\n` +
    `👤 Xaridor: ${buyerName}`;

  try {
    await ctx.telegram.sendMessage(channel, text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🤖 Botga oʻtish', `https://t.me/${ctx.botInfo.username}`)],
      ]),
    });
  } catch (e) {
    console.error('Isbot kanaliga post yuborishda xato:', e.message);
  }
}

// Narx hisoblash: dollardagi narxni so'mga o'tkazib, markup qo'shish
const calcPrice = calcPriceUZS;

async function showServices(ctx) {
  const text =
    `📱 <b>Servisni tanlang</b>\n${DIVIDER}\n` +
    `Kerakli xizmatni bosing, keyin mamlakatni tanlaysiz.\n\n` +
    `💡 Shoshilmasangiz — pastdagi <b>🔥 Eng arzon takliflar</b> tugmasi orqali eng arzon variantlarni darhol koʻrishingiz mumkin.`;
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

  // Ba'zi servislar (masalan Telegram) uchun HeroSMS APIdagi BARCHA mavjud
  // davlatlarni, har birining narxi (so'mda) bilan birga koʻrsatamiz.
  if (FULL_COUNTRY_LIST_SERVICES.includes(serviceCode)) {
    try {
      await safeEdit(ctx,
        `${svc.name}\n${DIVIDER}\n⏳ Barcha mamlakatlar va narxlar yuklanmoqda...`,
        { parse_mode: 'HTML' }
      );
    } catch {}

    const { keyboard, count, shown } = await allCountriesKeyboard(process.env.HEROSMS_API_KEY, serviceCode);

    if (!count) {
      return safeEdit(ctx,
        `📭 <b>Hozircha mavjud emas</b>\n${DIVIDER}\n` +
        `${svc.name} uchun hech qaysi mamlakatda raqam topilmadi. Birozdan keyin urinib koʻring.`,
        { parse_mode: 'HTML', ...backToMain() }
      );
    }

    const note = shown < count ? `\n\n(Eng arzon ${shown} ta koʻrsatilmoqda, jami mavjud: ${count} ta)` : '';
    return safeEdit(ctx,
      `${svc.name}\n${DIVIDER}\n🌍 Mamlakatni tanlang (${shown} ta mavjud):\n\n` +
      `💰 Narx har bir davlat yonida so'mda koʻrsatilgan.${note}`,
      { parse_mode: 'HTML', ...keyboard }
    );
  }

  await safeEdit(ctx, 
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
    return safeEdit(ctx, 
      `⚠️ <b>Narxni aniqlab boʻlmadi</b>\n${DIVIDER}\n` +
      `${svc.name} — ${cnt.name} uchun HeroSMS serveridan javob olinmadi.\n` +
      `Birozdan keyin qaytadan urinib koʻring.`,
      { parse_mode: 'HTML', ...countriesKeyboard(serviceCode) }
    );
  }

  if (count <= 0 || !(cost > 0)) {
    return safeEdit(ctx, 
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

  await safeEdit(ctx, text, {
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
    return safeEdit(ctx, 
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
    await safeEdit(ctx, 
      `🔥 <b>Eng arzon takliflar qidirilmoqda...</b>\n\n⏳ Iltimos, kuting (bir necha soniya)...`,
      { parse_mode: 'HTML' }
    );
  } catch {}

  const offers = await getCheapOffers(process.env.HEROSMS_API_KEY);

  if (!offers.length) {
    return safeEdit(ctx, 
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

  await safeEdit(ctx, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
}

async function handleConfirm(ctx, serviceCode, countryCode) {
  await ctx.answerCbQuery('⏳ Raqam olinmoqda...');

  const svc = findService(serviceCode);
  const cnt = findCountry(countryCode) || { code: countryCode, name: countryName(countryCode) };
  const user = await User.findOne({ telegramId: ctx.from.id });

  // Tasdiqlash bosilgunga qadar narx/mavjudlik oʻzgargan boʻlishi mumkin — qayta tekshiramiz
  const { cost, count, ok } = await getNumberPrice(process.env.HEROSMS_API_KEY, serviceCode, countryCode);

  if (!ok) {
    return safeEdit(ctx, 
      `⚠️ Narxni tasdiqlab boʻlmadi. Birozdan keyin qaytadan urinib koʻring.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  }
  if (count <= 0 || !(cost > 0)) {
    return safeEdit(ctx, 
      `📭 Afsuski, bu oraliqda raqamlar tugab qoldi. Boshqa mamlakatni tanlang.`,
      { parse_mode: 'HTML', ...countriesKeyboard(serviceCode) }
    );
  }

  const priceUZS = await calcPrice(cost);

  if ((user?.balance || 0) < priceUZS) {
    return safeEdit(ctx, '❌ Balans yetarli emas!', { parse_mode: 'HTML', ...backToMain() });
  }

  let numData;
  try {
    numData = await getNumber(process.env.HEROSMS_API_KEY, serviceCode, countryCode);
  } catch (e) {
    const errText = ERROR_MAP[e.message] || ('❌ Xato: ' + e.message);
    return safeEdit(ctx, errText, backToMain());
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

  await safeEdit(ctx, 
    `✅ <b>Raqam tayyor!</b>\n${DIVIDER}\n` +
    `📱 Raqam: <code>+${numData.phoneNumber}</code>\n` +
    `🔧 Servis: <b>${svc.name}</b>\n` +
    `🌍 Mamlakat: <b>${cnt.name}</b>\n` +
    `💰 To'landi: <b>${priceUZS.toLocaleString()} so'm</b>\n${DIVIDER}\n` +
    `⏳ SMS kutilmoqda (${Math.round(MAX_WAIT / 60000)} daqiqagacha)...`,
    { parse_mode: 'HTML', ...cancelActivationKeyboard(numData.activationId) }
  );

  // Isbot kanaliga post (sozlangan bo'lsa)
  postProofToChannel(ctx, { countryName: cnt.name, phoneNumber: numData.phoneNumber });

  // Polling boshlash
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

// Pending aktivatsiyani atomik ravishda "timeout" ga o'tkazadi va pulni qaytaradi.
// findOneAndUpdate faqat hali "pending" bo'lgan hujjatni topsa ishlaydi — shu tufayli
// pollForCode va watchdog bir xil aktivatsiyani ikki marta qaytarib yubormaydi.
async function refundIfExpired(activationId, telegramId, telegram) {
  const activation = await Activation.findOneAndUpdate(
    { activationId, status: 'pending' },
    { status: 'timeout' }
  );
  if (!activation) return; // allaqachon yakunlangan/bekor qilingan/qaytarilgan

  try {
    await setStatus(process.env.HEROSMS_API_KEY, activationId, 8); // HeroSMS'da ham bekor qilamiz
  } catch {}

  await User.updateOne(
    { telegramId },
    { $inc: { balance: activation.pricePaid, totalSpent: -activation.pricePaid } }
  );

  try {
    await telegram.sendMessage(
      telegramId,
      `⏰ <b>Vaqt tugadi (${Math.round(MAX_WAIT / 60000)} daqiqa)</b>\n${DIVIDER}\n` +
      `📵 Nomerga SMS kelmadi.\n` +
      `💰 To'langan <b>${activation.pricePaid.toLocaleString()} so'm</b> hisobingizga qaytarildi.`,
      { parse_mode: 'HTML', ...backToMain() }
    );
  } catch {}
}

// Bot qayta ishga tushganda ham (Render uxlab qolishi / qayta deploy bo'lishi) hech qanday
// pending aktivatsiya "osilib qolmasligi" uchun DB'ni davriy tekshirib turadigan qo'riqchi.
// Bu setTimeout'larga bog'liq bo'lmagani uchun process qayta boshlansa ham ishlayveradi.
const WATCHDOG_INTERVAL = 20 * 1000; // 20 soniyada bir tekshiradi

function startExpiryWatchdog(bot) {
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - MAX_WAIT);
      const expired = await Activation.find({ status: 'pending', createdAt: { $lte: cutoff } }).lean();
      for (const act of expired) {
        await refundIfExpired(act.activationId, act.telegramId, bot.telegram);
      }
    } catch (e) {
      console.error('Watchdog xatosi:', e.message);
    }
  }, WATCHDOG_INTERVAL);
}

async function handleCancelActivation(ctx, activationId) {
  await ctx.answerCbQuery();
  try {
    await setStatus(process.env.HEROSMS_API_KEY, activationId, 8); // cancel
    // Atomik: faqat hali "pending" bo'lsa "cancelled" ga o'tkazamiz va pulni qaytaramiz —
    // shu tufayli watchdog/poll bilan bir vaqtga to'g'ri kelib ikki marta qaytarib yuborilmaydi.
    const activation = await Activation.findOneAndUpdate(
      { activationId, status: 'pending' },
      { status: 'cancelled' }
    );
    if (activePolls[ctx.from.id]) {
      clearTimeout(activePolls[ctx.from.id]);
      delete activePolls[ctx.from.id];
    }

    let text = '🚫 Aktivatsiya bekor qilindi.';
    if (activation) {
      await User.updateOne(
        { telegramId: ctx.from.id },
        { $inc: { balance: activation.pricePaid, totalSpent: -activation.pricePaid } }
      );
      text = `🚫 <b>Aktivatsiya bekor qilindi</b>\n${DIVIDER}\n` +
        `💰 To'langan <b>${activation.pricePaid.toLocaleString()} so'm</b> hisobingizga qaytarildi.`;
    }

    await safeEdit(ctx, text, { parse_mode: 'HTML', ...backToMain() });
  } catch (e) {
    await safeEdit(ctx, '❌ Bekor qilishda xato: ' + e.message, backToMain());
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
