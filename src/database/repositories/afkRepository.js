const Afk = require('../models/Afk');
const { isUsingLocalStorage } = require('../connection');
const { getStore } = require('../localStorage');

function getAfkStore() {
    return getStore('afk');
}

async function setAfk(guildId, userId, reason) {
    if (isUsingLocalStorage()) {
        return getAfkStore().findOneAndUpdate(
            { guildId, userId },
            { reason, timestamp: new Date().toISOString() },
            { upsert: true, returnDocument: 'after' }
        ).lean();
    }
    try {
        return await Afk.findOneAndUpdate(
            { guildId, userId },
            { reason, timestamp: new Date() },
            { upsert: true, returnDocument: 'after' }
        ).lean();
    } catch {
        return getAfkStore().findOneAndUpdate(
            { guildId, userId },
            { reason, timestamp: new Date().toISOString() },
            { upsert: true, returnDocument: 'after' }
        ).lean();
    }
}

async function getAfk(guildId, userId) {
    if (isUsingLocalStorage()) {
        return getAfkStore().findOne({ guildId, userId }).lean();
    }
    try {
        return await Afk.findOne({ guildId, userId }).lean();
    } catch {
        return getAfkStore().findOne({ guildId, userId }).lean();
    }
}

async function clearAfk(guildId, userId) {
    if (isUsingLocalStorage()) {
        return getAfkStore().findOneAndDelete({ guildId, userId }).lean();
    }
    try {
        return await Afk.findOneAndDelete({ guildId, userId }).lean();
    } catch {
        return getAfkStore().findOneAndDelete({ guildId, userId }).lean();
    }
}

module.exports = { setAfk, getAfk, clearAfk };
