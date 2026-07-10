const mongoose = require('mongoose');

// ---- Foydalanuvchi ----
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username: String,
  fullName: String,
  balance: { type: Number, default: 0 }, // USD
  totalSpent: { type: Number, default: 0 },
  totalFeeCollected: { type: Number, default: 0 }, // Balans to'ldirishda ushlab qolingan komissiya
  referredBy: Number,
  referralCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// ---- Sozlamalar (admin tomonidan o'zgartiriladi) ----
const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

// ---- Aktivatsiya tarixi ----
const activationSchema = new mongoose.Schema({
  telegramId: Number,
  activationId: String,
  service: String,
  country: String,
  phoneNumber: String,
  pricePaid: Number, // USD
  status: { type: String, default: 'pending' }, // pending | success | cancelled
  code: String,
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Activation = mongoose.model('Activation', activationSchema);

module.exports = { User, Settings, Activation };
