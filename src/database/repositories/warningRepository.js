const Warning = require('../models/Warning');
const { isUsingLocalStorage } = require('../connection');
const { getStore } = require('../localStorage');

function getWarningStore() {
    return getStore('warnings');
}

async function addWarning({ guildId, userId, moderatorId, reason }) {
    if (isUsingLocalStorage()) {
        const store = getWarningStore();
        const count = await store.countDocuments({ guildId, userId });
        const warningId = count + 1;
        return store.create({ guildId, userId, moderatorId, warningId, reason });
    }
    try {
        const count = await Warning.countDocuments({ guildId, userId });
        const warningId = count + 1;
        return Warning.create({ guildId, userId, moderatorId, warningId, reason });
    } catch {
        const store = getWarningStore();
        const count = await store.countDocuments({ guildId, userId });
        const warningId = count + 1;
        return store.create({ guildId, userId, moderatorId, warningId, reason });
    }
}

async function getWarnings(guildId, userId) {
    if (isUsingLocalStorage()) {
        return getWarningStore().find({ guildId, userId }).sort({ warningId: 1 }).lean();
    }
    try {
        return await Warning.find({ guildId, userId }).sort({ warningId: 1 }).lean();
    } catch {
        return getWarningStore().find({ guildId, userId }).sort({ warningId: 1 }).lean();
    }
}

async function removeWarning(guildId, userId, warningId) {
    if (isUsingLocalStorage()) {
        return getWarningStore().findOneAndDelete({ guildId, userId, warningId });
    }
    try {
        return await Warning.findOneAndDelete({ guildId, userId, warningId });
    } catch {
        return getWarningStore().findOneAndDelete({ guildId, userId, warningId });
    }
}

module.exports = {
    addWarning,
    getWarnings,
    removeWarning
};
