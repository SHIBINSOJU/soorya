const { Ticket, TicketCounter } = require('../models/Ticket');
const { isUsingLocalStorage } = require('../connection');
const { getStore } = require('../localStorage');

function getTicketStore() {
    return getStore('tickets');
}

function getCounterStore() {
    return getStore('ticket_counters');
}

async function nextTicketNumber(guildId) {
    if (isUsingLocalStorage()) {
        const store = getCounterStore();
        const counter = await store.findOneAndUpdate(
            { guildId },
            { $inc: { seq: 1 } },
            { upsert: true, returnDocument: 'after' }
        );
        return counter.seq;
    }
    const counter = await TicketCounter.findOneAndUpdate(
        { guildId },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' }
    );
    return counter.seq;
}

async function createTicket(data) {
    if (isUsingLocalStorage()) {
        return getTicketStore().create(data);
    }
    return Ticket.create(data);
}

async function getTicketById(id) {
    if (isUsingLocalStorage()) {
        return getTicketStore().findById(id).lean();
    }
    try {
        return await Ticket.findById(id).lean();
    } catch {
        return null;
    }
}

async function getTicketByChannel(guildId, channelId) {
    if (isUsingLocalStorage()) {
        return getTicketStore().findOne({ guildId, channelId }).lean();
    }
    try {
        return await Ticket.findOne({ guildId, channelId }).lean();
    } catch {
        return null;
    }
}

async function getOpenTicketsByUser(guildId, userId) {
    if (isUsingLocalStorage()) {
        return getTicketStore().find({ guildId, userId, status: { $in: ['open', 'claimed'] } })
            .sort({ createdAt: 1 })
            .lean();
    }
    try {
        return await Ticket.find({ guildId, userId, status: { $in: ['open', 'claimed'] } })
            .sort({ createdAt: 1 })
            .lean();
    } catch {
        return [];
    }
}

async function countOpenTickets(guildId) {
    if (isUsingLocalStorage()) {
        return getTicketStore().countDocuments({ guildId, status: { $in: ['open', 'claimed'] } });
    }
    try {
        return await Ticket.countDocuments({ guildId, status: { $in: ['open', 'claimed'] } });
    } catch {
        return 0;
    }
}

async function updateTicket(id, update) {
    if (isUsingLocalStorage()) {
        return getTicketStore().findByIdAndUpdate(id, update, { returnDocument: 'after' }).lean();
    }
    return Ticket.findByIdAndUpdate(id, update, { returnDocument: 'after' }).lean();
}

async function deleteTicket(id) {
    if (isUsingLocalStorage()) {
        return getTicketStore().findByIdAndDelete(id);
    }
    try {
        await Ticket.findByIdAndDelete(id);
    } catch { /* already gone */ }
}

module.exports = {
    nextTicketNumber,
    createTicket,
    getTicketById,
    getTicketByChannel,
    getOpenTicketsByUser,
    countOpenTickets,
    updateTicket,
    deleteTicket
};
