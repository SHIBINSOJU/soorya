const logger = require('../../../core/logger');
const configService = require('../../../core/configService');
const inviteRepository = require('../../../database/repositories/inviteRepository');
const { findUsedInvite } = require('./inviteCache');
const { sendLog } = require('../../logs/services/logDispatcher');
const { avatarUrlOf, fmtTimestamp, userLine } = require('../../logs/services/logBuilders');

function getInviteConfig() {
    return configService.get('invites', {
        enabled: true,
        logChannelId: '',
        minAccountAgeDays: 3,
        trackLeaves: true,
        joinMessage: '📥 **{member}** joined using invite code `{code}` from **{inviter}** (now has **{inviterTotal}** invites)!',
        leaveMessage: '📤 **{member}** left. They were invited by **{inviter}** (now has **{inviterTotal}** invites).'
    });
}

async function handleMemberJoin(member) {
    const cfg = getInviteConfig();
    if (!cfg.enabled) return null;

    try {
        const inviteResult = await findUsedInvite(member.guild);
        const user = member.user;

        // Check account age (fake protection)
        const accountAgeDays = user.createdTimestamp ? (Date.now() - user.createdTimestamp) / (1000 * 60 * 60 * 24) : 999;
        const minAge = typeof cfg.minAccountAgeDays === 'number' ? cfg.minAccountAgeDays : 3;
        const isFake = minAge > 0 && accountAgeDays < minAge;

        let inviterUser = null;
        let stats = null;

        if (inviteResult.type === 'invite' && inviteResult.inviterId) {
            try {
                inviterUser = await member.client.users.fetch(inviteResult.inviterId).catch(() => null);
            } catch {}
            stats = await inviteRepository.recordJoin(
                member.guild.id,
                member.id,
                inviteResult.inviterId,
                inviteResult.code,
                isFake
            );
        } else if (inviteResult.type === 'vanity') {
            await inviteRepository.recordJoin(member.guild.id, member.id, null, 'VANITY', false);
        } else {
            await inviteRepository.recordJoin(member.guild.id, member.id, null, 'UNKNOWN', false);
        }

        // Send log entry
        await dispatchInviteJoinLog(member, inviteResult, inviterUser, stats, isFake);

        return { inviteResult, inviterUser, stats, isFake };
    } catch (err) {
        logger.error(`InviteTracker: handleMemberJoin error for ${member.id}: ${err.message}`);
        return null;
    }
}

async function handleMemberLeave(member) {
    const cfg = getInviteConfig();
    if (!cfg.enabled || !cfg.trackLeaves) return;

    try {
        const { inviterId, stats } = await inviteRepository.recordLeave(member.guild.id, member.id);
        if (!inviterId) return;

        let inviterUser = null;
        try {
            inviterUser = await member.client.users.fetch(inviterId).catch(() => null);
        } catch {}

        await dispatchInviteLeaveLog(member, inviterUser, stats);
    } catch (err) {
        logger.error(`InviteTracker: handleMemberLeave error for ${member.id}: ${err.message}`);
    }
}

async function dispatchInviteJoinLog(member, inviteResult, inviterUser, stats, isFake) {
    const guild = member.guild;
    const user = member.user;

    let title = 'Member Joined via Invite';
    let emoji = '📨';
    let accent = 0x57F287; // green

    const fields = [
        { label: 'Member', value: userLine(user, member) }
    ];

    if (inviteResult.type === 'invite') {
        const inviterLine = inviterUser ? `<@${inviterUser.id}> (\`${inviterUser.tag}\`)` : `\`${inviteResult.inviterId || 'unknown'}\``;
        fields.push({ label: 'Invited by', value: inviterLine });
        fields.push({ label: 'Invite code', value: `\`${inviteResult.code}\` (Uses: ${inviteResult.uses || 1})` });

        if (stats) {
            const fakeNote = isFake ? ' ⚠️ *(Account < 3 days old)*' : '';
            fields.push({
                label: 'Inviter stats',
                value: `**${stats.total}** total (${stats.regular} regular, ${stats.left} left, ${stats.bonus} bonus)${fakeNote}`
            });
        }
    } else if (inviteResult.type === 'vanity') {
        title = 'Member Joined via Vanity URL';
        emoji = '🔗';
        accent = 0x00AFF4;
        fields.push({ label: 'Vanity code', value: `discord.gg/${inviteResult.code || 'vanity'}` });
    } else {
        title = 'Member Joined (Unknown Invite)';
        emoji = '❓';
        accent = 0x95A5A6;
        fields.push({ label: 'Invite source', value: 'OAuth, Discord discovery, or vanity URL' });
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

async function dispatchInviteLeaveLog(member, inviterUser, stats) {
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
            value: `**${stats.total}** total (${stats.regular} regular, ${stats.left} left, ${stats.bonus} bonus)`
        });
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
    handleMemberJoin,
    handleMemberLeave
};
