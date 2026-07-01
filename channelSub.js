const { Markup } = require('telegraf');
const { getSetting } = require('./settings');
const { isAdmin } = require('./admin');

// Botdan foydalanishdan oldin barcha majburiy kanallarga obuna bo'lishni tekshiradi.
// Admin panelda cheksiz miqdorda kanal qo'shish mumkin.
async function requireChannelSub(ctx, next) {
  if (isAdmin(ctx.from?.id)) return next();

  const channels = (await getSetting('force_sub_channels')) || [];
  if (!channels.length) return next(); // Majburiy obuna o'chirilgan / kanal qo'shilmagan

  const notJoined = [];
  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
      const isMember = ['member', 'administrator', 'creator'].includes(member.status);
      if (!isMember) notJoined.push(channel);
    } catch (e) {
      // Tekshira olmadik (masalan, bot bu kanalda admin emas yoki manzil noto'g'ri).
      // Xavfsizlik uchun bunday holatda ham foydalanuvchini "aʼzo bo'lmagan" deb hisoblaymiz,
      // aks holda bu kanal doim o'tkazib yuborilib qoladi.
      console.error(`Kanal tekshiruvida xato (${channel}):`, e.message);
      notJoined.push(channel);
    }
  }

  if (notJoined.length === 0) return next();

  const buttons = notJoined.map(channel => {
    const link = channel.startsWith('@') ? `https://t.me/${channel.slice(1)}` : channel;
    return [Markup.button.url(`📢 ${channel}`, link)];
  });
  buttons.push([Markup.button.callback('✅ Tekshirish', 'check_sub')]);

  const text =
    `🔒 Botdan foydalanish uchun quyidagi kanal(lar)ga aʼzo boʻling:\n\n` +
    notJoined.map(c => `📢 ${c}`).join('\n') +
    `\n\nAʼzo boʻlgach, "✅ Tekshirish" tugmasini bosing.`;
  const kb = Markup.inlineKeyboard(buttons);

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('🔒 Avval barcha kanallarga aʼzo boʻling!', { show_alert: true });
    try { await ctx.editMessageText(text, kb); } catch { await ctx.reply(text, kb); }
  } else {
    await ctx.reply(text, kb);
  }
  return; // next() chaqirilmaydi — zanjir to'xtaydi
}

module.exports = { requireChannelSub };
