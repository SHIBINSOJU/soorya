const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ChannelType,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder
} = require('discord.js');
const inviteRepository = require('../../../database/repositories/inviteRepository');
const guildSettingsRepository = require('../../../database/repositories/guildSettingsRepository');
const logger = require('../../../core/logger');
const { withRetry } = require('../../../utils/retry');
const { cacheGuildInvites } = require('../services/inviteCache');
const {
    resolveInviteConfig,
    sendAnnouncement,
    fillTemplate,
    buildTemplateData
} = require('../services/inviteService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('View, manage and announce invite statistics.')
        .addSubcommand(sub =>
            sub.setName('user')
                .setDescription('View your invite stats or those of another member.')
                .addUserOption(opt =>
                    opt.setName('target')
                        .setDescription('The member to check (defaults to you)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('leaderboard')
                .setDescription('View the server invite leaderboard.')
                .addIntegerOption(opt =>
                    opt.setName('page')
                        .setDescription('Leaderboard page (defaults to 1)')
                        .setMinValue(1)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('give')
                .setDescription('Give bonus invites to a member (Admin/Manage Server only).')
                .addUserOption(opt =>
                    opt.setName('target')
                        .setDescription('The member to give bonus invites to')
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('amount')
                        .setDescription('Amount of bonus invites to give')
                        .setMinValue(1)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Alias of /invites give — add bonus invites (Admin/Manage Server only).')
                .addUserOption(opt =>
                    opt.setName('target')
                        .setDescription('The member to give bonus invites to')
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('amount')
                        .setDescription('Amount of bonus invites to add')
                        .setMinValue(1)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove bonus invites from a member (Admin/Manage Server only).')
                .addUserOption(opt =>
                    opt.setName('target')
                        .setDescription('The member to remove bonus invites from')
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('amount')
                        .setDescription('Amount of bonus invites to remove')
                        .setMinValue(1)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('reset')
                .setDescription('Reset all invite statistics for a member (Admin only).')
                .addUserOption(opt =>
                    opt.setName('target')
                        .setDescription('The member whose invite stats will be reset')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('sync')
                .setDescription('Re-synchronize the server invite cache with Discord.')
        )
        .addSubcommand(sub =>
            sub.setName('test')
                .setDescription('Send a test invite announcement to the configured channel.')
        )
        .addSubcommand(sub =>
            sub.setName('channel')
                .setDescription('Set or view the channel for join/leave/rejoin/alt invite messages.')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Target channel (omit to view the current setting)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: '❌ This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        const subcommand = interaction.options.getSubcommand();
        // Stats lookups hit the database and Discord, and a stuck query used to
        // burn Discord's 3s acknowledgement window ("The application did not
        // respond"). Acknowledge first, then fill in the answer.
        const isPublic = subcommand === 'user' || subcommand === 'leaderboard';

        try {
            await withRetry(
                () => interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral }),
                { attempts: 2 }
            );
        } catch (error) {
            // 10062 = the token expired before we could acknowledge (gateway lag
            // or a stale/duplicate session). Nothing can answer it any more.
            if (error?.code === 10062) {
                logger.warn(`/invites ${subcommand}: interaction expired before acknowledgement (10062).`);
                return;
            }
            throw error;
        }

        try {
            if (subcommand === 'user') {
                await handleUserStats(interaction);
            } else if (subcommand === 'leaderboard') {
                await handleLeaderboard(interaction);
            } else if (subcommand === 'give' || subcommand === 'add') {
                await handleGiveBonus(interaction);
            } else if (subcommand === 'remove') {
                await handleRemoveBonus(interaction);
            } else if (subcommand === 'reset') {
                await handleReset(interaction);
            } else if (subcommand === 'sync') {
                await handleSync(interaction);
            } else if (subcommand === 'test') {
                await handleTest(interaction);
            } else if (subcommand === 'channel') {
                await handleChannel(interaction);
            }
        } catch (error) {
            logger.error(`/invites ${subcommand} failed: ${error.stack || error}`);
            await interaction.editReply({
                content: '❌ Could not complete that invite action. Please try again in a moment.'
            }).catch(() => { /* response window already closed */ });
        }
    }
};

function hasStaffPermission(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
}

async function handleUserStats(interaction) {
    const target = interaction.options.getUser('target') || interaction.user;
    const stats = await inviteRepository.getStats(interaction.guild.id, target.id);

    const avatarUrl = target.displayAvatarURL({ size: 256 });
    const isSelf = target.id === interaction.user.id;

    const container = new ContainerBuilder().setAccentColor(0x5865F2);

    const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## 📨 ${isSelf ? 'Your Invites' : `${target.username}'s Invites`}`)
    );
    if (avatarUrl) {
        section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
    }
    container.addSectionComponents(section);

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    const lines = [
        `### Total Invites: **${stats.total}**`,
        '',
        `> 📥 **Joins:** \`${stats.joins}\` *(all recorded joins)*`,
        `> 🟢 **Regular:** \`${stats.regular}\` *(joined, not counted as alt)*`,
        `> 🔁 **Rejoins:** \`${stats.rejoins}\` *(left and came back)*`,
        `> 🔴 **Left:** \`${stats.left}\` *(members who left)*`,
        `> ⚠️ **Alts / Fake:** \`${stats.fake}\` *(young accounts or avatar clones)*`,
        `> 🎁 **Bonus:** \`${stats.bonus}\` *(given by staff)*`
    ];

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join('\n'))
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Server: ${interaction.guild.name} • User ID: ${target.id}`)
    );

    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [container]
    });
}

async function handleLeaderboard(interaction) {
    const page = interaction.options.getInteger('page') || 1;
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    const top = await inviteRepository.getLeaderboard(interaction.guild.id, pageSize, skip);

    const container = new ContainerBuilder().setAccentColor(0x5865F2);
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## 🏆 ${interaction.guild.name} - Invite Leaderboard`)
    );
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    if (!top || top.length === 0) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                page === 1
                    ? '_No invite data recorded yet. Start inviting members to climb the leaderboard!_'
                    : `_No entries found for page ${page}._`
            )
        );
    } else {
        const medals = ['🥇', '🥈', '🥉'];
        const rows = top.map((entry, index) => {
            const rankNum = skip + index + 1;
            const rankLabel = medals[skip + index] || `**#${rankNum}**`;
            return `${rankLabel} <@${entry.userId}> — **${entry.total}** invites ` +
                `\`(${entry.regular} regular, ${entry.rejoins} rejoins, ${entry.left} left, ${entry.bonus} bonus)\``;
        });

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(rows.join('\n\n'))
        );
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Page ${page} • Use /invites user to check individual statistics`)
    );

    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [container]
    });
}

async function handleGiveBonus(interaction) {
    if (!hasStaffPermission(interaction)) {
        return interaction.editReply({
            content: '❌ You need the **Manage Server** permission to give bonus invites.',
            flags: MessageFlags.Ephemeral
        });
    }

    const target = interaction.options.getUser('target', true);
    const amount = interaction.options.getInteger('amount', true);

    const stats = await inviteRepository.addBonus(interaction.guild.id, target.id, amount);

    return interaction.editReply({
        content: `✅ Successfully gave **+${amount}** bonus invites to ${target}! They now have **${stats.total}** total invites.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleRemoveBonus(interaction) {
    if (!hasStaffPermission(interaction)) {
        return interaction.editReply({
            content: '❌ You need the **Manage Server** permission to remove bonus invites.',
            flags: MessageFlags.Ephemeral
        });
    }

    const target = interaction.options.getUser('target', true);
    const amount = interaction.options.getInteger('amount', true);

    const stats = await inviteRepository.removeBonus(interaction.guild.id, target.id, amount);

    return interaction.editReply({
        content: `✅ Successfully removed **${amount}** bonus invites from ${target}! They now have **${stats.total}** total invites.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleReset(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply({
            content: '❌ You need **Administrator** permission to reset invite statistics.',
            flags: MessageFlags.Ephemeral
        });
    }

    const target = interaction.options.getUser('target', true);
    await inviteRepository.resetStats(interaction.guild.id, target.id);

    return interaction.editReply({
        content: `✅ Successfully reset all invite statistics for ${target}.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleSync(interaction) {
    if (!hasStaffPermission(interaction)) {
        return interaction.editReply({
            content: '❌ You need **Manage Server** permission to re-synchronize invites.',
            flags: MessageFlags.Ephemeral
        });
    }

    await cacheGuildInvites(interaction.guild);

    return interaction.editReply({
        content: `✅ Successfully re-synchronized invite cache for **${interaction.guild.name}**!`
    });
}

async function handleTest(interaction) {
    if (!hasStaffPermission(interaction)) {
        return interaction.editReply({
            content: '❌ You need the **Manage Server** permission to test invite announcements.',
            flags: MessageFlags.Ephemeral
        });
    }

    const cfg = await resolveInviteConfig(interaction.guild);
    if (!cfg.enabled) {
        return interaction.editReply({
            content: '❌ Invite tracking is disabled for this server (`invites.enabled` / GuildSettings).',
            flags: MessageFlags.Ephemeral
        });
    }

    const text = fillTemplate(
        cfg.joinMessage,
        buildTemplateData(interaction.member, { type: 'invite', code: 'TEST' }, interaction.user, null, null)
    );

    const channel = await sendAnnouncement(
        interaction.guild,
        cfg,
        `${text}\n-# Test announcement from \`/invites test\`.`
    );

    if (!channel) {
        return interaction.editReply({
            content: '❌ Could not post the test announcement. Check `invites.logChannelId`, that the channel still exists, ' +
                'and that the bot can **View Channel** + **Send Messages** there (the exact reason is logged on the server).',
            flags: MessageFlags.Ephemeral
        });
    }

    return interaction.editReply({
        content: `✅ Test announcement sent to <#${channel.id}>. Join/leave messages will appear there.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleChannel(interaction) {
    if (!hasStaffPermission(interaction)) {
        return interaction.editReply({
            content: '❌ You need the **Manage Server** permission to set the invite announcement channel.',
            flags: MessageFlags.Ephemeral
        });
    }

    const channel = interaction.options.getChannel('channel');
    const cfg = await resolveInviteConfig(interaction.guild);

    if (!channel) {
        const current = cfg.logChannelId ? `<#${cfg.logChannelId}>` : '*not set*';
        return interaction.editReply({
            content: `📨 Invite announcements are currently sent to: ${current}\n` +
                'Use `/invites channel channel:#channel` to change it.',
            flags: MessageFlags.Ephemeral
        });
    }

    await guildSettingsRepository.updateGuildSettings(interaction.guild.id, {
        $set: { 'invites.channelId': channel.id }
    });

    return interaction.editReply({
        content: `✅ Invite join/leave/rejoin/alt announcements will now be sent to ${channel}.\n` +
            '-# Make sure the bot can View Channel and Send Messages there.',
        flags: MessageFlags.Ephemeral
    });
}
