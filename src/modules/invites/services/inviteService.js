const logger = require('../../../core/logger');
const configService = require('../../../core/configService');
const guildSettingsRepository = require('../../../database/repositories/guildSettingsRepository');
const inviteRepository = require('../../../database/repositories/inviteRepository');
const { findUsedInvite } = require('./inviteCache');
const { detectAlt } = require('./altDetection');
const { withRetry } = require('../../../utils/retry');

// The server-logs module is optional: invite tracking must keep working in
// deployments where src/modules/logs is missing or the module is disabled.
function optionalRequire(modulePath, fallback) {
    try {
        return require(modulePath);
    } catch {
        return fallback;
    }
}

const { sendLog } = optionalRequire('../../logs/services/logDispatcher', {
    sendLog: async () => false
});

const logBuilders = optionalRequire('../../logs/services/logBuilders', {
    avatarUrlOf: () => null,
    fmtTimestamp: (timestamp) => (timestamp ? `<t:${Math.floor(timestamp / 1000)}:R>` : 'unknown'),
    userLine: (user, member) => `<@${user?.id || member?.id}> (\`${user?.tag || user?.username || 'unknown'}\`)`
});
const { avatarUrlOf, fmtTimestamp, userLine } = logBuilders;

// File-level defaults. Every string below can be overridden in config.yml and,
// for the channel, per server through /invites channel (GuildSettings.invites).
const DEFAULTS = {
    enabled: true,
    logChannelId: '',
    minAccountAgeDays: 3,
    trackLeaves: true,
    altDetection: {
        enabled: true,
        minAccountAgeDays: 7,
        avatarCloneCheck: true
    },
    joinMessage: '📥 **{member}** joined using invite code `{code}` from **{inviter}** (now has **{inviterTotal}** invites)!',
    rejoinMessage: '🔁 **{member}** rejoined the hive — originally invited by **{inviter}** (now has **{inviterTotal}** invites).',
    altJoinMessage: '⚠️ **{member}** joined, but was flagged as a possible alt ({altReason}). Invited by **{inviter}**.',
    leaveMessage: '📤 **{member}** left. They were invited by **{inviter}** (now has **{inviterTotal}** invites).',
    vanityJoinMessage: '🔗 **{member}** joined using the server vanity URL!',
    unknownJoinMessage: '📥 **{member}** joined (invite could not be determined).'
};

/** File-level invite configuration (used when no guild is available). */
function getInviteConfig() {
    const base = configService.get('invites', {}) || {};
    return {
        ...DEFAULTS,
        ...base,
        altDetection: { ...DEFAULTS.altDetection, ...(base.altDetection || {}) }
    };
}

/**
 * Effective config for one guild:
 *   config.yml invites  ->  GuildSettings.invites { enabled, channelId }
 * Only the channel (and the on/off switch) is stored per server; message
 * templates stay file-level so one deployment renders consistently.
 */
async function resolveInviteConfig(guild) {
    const cfg = getInviteConfig();
    // The config.yml channel stays available as a fallback: a per-guild
    // override that points at a deleted channel must not silence
    // announcements entirely.
    const configChannelId = cfg.logChannelId || '';
    if (!guild?.id) return { ...cfg, configChannelId };

    let stored = null;
    try {
        const settings = await guildSettingsRepository.getGuildSettings(guild.id);
        stored = settings?.invites || null;
    } catch {
        stored = null;
    }

    return {
        ...cfg,
        enabled: stored?.enabled ?? cfg.enabled,
        logChannelId: stored?.channelId || configChannelId,
        configChannelId
    };
}

async function handleMemberJoin(member) {
    logger.info(`InviteTracker: join detected for ${member.user?.tag || member.id} in guild ${member.guild?.id}.`);
    const cfg = await resolveInviteConfig(member.guild);
    if (!cfg.enabled) {
        logger.warn(`InviteTracker: invite tracking is disabled for guild ${member.guild?.id} (GuildSettings.invites.enabled = false).`);
        return null;
    }

    try {
        const inviteResult = await findUsedInvite(member.guild);
        const user = member.user;
        const alt = detectAlt(member, cfg);

        let inviterUser = null;
        let record = null;

        if (inviteResult.type === 'invite' && inviteResult.inviterId) {
            try {
                inviterUser = await member.client.users.fetch(inviteResult.inviterId).catch(() => null);
            } catch {}
            record = await inviteRepository.recordJoin(
                member.guild.id,
                member.id,
                inviteResult.inviterId,
                inviteResult.code,
                alt.isAlt
            );
        } else if (inviteResult.type === 'vanity') {
            record = await inviteRepository.recordJoin(member.guild.id, member.id, null, 'VANITY', alt.isAlt);
        } else {
            record = await inviteRepository.recordJoin(
                member.guild.id,
                member.id,
                null,
                inviteResult.code || 'UNKNOWN',
                alt.isAlt
            );
        }

        const stats = record?.stats || null;
        const isRejoin = Boolean(record?.isRejoin);

        // Credit resolution: a rejoin through an unknown link keeps the old inviter.
        if (!inviterUser && record?.inviterId) {
            inviterUser = await member.client.users.fetch(record.inviterId).catch(() => null);
        }

        await dispatchInviteJoinLog(member, inviteResult, inviterUser, stats, alt, isRejoin);
        await announceJoin(member, cfg, inviteResult, inviterUser, stats, alt, isRejoin);

        return { inviteResult, inviterUser, stats, isFake: alt.isAlt, alt, isRejoin };
    } catch (err) {
        logger.error(`InviteTracker: handleMemberJoin error for ${member.id}: ${err.message}`);
        return null;
    }
}

