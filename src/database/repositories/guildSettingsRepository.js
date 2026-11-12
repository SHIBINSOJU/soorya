const GuildSettings = require('../models/GuildSettings');
const { isUsingLocalStorage } = require('../connection');
const { getStore } = require('../localStorage');

function getSettingsStore() {
    return getStore('guild_settings');
}

async function getGuildSettings(guildId) {
    if (isUsingLocalStorage()) {
        return getSettingsStore().findOne({ guildId }).lean();
    }
    try {
        return await GuildSettings.findOne({ guildId }).lean();
    } catch {
        return getSettingsStore().findOne({ guildId }).lean();
    }
}

async function updateGuildSettings(guildId, update) {
    if (isUsingLocalStorage()) {
        return getSettingsStore().findOneAndUpdate({ guildId }, update, { upsert: true, returnDocument: 'after' }).lean();
    }
    try {
        return await GuildSettings.findOneAndUpdate({ guildId }, update, { upsert: true, returnDocument: 'after' }).lean();
    } catch {
        return getSettingsStore().findOneAndUpdate({ guildId }, update, { upsert: true, returnDocument: 'after' }).lean();
    }
}

module.exports = {
    getGuildSettings,
    updateGuildSettings
};
