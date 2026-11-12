const { InviteStats } = require('../models/InviteStats');
const { MemberInvite } = require('../models/MemberInvite');
const { isDatabaseReady, isUsingLocalStorage } = require('../connection');
const { getStore } = require('../localStorage');
const logger = require('../../core/logger');

function getStatsStore() {
    return getStore('invite_stats');
}

function getMemberStore() {
    return getStore('member_invites');
}

// In-memory fallbacks when neither MongoDB nor LocalStorage is functioning
const memoryStats = new Map(); // key: `${guildId}:${userId}` -> { regular, left, fake, bonus }
const memoryMembers = new Map(); // key: `${guildId}:${memberId}` -> { inviterId, code, isFake, joinedAt }

function statsKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function memberKey(guildId, memberId) {
    return `${guildId}:${memberId}`;
}

function computeTotal(stat) {
    if (!stat) return 0;
    return Math.max(0, (stat.regular || 0) + (stat.bonus || 0) - (stat.left || 0));
}

function formatResult(doc) {
    if (!doc) {
        return { regular: 0, left: 0, fake: 0, bonus: 0, total: 0 };
    }
    const regular = doc.regular || 0;
    const left = doc.left || 0;
    const fake = doc.fake || 0;
    const bonus = doc.bonus || 0;
    return {
        regular,
        left,
        fake,
        bonus,
        total: Math.max(0, regular + bonus - left)
    };
}

async function getStats(guildId, userId) {
    if (isUsingLocalStorage()) {
        try {
            const doc = await getStatsStore().findOne({ guildId, userId });
            return formatResult(doc);
        } catch (err) {
            logger.error(`inviteRepository.getStats local failed: ${err.message}`);
            return formatResult(null);
        }
    }
    if (!isDatabaseReady()) {
        const mem = memoryStats.get(statsKey(guildId, userId));
        return formatResult(mem);
    }
    try {
        const doc = await InviteStats.findOne({ guildId, userId }).lean();
        return formatResult(doc);
    } catch (err) {
        logger.error(`inviteRepository.getStats failed: ${err.message}`);
        return formatResult(memoryStats.get(statsKey(guildId, userId)));
    }
}

async function recordJoin(guildId, memberId, inviterId, code, isFake = false) {
    if (isUsingLocalStorage()) {
        try {
            await getMemberStore().findOneAndUpdate(
                { guildId, memberId },
                { inviterId, code, isFake, joinedAt: new Date().toISOString() },
                { upsert: true, returnDocument: 'after' }
            );

            let updatedStats = null;
            if (inviterId) {
                const inc = isFake ? { fake: 1 } : { regular: 1 };
                const doc = await getStatsStore().findOneAndUpdate(
                    { guildId, userId: inviterId },
                    { $inc: inc },
                    { upsert: true, returnDocument: 'after' }
                );
                updatedStats = formatResult(doc);
            }
            return updatedStats;
        } catch (err) {
            logger.error(`inviteRepository.recordJoin local failed: ${err.message}`);
        }
    }

    // Record member mapping in memory
    memoryMembers.set(memberKey(guildId, memberId), {
        inviterId,
        code,
        isFake,
        joinedAt: new Date()
    });

    let updatedStats = null;

    if (inviterId) {
        const mKey = statsKey(guildId, inviterId);
        const mem = memoryStats.get(mKey) || { regular: 0, left: 0, fake: 0, bonus: 0 };
        if (isFake) {
            mem.fake = (mem.fake || 0) + 1;
        } else {
            mem.regular = (mem.regular || 0) + 1;
        }
        memoryStats.set(mKey, mem);
        updatedStats = formatResult(mem);
    }

    if (isDatabaseReady()) {
        try {
            await MemberInvite.findOneAndUpdate(
                { guildId, memberId },
                { inviterId, code, isFake, joinedAt: new Date() },
                { upsert: true, returnDocument: 'after' }
            );

            if (inviterId) {
                const inc = isFake ? { fake: 1 } : { regular: 1 };
                const doc = await InviteStats.findOneAndUpdate(
                    { guildId, userId: inviterId },
                    { $inc: inc },
                    { upsert: true, returnDocument: 'after' }
                );
                updatedStats = formatResult(doc);
            }
        } catch (err) {
            logger.error(`inviteRepository.recordJoin DB failed: ${err.message}`);
        }
    }

    return updatedStats;
}

async function recordLeave(guildId, memberId) {
    if (isUsingLocalStorage()) {
        try {
            const memberDoc = await getMemberStore().findOne({ guildId, memberId });
            if (!memberDoc || !memberDoc.inviterId) {
                return { inviterId: null, stats: null };
            }
            const inviterId = memberDoc.inviterId;
            const doc = await getStatsStore().findOneAndUpdate(
                { guildId, userId: inviterId },
                { $inc: { left: 1 } },
                { upsert: true, returnDocument: 'after' }
            );
            return { inviterId, stats: formatResult(doc) };
        } catch (err) {
            logger.error(`inviteRepository.recordLeave local failed: ${err.message}`);
        }
    }

    let inviterId = null;
    let isFake = false;

    // First check database if ready
    if (isDatabaseReady()) {
        try {
            const memberDoc = await MemberInvite.findOne({ guildId, memberId }).lean();
            if (memberDoc) {
                inviterId = memberDoc.inviterId;
                isFake = memberDoc.isFake;
            }
        } catch (err) {
            logger.error(`inviteRepository.recordLeave DB lookup failed: ${err.message}`);
        }
    }

    // Fall back to memory if DB didn't find
    if (!inviterId) {
        const mem = memoryMembers.get(memberKey(guildId, memberId));
        if (mem) {
            inviterId = mem.inviterId;
            isFake = mem.isFake;
        }
    }

    if (!inviterId) {
        return { inviterId: null, stats: null };
    }

    // Update inviter's left count
    const mKey = statsKey(guildId, inviterId);
    const mem = memoryStats.get(mKey) || { regular: 0, left: 0, fake: 0, bonus: 0 };
    mem.left = (mem.left || 0) + 1;
    memoryStats.set(mKey, mem);
    let updatedStats = formatResult(mem);

    if (isDatabaseReady()) {
        try {
            const doc = await InviteStats.findOneAndUpdate(
                { guildId, userId: inviterId },
                { $inc: { left: 1 } },
                { upsert: true, returnDocument: 'after' }
            );
            updatedStats = formatResult(doc);
        } catch (err) {
            logger.error(`inviteRepository.recordLeave DB update failed: ${err.message}`);
        }
    }

    return { inviterId, stats: updatedStats };
}