async function handleMemberLeave(member) {
    const cfg = await resolveInviteConfig(member.guild);
    if (!cfg.enabled || !cfg.trackLeaves) return;

    try {
        const result = await inviteRepository.recordLeave(member.guild.id, member.id);
        if (!result.inviterId) return;

        let inviterUser = null;
        try {
            inviterUser = await member.client.users.fetch(result.inviterId).catch(() => null);
        } catch {}

        if (!result.alreadyCounted) {
            await dispatchInviteLeaveLog(member, inviterUser, result.stats, result.isFake);
            await announceLeave(member, cfg, inviterUser, result.stats);
        }
    } catch (err) {
        logger.error(`InviteTracker: handleMemberLeave error for ${member.id}: ${err.message}`);
    }
}

// ── Plain-text announcements ────────────────────────────────────────────────
// These are the "welcome-like" messages in the channel set by
// `/invites channel` (or `invites.logChannelId`). The Components V2 entry in
// the server-logs system stays separate and unchanged.

function fillTemplate(template, data) {
    if (typeof template !== 'string' || !template.trim()) return '';
    return template.replace(/\{([a-z0-9_]+)\}/gi, (match, key) => {
        const value = data[key.toLowerCase()];
        return value === undefined || value === null ? match : String(value);
    });
}

// Keys are lowercase because fillTemplate() looks placeholders up by their
// lowercased name — `{inviterTotal}` must resolve `invitertotal`.
function buildTemplateData(member, inviteResult, inviterUser, stats, alt) {
    const user = member.user || member;
    return {
        member: `<@${member.id}>`,
        mention: `<@${member.id}>`,
        username: user.username || 'unknown',
        tag: user.tag || user.username || 'unknown',
        userid: user.id || member.id,
        server: member.guild?.name || 'this server',
        code: inviteResult?.code || 'unknown',
        inviter: inviterUser ? `<@${inviterUser.id}>` : 'someone',
        invitername: inviterUser?.username || 'someone',
        invitertotal: stats?.total ?? 0,
        total: stats?.total ?? 0,
        regular: stats?.regular ?? 0,
        left: stats?.left ?? 0,
        rejoins: stats?.rejoins ?? 0,
        joins: stats?.joins ?? 0,
        bonus: stats?.bonus ?? 0,
        alts: stats?.fake ?? 0,
        altreason: alt?.reasons?.length ? alt.reasons.join('; ') : 'possible alt account'
    };
}

function pickJoinTemplate(cfg, inviteResult, alt, isRejoin) {
    if (alt?.isAlt && cfg.altJoinMessage) return cfg.altJoinMessage;
    if (isRejoin && cfg.rejoinMessage) return cfg.rejoinMessage;
    if (inviteResult?.type === 'invite') return cfg.joinMessage;
    if (inviteResult?.type === 'vanity') return cfg.vanityJoinMessage;
    return cfg.unknownJoinMessage;
}

async function resolveAnnouncementChannel(guild, cfg) {
    const candidates = [cfg.logChannelId, cfg.configChannelId]
        .map(id => (id ? String(id) : ''))
        .filter((id, index, list) => id && list.indexOf(id) === index);

    if (candidates.length === 0) {
        logger.warn(`InviteTracker: no announcement channel configured for guild ${guild.id} (set invites.logChannelId or run /invites channel).`);
        return null;
    }

    for (const channelId of candidates) {
        const channel = await withRetry(
            () => guild.channels.fetch(channelId),
            { attempts: 2 }
        ).catch(() => null);

        if (!channel) {
            logger.warn(`InviteTracker: announcement channel ${channelId} does not exist in guild ${guild.id}.`);
            continue;
        }
        if (!channel.isTextBased?.() || !channel.viewable) {
            logger.warn(`InviteTracker: cannot post in channel ${channelId} (guild ${guild.id}) — check View Channel / Send Messages for the bot.`);
            continue;
        }
        return channel;
    }

    return null;
}

/** Sends a plain-text announcement. Returns the channel used, or null. */
async function sendAnnouncement(guild, cfg, text) {
    if (!text) return null;
    const channel = await resolveAnnouncementChannel(guild, cfg);
    if (!channel) return null;

    try {
        await withRetry(() => channel.send({
            content: text,
            allowedMentions: { parse: ['users'] }
        }), { attempts: 2 });
        logger.info(`InviteTracker: announcement sent to #${channel.name} (${channel.id}) in guild ${guild.id}.`);
        return channel;
    } catch (err) {
        logger.error(`InviteTracker: announcement failed in ${guild.id}: ${err.message}`);
        return null;
    }
}

