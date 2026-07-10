const { Markup } = require('telegraf');
const { SERVICES, getAllOffersForService, getPopularCountries } = require('./herosms');
const { getSetting, calcPriceUSD, fmtUSD } = require('./settings');

function mainMenu(isAdmin = false) {
  const rows = [
    [Markup.button.callback('🔥 Дешёвые номера', 'cheap_numbers')],
    [
      Markup.button.callback('📱 Купить номер', 'buy_number'),
      Markup.button.callback('👤 Кабинет', 'cabinet'),
    ],
    [
      Markup.button.callback('👛 Пополнить баланс', 'topup'),
      Markup.button.callback('❓ Помощь', 'help'),
    ],
  ];
  if (isAdmin) {
    rows.push([Markup.button.callback('⚙️ Админ панель', 'admin_panel')]);
  }
  return Markup.inlineKeyboard(rows);
}

function servicesKeyboard() {
  const buttons = SERVICES.map(s =>
    Markup.button.callback(s.name, `svc_${s.code}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([Markup.button.callback('🔥 Самые дешёвые предложения', 'cheap_numbers')]);
  rows.push([Markup.button.callback('🔙 Главное меню', 'back_main')]);
  return Markup.inlineKeyboard(rows);
}

async function countriesKeyboard(apiKey, serviceCode) {
  const countries = await getPopularCountries(apiKey);
  const buttons = countries.map(c =>
    Markup.button.callback(c.name, `cnt_${serviceCode}_${c.code}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([Markup.button.callback('🔥 Выбрать самый дешёвый автоматически', `cheapest_${serviceCode}`)]);
  rows.push([Markup.button.callback('🔙 Сервисы', 'buy_number')]);
  return Markup.inlineKeyboard(rows);
}

const MAX_COUNTRY_BUTTONS = 80;

async function allCountriesKeyboard(apiKey, serviceCode) {
  const offers = await getAllOffersForService(apiKey, serviceCode);
  const shown = offers.slice(0, MAX_COUNTRY_BUTTONS);

  const rows = [];
  for (const o of shown) {
    const priceUSD = await calcPriceUSD(o.cost);
    rows.push([
      Markup.button.callback(
        `${o.name} — ${fmtUSD(priceUSD)}`,
        `cnt_${serviceCode}_${o.code}`
      ),
    ]);
  }

  rows.push([Markup.button.callback('🔥 Выбрать самый дешёвый автоматически', `cheapest_${serviceCode}`)]);
  rows.push([Markup.button.callback('🔙 Сервисы', 'buy_number')]);
  return { keyboard: Markup.inlineKeyboard(rows), count: offers.length, shown: shown.length };
}

function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Наценка %', 'adm_markup'),
      Markup.button.callback('📉 Комиссия пополнения', 'adm_topupfee'),
    ],
    [
      Markup.button.callback('⭐ Курс Stars ($)', 'adm_starsrate'),
      Markup.button.callback('💳 Visa реквизиты', 'adm_visa'),
    ],
    [Markup.button.callback('📢 Обязательные каналы', 'adm_channel')],
    [Markup.button.callback('🎁 Реф. бонус', 'adm_refbonus')],
    [Markup.button.callback('🧾 Канал доказательств', 'adm_proofchannel')],
    [Markup.button.callback('🖼 Фото главного меню', 'adm_image')],
    [Markup.button.callback('👥 Балансы пользователей', 'adm_balances')],
    [Markup.button.callback('📣 Рассылка всем', 'adm_broadcast')],
    [Markup.button.callback('📊 Статистика', 'adm_stats')],
    [Markup.button.callback('🔙 Главное меню', 'back_main')],
  ]);
}

function balancesMenuKeyboard(page, totalPages) {
  const navRow = [];
  if (page > 0) navRow.push(Markup.button.callback('⬅️ Назад', `adm_balances_page_${page - 1}`));
  if (page < totalPages - 1) navRow.push(Markup.button.callback('Вперёд ➡️', `adm_balances_page_${page + 1}`));

  const rows = [];
  if (navRow.length) rows.push(navRow);
  rows.push([Markup.button.callback('🗑 Обнулить все балансы', 'adm_balances_reset_confirm')]);
  rows.push([Markup.button.callback('🔙 Админ панель', 'admin_panel')]);
  return Markup.inlineKeyboard(rows);
}

function balancesResetConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Да, обнулить всё', 'adm_balances_reset_do')],
    [Markup.button.callback('❌ Отмена', 'adm_balances')],
  ]);
}

function backToAdmin() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Админ панель', 'admin_panel')]]);
}

function backToMain() {
  return Markup.inlineKeyboard([[Markup.button.callback('🔙 Главное меню', 'back_main')]]);
}

function confirmBuyKeyboard(serviceCode, countryCode) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Подтвердить', `confirm_${serviceCode}_${countryCode}`)],
    [Markup.button.callback('❌ Отмена', 'back_main')],
  ]);
}

function cancelActivationKeyboard(activationId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚫 Отменить', `cancel_act_${activationId}`)],
  ]);
}

async function sendMainMenu(ctx, text, keyboard, { edit = false } = {}) {
  const image = await getSetting('main_menu_image');

  if (image) {
    if (edit && ctx.callbackQuery) {
      try {
        await ctx.editMessageMedia(
          { type: 'photo', media: image, caption: text, parse_mode: 'HTML' },
          keyboard
        );
        return;
      } catch (e) {
        try { await ctx.deleteMessage(); } catch {}
      }
    }
    try {
      await ctx.replyWithPhoto(image, { caption: text, parse_mode: 'HTML', ...keyboard });
      return;
    } catch (e) {
      console.error('Ошибка отправки фото главного меню:', e.message);
    }
  }

  if (edit && ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      return;
    } catch {}
  }
  await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

async function safeEdit(ctx, text, extra = {}) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (e) {
    try { await ctx.deleteMessage(); } catch {}
    return ctx.reply(text, extra);
  }
}

module.exports = {
  mainMenu,
  servicesKeyboard,
  countriesKeyboard,
  allCountriesKeyboard,
  adminPanelKeyboard,
  balancesMenuKeyboard,
  balancesResetConfirmKeyboard,
  backToAdmin,
  backToMain,
  confirmBuyKeyboard,
  cancelActivationKeyboard,
  sendMainMenu,
  safeEdit,
};
