const crypto = require('crypto');
const Poll = require('../models/Poll');
const { isUsingLocalStorage } = require('../connection');
const { getStore } = require('../localStorage');

function getPollStore() {
    return getStore('polls');
}

function newId() {
    return crypto.randomBytes(6).toString('hex');
}

async function createPoll(data) {
    if (isUsingLocalStorage()) {
        return getPollStore().create({ ...data, pollId: newId(), voters: data.voters || [] });
    }
    try {
        return await Poll.create({ ...data, pollId: newId() });
    } catch {
        return getPollStore().create({ ...data, pollId: newId(), voters: data.voters || [] });
    }
}

async function getPoll(pollId) {
    if (isUsingLocalStorage()) {
        return getPollStore().findOne({ pollId }).lean();
    }
    try {
        return await Poll.findOne({ pollId }).lean();
    } catch {
        return getPollStore().findOne({ pollId }).lean();
    }
}

async function castVote(pollId, userId, optionIndex) {
    if (isUsingLocalStorage()) {
        const store = getPollStore();
        const poll = await store.findOne({ pollId });
        if (!poll || poll.closed) return null;
        if (optionIndex < 0 || optionIndex >= poll.options.length) return null;

        if (!Array.isArray(poll.voters)) poll.voters = [];
        const existing = poll.voters.find(v => v.userId === userId);
        if (existing) {
            if (existing.optionIndex === optionIndex) return poll;
            poll.options[existing.optionIndex].votes = Math.max(0, (poll.options[existing.optionIndex].votes || 0) - 1);
            existing.optionIndex = optionIndex;
        } else {
            poll.voters.push({ userId, optionIndex });
        }
        poll.options[optionIndex].votes = (poll.options[optionIndex].votes || 0) + 1;
        await poll.save();
        return poll;
    }

    try {
        const poll = await Poll.findOne({ pollId });
        if (!poll || poll.closed) return null;
        if (optionIndex < 0 || optionIndex >= poll.options.length) return null;

        const existing = poll.voters.find(v => v.userId === userId);
        if (existing) {
            if (existing.optionIndex === optionIndex) return poll.toObject();
            poll.options[existing.optionIndex].votes = Math.max(0, poll.options[existing.optionIndex].votes - 1);
            existing.optionIndex = optionIndex;
        } else {
            poll.voters.push({ userId, optionIndex });
        }
        poll.options[optionIndex].votes += 1;
        await poll.save();
        return poll.toObject();
    } catch {
        return null;
    }
}

async function setPollMessage(pollId, messageId) {
    if (isUsingLocalStorage()) {
        return getPollStore().findOneAndUpdate({ pollId }, { messageId }, { returnDocument: 'after' }).lean();
    }
    try {
        return await Poll.findOneAndUpdate({ pollId }, { messageId }, { returnDocument: 'after' }).lean();
    } catch {
        return getPollStore().findOneAndUpdate({ pollId }, { messageId }, { returnDocument: 'after' }).lean();
    }
}

async function closePoll(pollId) {
    if (isUsingLocalStorage()) {
        return getPollStore().findOneAndUpdate(
            { pollId, closed: false },
            { closed: true },
            { returnDocument: 'after' }
        ).lean();
    }
    try {
        return await Poll.findOneAndUpdate(
            { pollId, closed: false },
            { closed: true },
            { returnDocument: 'after' }
        ).lean();
    } catch {
        return getPollStore().findOneAndUpdate(
            { pollId, closed: false },
            { closed: true },
            { returnDocument: 'after' }
        ).lean();
    }
}

async function findExpiredOpenPolls(now = new Date()) {
    if (isUsingLocalStorage()) {
        return getPollStore().find({ closed: false, endsAt: { $lte: now } }).lean();
    }
    try {
        return await Poll.find({ closed: false, endsAt: { $lte: now } }).lean();
    } catch {
        return getPollStore().find({ closed: false, endsAt: { $lte: now } }).lean();
    }
}

module.exports = { createPoll, getPoll, castVote, setPollMessage, closePoll, findExpiredOpenPolls };