async function announceJoin(member, cfg, inviteResult, inviterUser, stats, alt, isRejoin) {
    const template = pickJoinTemplate(cfg, inviteResult, alt, isRejoin);
    if (!template) return;
    const text = fillTemplate(template, buildTemplateData(member, inviteResult, inviterUser, stats, alt));
    await sendAnnouncement(member.guild, cfg, text);
}

async function announceLeave(member, cfg, inviterUser, stats) {
    const template = cfg.leaveMessage;
    if (!template) return;
    const text = fillTemplate(
        template,
        buildTemplateData(member, { code: null }, inviterUser, stats, null)
    );
    await sendAnnouncement(member.guild, cfg, text);
}

// ── Server-log entries (Components V2, unchanged channel plumbing) ──────────

async function dispatchInviteJoinLog(member, inviteResult, inviterUser, stats, alt, isRejoin) {
    const guild = member.guild;
    const user = member.user;
    const isAlt = Boolean(alt?.isAlt);

    let title = isRejoin ? 'Member Rejoined via Invite' : 'Member Joined via Invite';
    let emoji = isRejoin ? '🔁' : '📨';
    let accent = isRejoin ? 0xFEE75C : 0x57F287; // yellow / green

    const fields = [
        { label: 'Member', value: userLine(user, member) }
    ];

    if (inviteResult.type === 'invite' || (isRejoin && inviterUser)) {
        const inviterLine = inviterUser
            ? `<@${inviterUser.id}> (\`${inviterUser.tag}\`)`
            : `\`${inviteResult.inviterId || 'unknown'}\``;
        fields.push({ label: isRejoin ? 'Originally invited by' : 'Invited by', value: inviterLine });
        fields.push({ label: 'Invite code', value: `\`${inviteResult.code || 'unknown'}\`${inviteResult.uses ? ` (Uses: ${inviteResult.uses})` : ''}` });

        if (stats) {
            fields.push({
                label: 'Inviter stats',
                value: `**${stats.total}** total (${stats.regular} regular, ${stats.rejoins} rejoins, ${stats.left} left, ${stats.bonus} bonus)`
            });
        }
    } else if (inviteResult.type === 'vanity') {
        title = isRejoin ? 'Member Rejoined via Vanity URL' : 'Member Joined via Vanity URL';
        emoji = '🔗';
        accent = 0x00AFF4;
        fields.push({ label: 'Vanity code', value: `discord.gg/${inviteResult.code || 'vanity'}` });
        if (stats) {
            fields.push({
                label: 'Inviter stats',
                value: `**${stats.total}** total (${stats.regular} regular, ${stats.rejoins} rejoins, ${stats.left} left, ${stats.bonus} bonus)`
            });
        }
    } else {
        title = isRejoin ? 'Member Rejoined (Unknown Invite)' : 'Member Joined (Unknown Invite)';
        emoji = '❓';
        accent = 0x95A5A6;
        fields.push({ label: 'Invite source', value: 'OAuth, Discord discovery, or vanity URL' });
    }

    if (isAlt) {
        fields.push({
            label: '⚠️ Alt / fake check',
            value: alt.reasons?.length ? alt.reasons.join('; ') : 'flagged as a possible alt account'
        });
    }

    fields.push({ label: 'Account created', value: fmtTimestamp(user.createdTimestamp, 'R') });

    await sendLog(guild, 'invite', {
        emoji,
        title,
        accent,
        thumbnailUrl: avatarUrlOf(user),
        fields,
        footer: `ID: ${user.id} • ${new Date().toISOString()}`
    });
}

async function dispatchInviteLeaveLog(member, inviterUser, stats, isFake) {
    const guild = member.guild;
    const user = member.user || member;

    const fields = [
        { label: 'Member', value: userLine(user, member) }
    ];

    if (inviterUser) {
        fields.push({ label: 'Originally invited by', value: `<@${inviterUser.id}> (\`${inviterUser.tag}\`)` });
    }

    if (stats) {
        fields.push({
            label: 'Inviter updated stats',
            value: `**${stats.total}** total (${stats.regular} regular, ${stats.rejoins} rejoins, ${stats.left} left, ${stats.bonus} bonus)`
        });
    }

    if (isFake) {
        fields.push({ label: '⚠️ Alt / fake', value: 'This member was originally flagged as a possible alt.' });
    }

    await sendLog(guild, 'invite', {
        emoji: '📤',
        title: 'Member Left (Invite Updated)',
        accent: 0xFEE75C,
        thumbnailUrl: avatarUrlOf(user),
        fields,
        footer: `ID: ${member.id} • ${new Date().toISOString()}`
    });
}

module.exports = {
    getInviteConfig,
    resolveInviteConfig,
    handleMemberJoin,
    handleMemberLeave,
    sendAnnouncement,
    fillTemplate,
    buildTemplateData
};
