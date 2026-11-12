const logger = require('../../../core/logger');

// guildId -> Map(inviteCode -> { code, uses, inviterId, inviterTag, maxUses })
const guildInvitesCache = new Map();
// guildId -> number
const vanityUsesCache = new Map();

async function cacheGuildInvites(guild) {
    if (!guild || !guild.members?.me) return;

    // Check if bot has permission to manage or view invites
    if (!guild.members.me.permissions.has('ManageGuild')) {
        logger.warn(`InviteTracker: Missing "Manage Server" permission in "${guild.name}" (${guild.id}). Invite tracking may be limited.`);
    }

    try {
        const invites = await guild.invites.fetch().catch(() => null);
        const codeMap = new Map();
        if (invites) {
            for (const [code, invite] of invites) {
                codeMap.set(code, {
                    code,
                    uses: invite.uses || 0,
                    inviterId: invite.inviter?.id || null,
                    inviterTag: invite.inviter?.tag || null,
                    maxUses: invite.maxUses || 0
                });
            }
        }
        guildInvitesCache.set(guild.id, codeMap);

        if (guild.vanityURLCode) {
            const vanity = await guild.fetchVanityData().catch(() => null);
            if (vanity) {
                vanityUsesCache.set(guild.id, vanity.uses || 0);
            }
        }
    } catch (err) {
        logger.error(`InviteTracker: Failed to cache invites for guild ${guild.id}: ${err.message}`);
    }
}

async function initInviteCache(client) {
    logger.info('InviteTracker: Caching invites for all guilds...');
    for (const guild of client.guilds.cache.values()) {
        await cacheGuildInvites(guild);
    }
    logger.info(`InviteTracker: Cached invites across ${client.guilds.cache.size} guilds.`);
}

function handleInviteCreate(invite) {
    if (!invite?.guild?.id) return;
    let codeMap = guildInvitesCache.get(invite.guild.id);
    if (!codeMap) {
        codeMap = new Map();
        guildInvitesCache.set(invite.guild.id, codeMap);
    }
    codeMap.set(invite.code, {
        code: invite.code,
        uses: invite.uses || 0,
        inviterId: invite.inviter?.id || null,
        inviterTag: invite.inviter?.tag || null,
        maxUses: invite.maxUses || 0
    });
}

function handleInviteDelete(invite) {
    if (!invite?.guild?.id) return;
    const codeMap = guildInvitesCache.get(invite.guild.id);
    if (codeMap) {
        codeMap.delete(invite.code);
    }
}

async function findUsedInvite(guild) {
    if (!guild) return { type: 'unknown' };

    const cachedMap = guildInvitesCache.get(guild.id) || new Map();
    let currentInvites = null;

    try {
        currentInvites = await guild.invites.fetch().catch(() => null);
    } catch (err) {
        logger.error(`InviteTracker: fetch invites failed for ${guild.id}: ${err.message}`);
    }

    if (currentInvites) {
        // Find which invite increased uses
        for (const [code, invite] of currentInvites) {
            const cached = cachedMap.get(code);
            const currentUses = invite.uses || 0;
            const previousUses = cached ? (cached.uses || 0) : 0;

            if (currentUses > previousUses) {
                // Update cache
                await cacheGuildInvites(guild);
                return {
                    type: 'invite',
                    code: invite.code,
                    inviter: invite.inviter || null,
                    inviterId: invite.inviter?.id || null,
                    uses: currentUses
                };
            }
        }

        // Also check if a single-use invite was deleted because it was used
        for (const [code, cached] of cachedMap) {
            if (!currentInvites.has(code) && (cached.uses + 1 === cached.maxUses || cached.maxUses === 1)) {
                await cacheGuildInvites(guild);
                return {
                    type: 'invite',
                    code: cached.code,
                    inviter: cached.inviterId ? { id: cached.inviterId, tag: cached.inviterTag } : null,
                    inviterId: cached.inviterId,
                    uses: cached.uses + 1
                };
            }
        }
    }

    // Check vanity URL
    if (guild.vanityURLCode) {
        try {
            const currentVanity = await guild.fetchVanityData().catch(() => null);
            const previousVanityUses = vanityUsesCache.get(guild.id) || 0;
            if (currentVanity && currentVanity.uses > previousVanityUses) {
                vanityUsesCache.set(guild.id, currentVanity.uses);
                await cacheGuildInvites(guild);
                return {
                    type: 'vanity',
                    code: guild.vanityURLCode,
                    uses: currentVanity.uses
                };
            }
        } catch {}
    }

    // Update cache anyway to stay in sync
    await cacheGuildInvites(guild);
    return { type: 'unknown' };
}

module.exports = {
    initInviteCache,
    cacheGuildInvites,
    handleInviteCreate,
    handleInviteDelete,
    findUsedInvite,
    guildInvitesCache
};
