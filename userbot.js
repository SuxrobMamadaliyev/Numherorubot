// userbot.js — har bir sotiladigan raqamni (alohida Telegram akkauntini) GramJS (MTProto)
// orqali boshqaradi: bir martalik login (telefon -> kod -> kerak bo'lsa parol) va
// login tugagach kelgan xabarlarni tinglab, ichidan kodni ajratib olish.
//
// MUHIM: TELEGRAM_API_ID va TELEGRAM_API_HASH https://my.telegram.org saytidan olinadi
// (bitta ilova — barcha raqamlar shu bitta api_id/api_hash bilan login qiladi, faqat
// sessionString har bir raqam uchun alohida).

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
const API_HASH = process.env.TELEGRAM_API_HASH || '';

// adminTelegramId -> { client, phoneNumber, resolveCode, resolvePassword, reject }
const pendingLogins = {};

// phoneNumber -> { client }
const activeListeners = {};

function checkCreds() {
  if (!API_ID || !API_HASH) {
    throw new Error(
      "TELEGRAM_API_ID / TELEGRAM_API_HASH sozlanmagan. Bularni https://my.telegram.org dan olib .env ga qo'shing."
    );
  }
}

// Xabar matnidan tasdiqlash kodini topishga harakat qiladi.
// Avval "code"/"kod"/"код" so'zidan keyingi raqamlarni, topilmasa xabardagi
// birinchi 4-8 xonali raqamlar ketma-ketligini qaytaradi.
function extractCode(text) {
  if (!text) return null;
  const labeled = text.match(/(?:code|kod|код|пароль|parol)[\s:.\-]*([0-9]{3,8})/i);
  if (labeled) return labeled[1];
  const bare = text.match(/\b(\d{4,8})\b/);
  if (bare) return bare[1];
  return null;
}

// ---- LOGIN OQIMI ----
// Admin panel orqali chaqiriladi. client.start() ichidagi phoneCode/password
// callbacklari Promise sifatida "muzlab" turadi — ular submitCode/submitPassword
// chaqirilgandagina davom etadi (bu funksiyalar admin botga matn yozganda ishga tushadi).
function startLogin(adminId, phoneNumber, { onCodeRequested, onPasswordRequested, onSuccess, onError }) {
  checkCreds();
  cancelLogin(adminId); // avvalgi tugallanmagan urinish bo'lsa tozalaymiz

  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 3,
  });

  pendingLogins[adminId] = { client, phoneNumber };

  client
    .start({
      phoneNumber: async () => phoneNumber,
      phoneCode: async () => {
        onCodeRequested();
        return new Promise((resolve, reject) => {
          if (!pendingLogins[adminId]) return reject(new Error('Bekor qilindi'));
          pendingLogins[adminId].resolveCode = resolve;
          pendingLogins[adminId].rejectCode = reject;
        });
      },
      password: async () => {
        onPasswordRequested();
        return new Promise((resolve, reject) => {
          if (!pendingLogins[adminId]) return reject(new Error('Bekor qilindi'));
          pendingLogins[adminId].resolvePassword = resolve;
          pendingLogins[adminId].rejectPassword = reject;
        });
      },
      onError: err => {
        onError(err);
        return true; // xatoni "hazm qilingan" deb belgilaymiz, GramJS qayta urinmasin
      },
    })
    .then(() => {
      const sessionString = client.session.save();
      delete pendingLogins[adminId];
      onSuccess(sessionString, client);
    })
    .catch(err => {
      delete pendingLogins[adminId];
      onError(err);
    });
}

function submitCode(adminId, code) {
  const p = pendingLogins[adminId];
  if (p && p.resolveCode) {
    const resolve = p.resolveCode;
    p.resolveCode = null;
    resolve(code.trim());
    return true;
  }
  return false;
}

function submitPassword(adminId, password) {
  const p = pendingLogins[adminId];
  if (p && p.resolvePassword) {
    const resolve = p.resolvePassword;
    p.resolvePassword = null;
    resolve(password.trim());
    return true;
  }
  return false;
}

function hasPendingLogin(adminId) {
  return !!pendingLogins[adminId];
}

async function cancelLogin(adminId) {
  const p = pendingLogins[adminId];
  if (!p) return;
  delete pendingLogins[adminId];
  try {
    if (p.rejectCode) p.rejectCode(new Error('Bekor qilindi'));
    if (p.rejectPassword) p.rejectPassword(new Error('Bekor qilindi'));
    await p.client.destroy();
  } catch {}
}

// ---- TINGLASH (login tugagandan keyin) ----
// numberAccount: { phoneNumber, sessionString }
// onCode({ phoneNumber, code, rawText }) — kod topilganda chaqiriladi
async function startListening(numberAccount, onCode) {
  checkCreds();
  const { phoneNumber, sessionString } = numberAccount;
  if (activeListeners[phoneNumber]) return; // allaqachon tinglanmoqda

  const stringSession = new StringSession(sessionString);
  const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.connect();
  activeListeners[phoneNumber] = { client };

  client.addEventHandler(async event => {
    try {
      const text = event?.message?.message || '';
      const code = extractCode(text);
      if (code) {
        onCode({ phoneNumber, code, rawText: text });
      }
    } catch (e) {
      console.error(`Userbot xabarni o'qishda xato (${phoneNumber}):`, e.message);
    }
  }, new NewMessage({}));
}

async function stopListening(phoneNumber) {
  const entry = activeListeners[phoneNumber];
  if (!entry) return;
  delete activeListeners[phoneNumber];
  try {
    await entry.client.destroy();
  } catch {}
}

function isListening(phoneNumber) {
  return !!activeListeners[phoneNumber];
}

function listeningCount() {
  return Object.keys(activeListeners).length;
}

// Bot qayta ishga tushganda (Render qayta deploy/uxlab qolish) barcha faol
// (sessionString bor va status 'available' yoki 'assigned') raqamlar uchun
// tinglovchini qayta ulaydi — shunda kod kelishi to'xtab qolmaydi.
async function resumeAll(numberAccounts, onCode) {
  for (const acc of numberAccounts) {
    if (!acc.sessionString) continue;
    try {
      await startListening(acc, onCode);
    } catch (e) {
      console.error(`Userbot qayta ulanishda xato (${acc.phoneNumber}):`, e.message);
    }
  }
}

module.exports = {
  extractCode,
  startLogin,
  submitCode,
  submitPassword,
  hasPendingLogin,
  cancelLogin,
  startListening,
  stopListening,
  isListening,
  listeningCount,
  resumeAll,
};
