const Reminder = require('../models/Reminder');
const { requireDatabase, isDatabaseReady, isUsingLocalStorage } = require('../connection');
const { getStore } = require('../localStorage');

function getReminderStore() {
    return getStore('reminders');
}

async function createReminder(data) {
    if (isUsingLocalStorage()) {
        return getReminderStore().create(data);
    }
    requireDatabase();
    return Reminder.create(data);
}

async function getUserReminders(guildId, userId) {
    if (isUsingLocalStorage()) {
        return getReminderStore().find({ guildId, userId }).sort({ remindAt: 1 }).lean();
    }
    if (!isDatabaseReady()) return [];
    try {
        return await Reminder.find({ guildId, userId }).sort({ remindAt: 1 }).lean();
    } catch {
        return [];
    }
}

async function countUserReminders(guildId, userId) {
    if (isUsingLocalStorage()) {
        return getReminderStore().countDocuments({ guildId, userId });
    }
    if (!isDatabaseReady()) return 0;
    try {
        return await Reminder.countDocuments({ guildId, userId });
    } catch {
        return 0;
    }
}

async function getDueReminders(now = new Date()) {
    if (isUsingLocalStorage()) {
        return getReminderStore().find({ remindAt: { $lte: now } }).lean();
    }
    if (!isDatabaseReady()) return [];
    try {
        return await Reminder.find({ remindAt: { $lte: now } }).lean();
    } catch {
        return [];
    }
}

async function deleteReminder(id, userId) {
    if (isUsingLocalStorage()) {
        return getReminderStore().findOneAndDelete({ _id: id, userId });
    }
    requireDatabase();
    return Reminder.findOneAndDelete({ _id: id, userId }).lean();
}

async function deleteReminderById(id) {
    if (isUsingLocalStorage()) {
        return getReminderStore().findByIdAndDelete(id);
    }
    if (!isDatabaseReady()) return;
    try {
        await Reminder.findByIdAndDelete(id);
    } catch {
        // Already gone.
    }
}

module.exports = {
    createReminder,
    getUserReminders,
    countUserReminders,
    getDueReminders,
    deleteReminder,
    deleteReminderById
};
