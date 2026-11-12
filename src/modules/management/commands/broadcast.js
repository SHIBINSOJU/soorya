const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
    ChannelType
} = require('discord.js');
const logger = require('../../../core/logger');
const { canManage, MANAGE_DENY } = require('../services/access');
const { resolveColor } = require('../../embed/services/colorHelper');

// Prevent multiple mass broadcasts running concurrently in the same server
const activeBroadcasts = new Set();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isValidHttpUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('broadcast')
        .setDescription('Mass broadcast messages or rich embeds to members DMs or server channels.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('dm')
                .setDescription('Broadcast a direct message (DM) to all server members or a specific role.')
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('The message content to send')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('title')
                        .setDescription('Embed title (leave empty to send as regular text message)')
                        .setRequired(false)
                )
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Only DM members with this role (omit to DM all server members)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('color')
                        .setDescription('Embed accent color (preset name or hex code #RRGGBB)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Blurple', value: 'blurple' },
                            { name: 'Red', value: 'red' },
                            { name: 'Green', value: 'green' },
                            { name: 'Gold / Yellow', value: 'gold' },
                            { name: 'Purple', value: 'purple' },
                            { name: 'Pink', value: 'pink' },
                            { name: 'Cyan', value: 'cyan' },
                            { name: 'Dark', value: 'dark' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('image')
                        .setDescription('Banner image URL for the embed')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('channel')
                .setDescription('Broadcast an announcement or embed to a specific channel.')
                .addStringOption(opt =>
                    opt.setName('message')
                        .setDescription('The message content / description')
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt.setName('target_channel')
                        .setDescription('Channel to broadcast to (defaults to current channel)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
                .addStringOption(opt =>
                    opt.setName('title')
                        .setDescription('Embed title (omit to send as plain text)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('mention')
                        .setDescription('Add a mention ping')
                        .setRequired(false)
                        .addChoices(
                            { name: 'None', value: 'none' },
                            { name: '@everyone', value: '@everyone' },
                            { name: '@here', value: '@here' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('color')
                        .setDescription('Embed accent color')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Blurple', value: 'blurple' },
                            { name: 'Red', value: 'red' },
                            { name: 'Green', value: 'green' },
                            { name: 'Gold / Yellow', value: 'gold' },
                            { name: 'Purple', value: 'purple' },
                            { name: 'Pink', value: 'pink' },
                            { name: 'Cyan', value: 'cyan' },
                            { name: 'Dark', value: 'dark' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('image')
                        .setDescription('Banner image URL')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: '❌ This command can only be used inside a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        const access = await canManage(interaction);
        if (!access.ok) {
            return interaction.reply({ content: MANAGE_DENY, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'dm') {
            return await handleDmBroadcast(interaction);
        } else if (sub === 'channel') {
            return await handleChannelBroadcast(interaction);
        }
    }
};

async function handleDmBroadcast(interaction) {
    const guild = interaction.guild;
    if (activeBroadcasts.has(guild.id)) {
        return interaction.reply({
            content: '⏳ A mass DM broadcast is already in progress for this server. Please wait until it completes.',
            flags: MessageFlags.Ephemeral
        });
    }

    const messageText = interaction.options.getString('message', true).replace(/\\n/g, '\n');
    const title = interaction.options.getString('title');
    const roleFilter = interaction.options.getRole('role');
    const colorChoice = interaction.options.getString('color') || 'blurple';
    const image = interaction.options.getString('image');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let members;
    try {
        members = await guild.members.fetch();
    } catch (err) {
        logger.error(`Broadcast member fetch error: ${err.message}`);
        return interaction.editReply(`❌ Failed to fetch server members: ${err.message}`);
    }

    // Filter targets: humans only (skip bots) + optional role filter
    const targets = members.filter(m => {
        if (m.user.bot) return false;
        if (roleFilter && !m.roles.cache.has(roleFilter.id)) return false;
        return true;
    });

    if (targets.size === 0) {
        return interaction.editReply('❌ No eligible members found to receive this broadcast.');
    }

    activeBroadcasts.add(guild.id);

    // Build payload: embed or plain text
    let payload;
    if (title || image) {
        const embed = new EmbedBuilder()
            .setDescription(messageText)
            .setColor(resolveColor(colorChoice))
            .setFooter({ text: `Sent from ${guild.name}` })
            .setTimestamp();

        if (title) embed.setTitle(title);
        if (image && isValidHttpUrl(image)) embed.setImage(image);
        payload = { embeds: [embed] };
    } else {
        payload = {
            content: `📢 **Announcement from ${guild.name}**\n\n${messageText}`
        };
    }

    await interaction.editReply({
        content: `🚀 **Mass DM broadcast started!**\nTargeting **${targets.size}** members${roleFilter ? ` with role ${roleFilter}` : ''}.\n\nProgress will be reported here when completed...`
    });

    let sent = 0;
    let failed = 0;
    const startTime = Date.now();

    // Send with gentle delay (1200ms) to respect Discord gateway rate limits
    for (const [id, member] of targets) {
        try {
            await member.send(payload);
            sent++;
        } catch {
            failed++;
        }
        await delay(1200);
    }

    activeBroadcasts.delete(guild.id);
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);

    return interaction.followUp({
        content: [
            `✅ **Mass DM Broadcast Completed!**`,
            `• **Delivered:** \`${sent}\` members`,
            `• **Failed (DMs closed/blocked):** \`${failed}\` members`,
            `• **Total Targeted:** \`${targets.size}\``,
            `• **Duration:** \`${elapsedSec}\` seconds`
        ].join('\n'),
        flags: MessageFlags.Ephemeral
    });
}

async function handleChannelBroadcast(interaction) {
    const messageText = interaction.options.getString('message', true).replace(/\\n/g, '\n');
    const targetChannel = interaction.options.getChannel('target_channel') || interaction.channel;
    const title = interaction.options.getString('title');
    const mention = interaction.options.getString('mention');
    const colorChoice = interaction.options.getString('color') || 'blurple';
    const image = interaction.options.getString('image');

    if (!targetChannel.isTextBased() || !targetChannel.viewable) {
        return interaction.reply({
            content: '❌ Target channel is not available for sending messages.',
            flags: MessageFlags.Ephemeral
        });
    }

    const payload = {};
    if (mention && mention !== 'none') {
        payload.content = mention;
    }

    if (title || image) {
        const embed = new EmbedBuilder()
            .setDescription(messageText)
            .setColor(resolveColor(colorChoice))
            .setFooter({ text: interaction.guild.name })
            .setTimestamp();

        if (title) embed.setTitle(title);
        if (image && isValidHttpUrl(image)) embed.setImage(image);
        payload.embeds = [embed];
    } else {
        if (!payload.content) {
            payload.content = messageText;
        } else {
            payload.content += `\n\n${messageText}`;
        }
    }

    try {
        const sent = await targetChannel.send(payload);
        return interaction.reply({
            content: `✅ Broadcast successfully sent to ${targetChannel}! [Jump to message](${sent.url})`,
            flags: MessageFlags.Ephemeral
        });
    } catch (err) {
        logger.error(`Channel broadcast error: ${err.message}`);
        return interaction.reply({
            content: `❌ Failed to send broadcast: ${err.message}`,
            flags: MessageFlags.Ephemeral
        });
    }
}
