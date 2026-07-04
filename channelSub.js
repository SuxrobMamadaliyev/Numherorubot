const { Markup } = require('telegraf');
const { getSetting } = require('./settings');
const { isAdmin } = require('./admin');

// Проверяет подписку на все обязательные каналы перед использованием бота.
// В админ панели можно добавить неограниченное количество каналов.
async function requireChannelSub(ctx, next) {
  if (isAdmin(ctx.from?.id)) return next();

  const channels = (await getSetting('force_sub_channels')) || [];
  if (!channels.length) return next();

  const notJoined = [];
  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
      const isMember = ['member', 'administrator', 'creator'].includes(member.status);
      if (!isMember) notJoined.push(channel);
    } catch (e) {
      console.error(`Ошибка проверки канала (${channel}):`, e.message);
      notJoined.push(channel);
    }
  }

  if (notJoined.length === 0) return next();

  const buttons = notJoined.map(channel => {
    const link = channel.startsWith('@') ? `https://t.me/${channel.slice(1)}` : channel;
    return [Markup.button.url(`📢 ${channel}`, link)];
  });
  buttons.push([Markup.button.callback('✅ Проверить подписку', 'check_sub')]);

  const text =
    `🔒 Для использования бота подпишитесь на следующие каналы:\n\n` +
    notJoined.map(c => `📢 ${c}`).join('\n') +
    `\n\nПосле подписки нажмите «✅ Проверить подписку».`;
  const kb = Markup.inlineKeyboard(buttons);

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery('🔒 Сначала подпишитесь на все каналы!', { show_alert: true });
    try { await ctx.editMessageText(text, kb); } catch { await ctx.reply(text, kb); }
  } else {
    await ctx.reply(text, kb);
  }
  return;
}

module.exports = { requireChannelSub };
