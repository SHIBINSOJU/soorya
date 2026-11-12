const crypto = require('crypto');
const Suggestion = require('../models/Suggestion');
const { isUsingLocalStorage } = require('../connection');
const { getStore } = require('../localStorage');

function getSuggestionStore() {
    return getStore('suggestions');
}

function newId() {
    return crypto.randomBytes(6).toString('hex');
}

async function createSuggestion(data) {
    if (isUsingLocalStorage()) {
        return getSuggestionStore().create({ ...data, suggestionId: newId() });
    }
    try {
        return await Suggestion.create({ ...data, suggestionId: newId() });
    } catch {
        return getSuggestionStore().create({ ...data, suggestionId: newId() });
    }
}

async function getSuggestion(suggestionId) {
    if (isUsingLocalStorage()) {
        return getSuggestionStore().findOne({ suggestionId }).lean();
    }
    try {
        return await Suggestion.findOne({ suggestionId }).lean();
    } catch {
        return getSuggestionStore().findOne({ suggestionId }).lean();
    }
}

async function reviewSuggestion(suggestionId, { status, reviewedBy }) {
    if (isUsingLocalStorage()) {
        return getSuggestionStore().findOneAndUpdate(
            { suggestionId },
            { status, reviewedBy, reviewedAt: new Date().toISOString() },
            { returnDocument: 'after' }
        ).lean();
    }
    try {
        return await Suggestion.findOneAndUpdate(
            { suggestionId },
            { status, reviewedBy, reviewedAt: new Date() },
            { returnDocument: 'after' }
        ).lean();
    } catch {
        return getSuggestionStore().findOneAndUpdate(
            { suggestionId },
            { status, reviewedBy, reviewedAt: new Date().toISOString() },
            { returnDocument: 'after' }
        ).lean();
    }
}

async function setSuggestionMessage(suggestionId, messageId) {
    if (isUsingLocalStorage()) {
        return getSuggestionStore().findOneAndUpdate({ suggestionId }, { messageId }, { returnDocument: 'after' }).lean();
    }
    try {
        return await Suggestion.findOneAndUpdate({ suggestionId }, { messageId }, { returnDocument: 'after' }).lean();
    } catch {
        return getSuggestionStore().findOneAndUpdate({ suggestionId }, { messageId }, { returnDocument: 'after' }).lean();
    }
}

module.exports = { createSuggestion, getSuggestion, reviewSuggestion, setSuggestionMessage };
