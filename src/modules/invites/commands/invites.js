const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder
} = require('discord.js');
const inviteRepository = require('../../../database/repositories/inviteRepository');
const { cacheGuildInvites } = require('../services/inviteCache');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('View and manage invite statistics.')
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
            sub.setName('add')
                .setDescription('Add bonus invites to a member (Admin/Manage Server only).')
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
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: '❌ This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'user') {
            await handleUserStats(interaction);
        } else if (subcommand === 'leaderboard') {
            await handleLeaderboard(interaction);
        } else if (subcommand === 'add') {
            await handleAddBonus(interaction);
        } else if (subcommand === 'remove') {
            await handleRemoveBonus(interaction);
        } else if (subcommand === 'reset') {
            await handleReset(interaction);
        } else if (subcommand === 'sync') {
            await handleSync(interaction);
        }
    }
};

async function handleUserStats(interaction) {
    await interaction.deferReply();
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
        `> 🟢 **Regular:** \`${stats.regular}\` *(Active joined members)*`,
        `> 🔴 **Left:** \`${stats.left}\` *(Members who left)*`,
        `> 🎁 **Bonus:** \`${stats.bonus}\` *(Added by staff)*`,
        `> ⚠️ **Fake:** \`${stats.fake}\` *(Accounts younger than 3 days)*`
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
    await interaction.deferReply();
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
            return `${rankLabel} <@${entry.userId}> — **${entry.total}** invites \`(${entry.regular} regular, ${entry.left} left, ${entry.bonus} bonus)\``;
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

async function handleAddBonus(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ You need the **Manage Server** permission to add bonus invites.',
            flags: MessageFlags.Ephemeral
        });
    }

    const target = interaction.options.getUser('target', true);
    const amount = interaction.options.getInteger('amount', true);

    const stats = await inviteRepository.addBonus(interaction.guild.id, target.id, amount);

    return interaction.reply({
        content: `✅ Successfully added **+${amount}** bonus invites to ${target}! They now have **${stats.total}** total invites.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleRemoveBonus(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ You need the **Manage Server** permission to remove bonus invites.',
            flags: MessageFlags.Ephemeral
        });
    }

    const target = interaction.options.getUser('target', true);
    const amount = interaction.options.getInteger('amount', true);

    const stats = await inviteRepository.removeBonus(interaction.guild.id, target.id, amount);

    return interaction.reply({
        content: `✅ Successfully removed **${amount}** bonus invites from ${target}! They now have **${stats.total}** total invites.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleReset(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ You need **Administrator** permission to reset invite statistics.',
            flags: MessageFlags.Ephemeral
        });
    }

    const target = interaction.options.getUser('target', true);
    await inviteRepository.resetStats(interaction.guild.id, target.id);

    return interaction.reply({
        content: `✅ Successfully reset all invite statistics for ${target}.`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleSync(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: '❌ You need **Manage Server** permission to re-synchronize invites.',
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await cacheGuildInvites(interaction.guild);

    return interaction.editReply({
        content: `✅ Successfully re-synchronized invite cache for **${interaction.guild.name}**!`
    });
}
