
# Yangi, to'liq o'zgartirilgan index.js - eski /start matnini o'zgartirish, balans so'mda

code = r'''/**
 * SMM Hero SMS Bot
 * 
 * Xususiyatlar:
 * - /start da yangilangan salomlashish
 * - Balans so'mda ko'rsatiladi
 * - Inline tugmalar orqali raqam sotib olish
 * - MongoDB + Render server
 * 
 * .env:
 *   BOT_TOKEN=...
 *   HEROSMS_API_KEY=...
 *   ADMIN_IDS=123456789
 *   MONGODB_URI=...
 *   USD_RATE=12650
 *   PROFIT_PERCENT=30
 *   PORT=3000
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const mongoose = require('mongoose');
const express = require('express');

// ========== SOZLAMALAR ==========
const BOT_TOKEN = process.env.BOT_TOKEN;
const API_KEY = process.env.HEROSMS_API_KEY;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
const MONGODB_URI = process.env.MONGODB_URI;
const USD_RATE = parseFloat(process.env.USD_RATE) || 12650;
const PROFIT_PERCENT = parseFloat(process.env.PROFIT_PERCENT) || 30;
const PORT = process.env.PORT || 3000;

const API_URL = 'https://hero-sms.com/stubs/handler_api.php';

if (!BOT_TOKEN || !API_KEY || !MONGODB_URI) {
  console.error('BOT_TOKEN, HEROSMS_API_KEY, MONGODB_URI .env da bo\'lishi shart!');
  process.exit(1);
}

// ========== EXPRESS SERVER (Render) ==========
const app = express();
app.get('/', (req, res) => res.send('SMM Hero Bot is running!'));
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.listen(PORT, () => console.log(`🌐 Server ${PORT} portda...`));

// ========== MONGODB ==========
const UserSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  balance: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  ordersCount: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
  activationId: { type: String, required: true, unique: true },
  userId: { type: Number, required: true },
  service: String,
  serviceName: String,
  country: String,
  countryName: String,
  phoneNumber: String,
  price: Number,
  status: { type: String, default: 'active' },
  code: String,
  createdAt: { type: Date, default: Date.now }
});

const PaymentSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  amount: Number,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);
const Payment = mongoose.model('Payment', PaymentSchema);

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000
}).then(() => console.log('✅ MongoDB ulanish muvaffaqiyatli!'))
  .catch(err => { console.error('❌ MongoDB xatolik:', err.message); process.exit(1); });

// ========== BOT ==========
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const userState = {};

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId.toString());
}

function formatSum(amount) {
  return amount.toLocaleString('uz-UZ') + ' so\'m';
}

function calculatePrice(usdCost) {
  const withProfit = usdCost * (1 + PROFIT_PERCENT / 100);
  return Math.ceil(withProfit * USD_RATE / 500) * 500;
}

// ========== HERO SMS API ==========
async function apiRequest(params) {
  const res = await axios.get(API_URL, {
    params: { api_key: API_KEY, ...params },
    timeout: 15000,
  });
  return res.data;
}

async function getBalance() {
  const data = await apiRequest({ action: 'getBalance' });
  if (typeof data === 'string' && data.startsWith('ACCESS_BALANCE:')) {
    return parseFloat(data.split(':')[1]);
  }
  throw new Error(data);
}

async function getServicesList() {
  const data = await apiRequest({ action: 'getServicesList' });
  return data.services || data;
}

async function getCountries() {
  const data = await apiRequest({ action: 'getCountries' });
  return data;
}

async function getPrices(service, country) {
  const data = await apiRequest({ action: 'getPrices', service, country });
  return data;
}

async function getNumber(service, country) {
  const data = await apiRequest({ action: 'getNumber', service, country });
  if (typeof data === 'string' && data.startsWith('ACCESS_NUMBER:')) {
    const [, id, phone] = data.split(':');
    return { activationId: id, phoneNumber: phone };
  }
  throw new Error(data);
}

async function getStatus(activationId) {
  return apiRequest({ action: 'getStatus', id: activationId });
}

async function setStatus(activationId, status) {
  return apiRequest({ action: 'setStatus', id: activationId, status });
}

// ========== KESH ==========
let cachedServices = null;
let cachedCountries = null;
let cacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function loadServicesAndCountries() {
  const now = Date.now();
  if (cachedServices && cachedCountries && (now - cacheTime < CACHE_DURATION)) {
    return { services: cachedServices, countries: cachedCountries };
  }
  try {
    const [servicesData, countriesData] = await Promise.all([
      getServicesList(),
      getCountries()
    ]);
    cachedServices = servicesData;
    cachedCountries = countriesData;
    cacheTime = now;
    return { services: cachedServices, countries: cachedCountries };
  } catch (e) {
    return { services: cachedServices || [], countries: cachedCountries || {} };
  }
}

// ========== FOYDALANUVCHI ==========
async function getOrCreateUser(msg) {
  let user = await User.findOne({ chatId: msg.chat.id });
  if (!user) {
    user = new User({
      chatId: msg.chat.id,
      username: msg.from?.username,
      firstName: msg.from?.first_name
    });
    await user.save();
  }
  return user;
}

// ========== ASOSIY MENYU ==========
async function getMainKeyboard(chatId) {
  const isAdminUser = isAdmin(chatId);
  const buttons = [
    [{ text: '📱 Raqam sotib olish', callback_data: 'buy_menu' }],
    [{ text: '💰 Hisobim', callback_data: 'my_balance' }, { text: '💳 To\'ldirish', callback_data: 'deposit' }],
    [{ text: '📋 Buyurtmalarim', callback_data: 'my_orders' }]
  ];
  if (isAdminUser) {
    buttons.push([{ text: '🔧 Admin Panel', callback_data: 'admin_panel' }]);
  }
  return { inline_keyboard: buttons };
}

// ========== SERVISLAR INLINE ==========
async function getServicesKeyboard() {
  const { services } = await loadServicesAndCountries();
  const buttons = [];
  for (let i = 0; i < services.length; i += 2) {
    const row = [];
    const s1 = services[i];
    row.push({ text: s1.name, callback_data: `service_${s1.code}` });
    if (services[i + 1]) {
      const s2 = services[i + 1];
      row.push({ text: s2.name, callback_data: `service_${s2.code}` });
    }
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Orqaga', callback_data: 'main_menu' }]);
  return { inline_keyboard: buttons };
}

// ========== DAVLATLAR INLINE ==========
async function getCountriesKeyboard(service) {
  const { countries, services } = await loadServicesAndCountries();
  const serviceInfo = services.find(s => s.code === service);
  const countryEntries = Object.entries(countries)
    .filter(([_, c]) => c.visible !== 0)
    .sort((a, b) => a[1].eng.localeCompare(b[1].eng));

  const buttons = [];
  for (let i = 0; i < countryEntries.length; i += 2) {
    const row = [];
    const c1 = countryEntries[i];
    row.push({ text: c1[1].eng, callback_data: `country_${service}_${c1[0]}` });
    if (countryEntries[i + 1]) {
      const c2 = countryEntries[i + 1];
      row.push({ text: c2[1].eng, callback_data: `country_${service}_${c2[0]}` });
    }
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Orqaga', callback_data: 'buy_menu' }]);
  return { inline_keyboard: buttons };
}

// ========== NARX KO'RSATISH ==========
async function showPriceAndConfirm(chatId, messageId, service, country) {
  try {
    const { services, countries } = await loadServicesAndCountries();
    const serviceInfo = services.find(s => s.code === service);
    const countryInfo = countries[country];

    const prices = await getPrices(service, country);
    let apiCostUSD = 0.5;
    let availableCount = 0;

    if (prices && prices[country] && prices[country][service]) {
      apiCostUSD = parseFloat(prices[country][service].cost) || 0.5;
      availableCount = prices[country][service].count || 0;
    }

    const sumPrice = calculatePrice(apiCostUSD);
    const user = await User.findOne({ chatId });

    const text = `📱 *${serviceInfo?.name || service}* — ${countryInfo?.eng || country}\n\n` +
      `💰 Narxi: *${formatSum(sumPrice)}*\n` +
      `📦 Mavjud raqamlar: ${availableCount > 0 ? availableCount : 'Mavjud'}\n` +
      `💳 Hisobingiz: ${formatSum(user?.balance || 0)}\n\n` +
      `Raqam sotib olishni xohlaysizmi?`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ Sotib olish', callback_data: `confirm_${service}_${country}_${sumPrice}_${apiCostUSD}` }],
        [{ text: '🔙 Orqaga', callback_data: `service_${service}` }]
      ]
    };

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } catch (e) {
    bot.editMessageText(`❌ Xatolik: ${e.message}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: '🔙 Orqaga', callback_data: 'buy_menu' }]] }
    });
  }
}

// ========== RAQAM SOTIB OLISH ==========
async function buyNumber(chatId, messageId, service, country, price, apiCostUSD) {
  const user = await User.findOne({ chatId });

  if (!user || user.balance < price) {
    bot.editMessageText(
      `❌ *Balans yetarli emas!*\n\n` +
      `💰 Kerak: ${formatSum(price)}\n` +
      `💳 Hisobingiz: ${formatSum(user?.balance || 0)}\n\n` +
      `Hisobingizni to'ldiring:`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '💳 To\'ldirish', callback_data: 'deposit' }]] }
      }
    );
    return;
  }

  try {
    bot.editMessageText('⏳ Raqam izlanmoqda...', { chat_id: chatId, message_id: messageId });

    const { activationId, phoneNumber } = await getNumber(service, country);
    const { services, countries } = await loadServicesAndCountries();
    const serviceInfo = services.find(s => s.code === service);
    const countryInfo = countries[country];

    user.balance -= price;
    user.totalSpent += price;
    user.ordersCount += 1;
    await user.save();

    const order = new Order({
      activationId,
      userId: chatId,
      service,
      serviceName: serviceInfo?.name || service,
      country,
      countryName: countryInfo?.eng || country,
      phoneNumber,
      price,
      status: 'active'
    });
    await order.save();

    userState[chatId] = {
      activationId,
      phoneNumber,
      service,
      country,
      price,
      messageId,
      startTime: Date.now()
    };

    bot.editMessageText(
      `✅ *Raqam topildi!*\n\n` +
      `📱 Servis: ${serviceInfo?.name || service}\n` +
      `🌍 Davlat: ${countryInfo?.eng || country}\n` +
      `📞 Raqam: \`+${phoneNumber}\`\n` +
      `🆔 ID: \`${activationId}\`\n` +
      `💰 Yechilgan: ${formatSum(price)}\n\n` +
      `⏳ SMS kodini kutamiz (20 daqiqa)...`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🚫 Bekor qilish', callback_data: `cancel_${activationId}` }]]
        }
      }
    );

    pollForCode(chatId, activationId);

  } catch (e) {
    const errMap = {
      NO_NUMBERS: 'Bu servis/davlat uchun raqamlar tugagan.',
      NO_BALANCE: 'API balans yetarli emas. Admin bilan bog\'laning.',
      BAD_SERVICE: 'Servis kodi noto\'g\'ri.',
      BAD_KEY: 'API kalit noto\'g\'ri.'
    };
    bot.editMessageText(`❌ Xatolik: ${errMap[e.message] || e.message}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: '🔙 Orqaga', callback_data: 'buy_menu' }]] }
    });
  }
}

// ========== SMS KODINI KUTISH ==========
function pollForCode(chatId, activationId) {
  const MAX_WAIT = 20 * 60 * 1000;
  const startTime = Date.now();

  const check = async () => {
    const state = userState[chatId];
    if (!state || state.activationId !== activationId) return;

    if (Date.now() - startTime > MAX_WAIT) {
      await bot.sendMessage(chatId, '⏰ *Vaqt tugadi!* SMS kelmadi. Mablag\' qaytarildi.', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Asosiy menyu', callback_data: 'main_menu' }]] }
      });
      delete userState[chatId];

      const order = await Order.findOne({ activationId });
      if (order) {
        order.status = 'timeout';
        await order.save();
        const user = await User.findOne({ chatId });
        if (user) { user.balance += order.price; await user.save(); }
      }
      return;
    }

    try {
      const status = await getStatus(activationId);

      if (status.startsWith('STATUS_OK:')) {
        const code = status.split(':')[1];
        await bot.sendMessage(chatId, `📩 *SMS Kod keldi!*\n\n\`${code}\``, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '✅ Yakunlash', callback_data: `complete_${activationId}` }]]
          }
        });

        const order = await Order.findOne({ activationId });
        if (order) {
          order.status = 'completed';
          order.code = code;
          await order.save();
        }
        await setStatus(activationId, 6);
        delete userState[chatId];
        return;
      }

      if (status === 'STATUS_CANCEL') {
        await bot.sendMessage(chatId, '🚫 *Faollashtirish bekor qilingan.*', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Asosiy menyu', callback_data: 'main_menu' }]] }
        });
        delete userState[chatId];

        const order = await Order.findOne({ activationId });
        if (order) { order.status = 'cancelled'; await order.save(); }
        return;
      }

      setTimeout(check, 5000);
    } catch (e) {
      setTimeout(check, 5000);
    }
  };

  check();
}

// ========== /start HANDLER ==========
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await getOrCreateUser(msg);
  const user = await User.findOne({ chatId });

  bot.sendMessage(
    chatId,
    `👋 *Salom!*\n\n` +
    `📱 Bu bot orqali HeroSMS dan vaqtinchalik raqam sotib olishingiz mumkin.\n\n` +
    `💰 *Narxlar so\'mda ko\'rsatiladi.*\n` +
    `⏳ SMS kodini 20 daqiqa ichida qabul qilasiz.\n\n` +
    `💳 Hisobingiz: *${formatSum(user?.balance || 0)}*\n\n` +
    `Quyidagi tugmalardan foydalaning:`,
    {
      parse_mode: 'Markdown',
      reply_markup: await getMainKeyboard(chatId)
    }
  );
});

// ========== CALLBACK HANDLER ==========
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const userId = query.from.id;

  await bot.answerCallbackQuery(query.id);

  // Asosiy menyu
  if (data === 'main_menu') {
    const user = await User.findOne({ chatId });
    bot.editMessageText(
      `🏠 *Asosiy menyu*\n\n` +
      `💳 Hisobingiz: *${formatSum(user?.balance || 0)}*\n\n` +
      `Quyidagi tugmalardan foydalaning:`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: await getMainKeyboard(chatId)
      }
    );
    return;
  }

  // Hisobim
  if (data === 'my_balance') {
    const user = await User.findOne({ chatId });
    const activeOrders = await Order.countDocuments({ userId: chatId, status: 'active' });

    bot.editMessageText(
      `💰 *Mening hisobim*\n\n` +
      `💳 Balans: *${formatSum(user?.balance || 0)}*\n` +
      `📦 Jami buyurtmalar: ${user?.ordersCount || 0}\n` +
      `🔄 Faol buyurtmalar: ${activeOrders}\n` +
      `💸 Jami sarflangan: ${formatSum(user?.totalSpent || 0)}\n\n` +
      `_Hisobingizni to'ldirish uchun "To'ldirish" tugmasini bosing._`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 To\'ldirish', callback_data: 'deposit' }],
            [{ text: '🔙 Orqaga', callback_data: 'main_menu' }]
          ]
        }
      }
    );
    return;
  }

  // To'ldirish
  if (data === 'deposit') {
    bot.editMessageText(
      `💳 *Hisobni to'ldirish*\n\n` +
      `To'lov usulini tanlang:\n\n` +
      `1. *Click* — +99890XXXXXXX\n` +
      `2. *Payme* — +99890XXXXXXX\n` +
      `3. *Kripto* — USDT TRC20\n\n` +
      `To'lovni amalga oshirgach, chekni yuboring. Admin tekshirib, hisobingizni to'ldiradi.`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Chek yuborish', callback_data: 'deposit_submit' }],
            [{ text: '🔙 Orqaga', callback_data: 'my_balance' }]
          ]
        }
      }
    );
    return;
  }

  // Chek yuborish
  if (data === 'deposit_submit') {
    userState[chatId] = { action: 'waiting_deposit_amount' };
    bot.editMessageText(
      `💳 *Hisobni to'ldirish*\n\n` +
      `Iltimos, to'lov summasini so'mda kiriting:\n` +
      `(masalan: 50000)`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Bekor qilish', callback_data: 'deposit' }]] }
      }
    );
    return;
  }

  // Buyurtmalarim
  if (data === 'my_orders') {
    const orders = await Order.find({ userId: chatId }).sort({ createdAt: -1 }).limit(10);

    if (orders.length === 0) {
      bot.editMessageText('📭 *Sizda hali buyurtmalar yo\'q.*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Orqaga', callback_data: 'main_menu' }]] }
      });
      return;
    }

    let text = '📋 *Sizning buyurtmalaringiz:*\n\n';
    orders.forEach((o, i) => {
      const statusEmoji = o.status === 'completed' ? '✅' : o.status === 'active' ? '⏳' : o.status === 'cancelled' ? '🚫' : '⏰';
      text += `${i + 1}. ${statusEmoji} ${o.serviceName} — ${o.countryName}\n`;
      text += `   📞 +${o.phoneNumber}\n`;
      text += `   💰 ${formatSum(o.price)}\n`;
      if (o.code) text += `   🔑 Kod: \`${o.code}\`\n`;
      text += '\n';
    });

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Orqaga', callback_data: 'main_menu' }]] }
    });
    return;
  }

  // Sotib olish menyusi
  if (data === 'buy_menu') {
    bot.editMessageText(
      '📱 *Servisni tanlang:*\n\nQaysi ilova uchun raqam kerak?',
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: await getServicesKeyboard()
      }
    );
    return;
  }

  // Servis tanlash
  if (data.startsWith('service_')) {
    const service = data.replace('service_', '');
    const { services } = await loadServicesAndCountries();
    const serviceInfo = services.find(s => s.code === service);

    bot.editMessageText(
      `🌍 *Davlatni tanlang:*\n\n${serviceInfo?.name || service} uchun qaysi davlatdan raqam olmoqchisiz?`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: await getCountriesKeyboard(service)
      }
    );
    return;
  }

  // Davlat tanlash
  if (data.startsWith('country_')) {
    const parts = data.split('_');
    const service = parts[1];
    const country = parts[2];
    await showPriceAndConfirm(chatId, messageId, service, country);
    return;
  }

  // Tasdiqlash
  if (data.startsWith('confirm_')) {
    const parts = data.split('_');
    const service = parts[1];
    const country = parts[2];
    const price = parseInt(parts[3]);
    const apiCostUSD = parseFloat(parts[4]);
    await buyNumber(chatId, messageId, service, country, price, apiCostUSD);
    return;
  }

  // Bekor qilish
  if (data.startsWith('cancel_')) {
    const activationId = data.replace('cancel_', '');
    try {
      await setStatus(activationId, 8);
      const order = await Order.findOne({ activationId });
      if (order) {
        order.status = 'cancelled';
        await order.save();
        const user = await User.findOne({ chatId });
        if (user) { user.balance += order.price; await user.save(); }
      }
      if (userState[chatId]) delete userState[chatId];

      bot.editMessageText('🚫 *Faollashtirish bekor qilindi. Mablag\' qaytarildi.*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Asosiy menyu', callback_data: 'main_menu' }]] }
      });
    } catch (e) {
      bot.sendMessage(chatId, `❌ Xatolik: ${e.message}`);
    }
    return;
  }

  // Yakunlash
  if (data.startsWith('complete_')) {
    const activationId = data.replace('complete_', '');
    try {
      await setStatus(activationId, 6);
      bot.editMessageText('✅ *Buyurtma yakunlandi!*', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Asosiy menyu', callback_data: 'main_menu' }]] }
      });
    } catch (e) {
      bot.sendMessage(chatId, `❌ Xatolik: ${e.message}`);
    }
    return;
  }

  // ========== ADMIN PANEL ==========
  if (!isAdmin(userId)) return;

  if (data === 'admin_panel') {
    bot.editMessageText('🔧 *Admin Panel*\n\nQuyidagi bo\'limlardan birini tanlang:', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getAdminKeyboard()
    });
    return;
  }

  if (data === 'admin_stats') {
    await showAdminStats(chatId, messageId);
    return;
  }

  if (data === 'admin_users') {
    await showAdminUsers(chatId, messageId, 0);
    return;
  }

  if (data === 'admin_orders') {
    await showAdminOrders(chatId, messageId, 0);
    return;
  }

  if (data === 'admin_payments') {
    await showAdminPayments(chatId, messageId);
    return;
  }

  if (data === 'admin_balance') {
    await showAdminBalance(chatId, messageId);
    return;
  }

  if (data === 'admin_settings') {
    await showAdminSettings(chatId, messageId);
    return;
  }

  if (data.startsWith('admin_approve_payment_')) {
    const paymentId = data.replace('admin_approve_payment_', '');
    await processPayment(chatId, messageId, paymentId, 'approved');
    return;
  }

  if (data.startsWith('admin_reject_payment_')) {
    const paymentId = data.replace('admin_reject_payment_', '');
    await processPayment(chatId, messageId, paymentId, 'rejected');
    return;
  }

  if (data.startsWith('admin_user_page_')) {
    const page = parseInt(data.replace('admin_user_page_', ''));
    await showAdminUsers(chatId, messageId, page);
    return;
  }

  if (data.startsWith('admin_order_page_')) {
    const page = parseInt(data.replace('admin_order_page_', ''));
    await showAdminOrders(chatId, messageId, page);
    return;
  }

  if (data === 'admin_refresh_prices') {
    cachedServices = null;
    cachedCountries = null;
    cacheTime = 0;
    bot.answerCallbackQuery(query.id, { text: '✅ Narxlar yangilandi!', show_alert: true });
    await showAdminSettings(chatId, messageId);
    return;
  }
});

// ========== ADMIN PANEL FUNKSIYALARI ==========

function getAdminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Statistika', callback_data: 'admin_stats' }],
      [{ text: '👥 Foydalanuvchilar', callback_data: 'admin_users' }],
      [{ text: '📋 Buyurtmalar', callback_data: 'admin_orders' }],
      [{ text: '💳 To\'lovlar', callback_data: 'admin_payments' }],
      [{ text: '💰 API Balans', callback_data: 'admin_balance' }],
      [{ text: '⚙️ Sozlamalar', callback_data: 'admin_settings' }],
      [{ text: '🔙 Asosiy menyu', callback_data: 'main_menu' }]
    ]
  };
}

async function showAdminStats(chatId, messageId) {
  const usersCount = await User.countDocuments();
  const totalOrders = await Order.countDocuments();
  const activeOrders = await Order.countDocuments({ status: 'active' });
  const completedOrders = await Order.countDocuments({ status: 'completed' });

  const revenue = await Order.aggregate([{ $group: { _id: null, total: { $sum: '$price' } } }]);
  const totalDeposits = await Payment.aggregate([
    { $match: { status: 'approved' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const text = `🔧 *Admin Panel — Statistika*\n\n` +
    `👥 Foydalanuvchilar: ${usersCount}\n` +
    `📦 Jami buyurtmalar: ${totalOrders}\n` +
    `✅ Yakunlangan: ${completedOrders}\n` +
    `⏳ Faol: ${activeOrders}\n` +
    `💰 Jami daromad: ${formatSum(revenue[0]?.total || 0)}\n` +
    `💳 Jami to'lovlar: ${formatSum(totalDeposits[0]?.total || 0)}\n` +
    `💵 Kurs: 1 USD = ${USD_RATE.toLocaleString()} so'm\n` +
    `📊 Marja: ${PROFIT_PERCENT}%`;

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getAdminKeyboard()
  });
}

async function showAdminUsers(chatId, messageId, page = 0) {
  const perPage = 10;
  const total = await User.countDocuments();
  const totalPages = Math.ceil(total / perPage);
  const users = await User.find().sort({ joinedAt: -1 }).skip(page * perPage).limit(perPage);

  let text = `👥 *Foydalanuvchilar* (Sahifa ${page + 1}/${totalPages || 1})\n\n`;
  users.forEach((u, i) => {
    text += `${page * perPage + i + 1}. ID: \`${u.chatId}\`\n`;
    text += `   @${u.username || 'yo\'q'} | ${u.firstName || ''}\n`;
    text += `   💳 ${formatSum(u.balance)} | 📦 ${u.ordersCount} | 💸 ${formatSum(u.totalSpent)}\n\n`;
  });

  const buttons = [];
  if (page > 0) buttons.push({ text: '⬅️', callback_data: `admin_user_page_${page - 1}` });
  if (page < totalPages - 1) buttons.push({ text: '➡️', callback_data: `admin_user_page_${page + 1}` });

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [buttons, [{ text: '🔙 Orqaga', callback_data: 'admin_panel' }]] }
  });
}

async function showAdminOrders(chatId, messageId, page = 0) {
  const perPage = 10;
  const total = await Order.countDocuments();
  const totalPages = Math.ceil(total / perPage);
  const orders = await Order.find().sort({ createdAt: -1 }).skip(page * perPage).limit(perPage);

  let text = `📋 *Buyurtmalar* (Sahifa ${page + 1}/${totalPages || 1})\n\n`;
  orders.forEach((o, i) => {
    const statusEmoji = o.status === 'completed' ? '✅' : o.status === 'active' ? '⏳' : '🚫';
    text += `${statusEmoji} ID: \`${o.activationId}\`\n`;
    text += `   📱 ${o.serviceName} | 🌍 ${o.countryName}\n`;
    text += `   💰 ${formatSum(o.price)}\n`;
    text += `   👤 User: \`${o.userId}\`\n\n`;
  });

  const buttons = [];
  if (page > 0) buttons.push({ text: '⬅️', callback_data: `admin_order_page_${page - 1}` });
  if (page < totalPages - 1) buttons.push({ text: '➡️', callback_data: `admin_order_page_${page + 1}` });

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [buttons, [{ text: '🔙 Orqaga', callback_data: 'admin_panel' }]] }
  });
}

async function showAdminPayments(chatId, messageId) {
  const payments = await Payment.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(20);

  if (payments.length === 0) {
    bot.editMessageText('✅ *Kutilayotgan to\'lovlar yo\'q.*', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getAdminKeyboard()
    });
    return;
  }

  let text = `💳 *Kutilayotgan to'lovlar*\n\n`;
  payments.forEach((p, i) => {
    text += `${i + 1}. User: \`${p.userId}\`\n`;
    text += `   💰 ${formatSum(p.amount)} | 🕐 ${p.createdAt.toLocaleString('uz-UZ')}\n\n`;
  });

  const buttons = payments.map(p => ([
    { text: `✅ ${formatSum(p.amount)}`, callback_data: `admin_approve_payment_${p._id}` },
    { text: `❌ Rad etish`, callback_data: `admin_reject_payment_${p._id}` }
  ]));
  buttons.push([{ text: '🔙 Orqaga', callback_data: 'admin_panel' }]);

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

async function processPayment(adminChatId, messageId, paymentId, status) {
  const payment = await Payment.findById(paymentId);
  if (!payment) return;

  payment.status = status;
  payment.processedAt = new Date();
  await payment.save();

  if (status === 'approved') {
    const user = await User.findOne({ chatId: payment.userId });
    if (user) {
      user.balance += payment.amount;
      await user.save();
    }
    bot.sendMessage(payment.userId,
      `✅ *To'lovingiz tasdiqlandi!*\n\n` +
      `💰 Summa: ${formatSum(payment.amount)}\n` +
      `💳 Yangi balans: ${formatSum(user.balance)}`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(payment.userId,
      `❌ *To'lovingiz rad etildi.*\n\nAgar xatolik bo'lsa, admin bilan bog'laning.`,
      { parse_mode: 'Markdown' }
    );
  }

  await showAdminPayments(adminChatId, messageId);
}

async function showAdminBalance(chatId, messageId) {
  try {
    const balance = await getBalance();
    const sumBalance = Math.ceil(balance * USD_RATE);

    const text = `💰 *API Balans*\n\n` +
      `💵 Dollar: $${balance}\n` +
      `💰 So'mda: ~${formatSum(sumBalance)}\n\n` +
      `💱 Kurs: ${USD_RATE.toLocaleString()}`;

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getAdminKeyboard()
    });
  } catch (e) {
    bot.editMessageText(`❌ Xatolik: ${e.message}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: getAdminKeyboard()
    });
  }
}

async function showAdminSettings(chatId, messageId) {
  const text = `⚙️ *Sozlamalar*\n\n` +
    `💱 Kurs: 1 USD = ${USD_RATE.toLocaleString()} so'm\n` +
    `📊 Marja: ${PROFIT_PERCENT}%\n` +
    `👤 Adminlar: ${ADMIN_IDS.join(', ')}\n\n` +
    `_Sozlamalarni o'zgartirish uchun .env faylni tahrirlang._`;

  bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Narxlarni yangilash', callback_data: 'admin_refresh_prices' }],
        [{ text: '🔙 Orqaga', callback_data: 'admin_panel' }]
      ]
    }
  });
}

// ========== XABARLAR HANDLERI ==========

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith('/')) return;

  const state = userState[chatId];
  if (!state) return;

  // To'lov summasi
  if (state.action === 'waiting_deposit_amount') {
    const amount = parseInt(text);
    if (isNaN(amount) || amount < 1000) {
      bot.sendMessage(chatId, '❌ Noto\'g\'ri summa. Kamida 1000 so\'m kiriting.');
      return;
    }

    state.action = 'waiting_deposit_screenshot';
    state.amount = amount;

    bot.sendMessage(chatId,
      `✅ Summa: ${formatSum(amount)}\n\n` +
      `Endi to'lov chekini (skrinshot) yuboring:`,
      {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Bekor qilish', callback_data: 'deposit' }]] }
      }
    );
    return;
  }

  // To'lov cheki
  if (state.action === 'waiting_deposit_screenshot') {
    const payment = new Payment({
      userId: chatId,
      amount: state.amount,
      method: 'manual',
      status: 'pending'
    });
    await payment.save();

    delete userState[chatId];

    bot.sendMessage(chatId,
      `✅ *So'rovingiz yuborildi!*\n\n` +
      `💰 Summa: ${formatSum(state.amount)}\n` +
      `⏳ Admin tekshirib, hisobingizni to'ldiradi.`,
      {
        parse_mode: 'Markdown',
        reply_markup: await getMainKeyboard(chatId)
      }
    );

    ADMIN_IDS.forEach(adminId => {
      bot.sendMessage(adminId,
        `💳 *Yangi to'lov so'rovi!*\n\n` +
        `👤 User: \`${chatId}\`\n` +
        `💰 Summa: ${formatSum(state.amount)}\n\n` +
        `Admin paneldan tekshiring.`
      );
    });

    return;
  }
});

// ========== XATOLIKLAR ==========

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

// ========== ISHGA TUSHIRISH ==========

console.log('🚀 SMM Hero Bot ishga tushdi...');
console.log(`👤 Adminlar: ${ADMIN_IDS.join(', ')}`);
console.log(`💱 Kurs: ${USD_RATE} so'm`);
console.log(`📊 Marja: ${PROFIT_PERCENT}%`);
'''

with open('/mnt/agents/output/index.js', 'w', encoding='utf-8') as f:
    f.write(code)

# Sintaksis tekshiruvi
open_braces = code.count('{')
close_braces = code.count('}')
open_parens = code.count('(')
close_parens = code.count(')')

print(f"✅ index.js yaratildi! ({len(code):,} bayt)")
print(f"{{  ochiq: {open_braces}, yopiq: {close_braces} {'✅' if open_braces == close_braces else '❌'}")
print(f"( ) ochiq: {open_parens}, yopiq: {close_parens} {'✅' if open_parens == close_parens else '❌'}")