async function addBonus(guildId, userId, amount) {
    if (isUsingLocalStorage()) {
        try {
            const doc = await getStatsStore().findOneAndUpdate(
                { guildId, userId },
                { $inc: { bonus: amount } },
                { upsert: true, returnDocument: 'after' }
            );
            return formatResult(doc);
        } catch (err) {
            logger.error(`inviteRepository.addBonus local failed: ${err.message}`);
            return formatResult(null);
        }
    }

    const mKey = statsKey(guildId, userId);
    const mem = memoryStats.get(mKey) || { regular: 0, left: 0, fake: 0, bonus: 0 };
    mem.bonus = (mem.bonus || 0) + amount;
    memoryStats.set(mKey, mem);
    let updatedStats = formatResult(mem);

    if (isDatabaseReady()) {
        try {
            const doc = await InviteStats.findOneAndUpdate(
                { guildId, userId },
                { $inc: { bonus: amount } },
                { upsert: true, returnDocument: 'after' }
            );
            updatedStats = formatResult(doc);
        } catch (err) {
            logger.error(`inviteRepository.addBonus DB failed: ${err.message}`);
        }
    }

    return updatedStats;
}

async function removeBonus(guildId, userId, amount) {
    return addBonus(guildId, userId, -amount);
}

async function resetStats(guildId, userId) {
    const zero = { regular: 0, left: 0, fake: 0, bonus: 0, total: 0 };

    if (isUsingLocalStorage()) {
        try {
            await getStatsStore().findOneAndUpdate(
                { guildId, userId },
                { regular: 0, left: 0, fake: 0, bonus: 0 },
                { upsert: true }
            );
            return zero;
        } catch (err) {
            logger.error(`inviteRepository.resetStats local failed: ${err.message}`);
            return zero;
        }
    }

    const mKey = statsKey(guildId, userId);
    memoryStats.set(mKey, zero);

    if (isDatabaseReady()) {
        try {
            await InviteStats.findOneAndUpdate(
                { guildId, userId },
                { regular: 0, left: 0, fake: 0, bonus: 0 },
                { upsert: true }
            );
        } catch (err) {
            logger.error(`inviteRepository.resetStats DB failed: ${err.message}`);
        }
    }

    return zero;
}

async function getLeaderboard(guildId, limit = 10, skip = 0) {
    if (isUsingLocalStorage()) {
        try {
            const allDocs = await getStatsStore().find({ guildId });
            const list = allDocs.map(r => ({
                userId: r.userId,
                regular: r.regular || 0,
                left: r.left || 0,
                fake: r.fake || 0,
                bonus: r.bonus || 0,
                total: Math.max(0, (r.regular || 0) + (r.bonus || 0) - (r.left || 0))
            }));
            list.sort((a, b) => b.total - a.total || b.regular - a.regular);
            return list.slice(skip, skip + limit);
        } catch (err) {
            logger.error(`inviteRepository.getLeaderboard local failed: ${err.message}`);
            return [];
        }
    }

    if (isDatabaseReady()) {
        try {
            const results = await InviteStats.aggregate([
                { $match: { guildId } },
                {
                    $addFields: {
                        total: {
                            $max: [
                                0,
                                {
                                    $subtract: [
                                        { $add: [{ $ifNull: ['$regular', 0] }, { $ifNull: ['$bonus', 0] }] },
                                        { $ifNull: ['$left', 0] }
                                    ]
                                }
                            ]
                        }
                    }
                },
                { $sort: { total: -1, regular: -1 } },
                { $skip: skip },
                { $limit: limit }
            ]);

            return results.map(r => ({
                userId: r.userId,
                regular: r.regular || 0,
                left: r.left || 0,
                fake: r.fake || 0,
                bonus: r.bonus || 0,
                total: r.total || 0
            }));
        } catch (err) {
            logger.error(`inviteRepository.getLeaderboard DB failed: ${err.message}`);
        }
    }

    // Memory fallback
    const list = [];
    for (const [key, val] of memoryStats.entries()) {
        if (key.startsWith(`${guildId}:`)) {
            const userId = key.split(':')[1];
            list.push({
                userId,
                regular: val.regular || 0,
                left: val.left || 0,
                fake: val.fake || 0,
                bonus: val.bonus || 0,
                total: computeTotal(val)
            });
        }
    }

    list.sort((a, b) => b.total - a.total || b.regular - a.regular);
    return list.slice(skip, skip + limit);
}

module.exports = {
    getStats,
    recordJoin,
    recordLeave,
    addBonus,
    removeBonus,
    resetStats,
    getLeaderboard
};
