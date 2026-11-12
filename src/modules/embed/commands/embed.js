const {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    ChannelType,
    PermissionFlagsBits,
    AttachmentBuilder
} = require('discord.js');
const logger = require('../../../core/logger');
const { getEmbedBuilderConfig } = require('../config');
const { createSession } = require('../services/sessionStore');
const { buildDashboard } = require('../services/dashboard');
const { canUseEmbed, DENY_MESSAGE } = require('../services/permissions');
const { resolveColor } = require('../services/colorHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Feature-rich Embed & Message Creation Suite.')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Quickly create and send a beautiful rich embed message.')
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('The main message text / description (supports markdown)')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('title')
                        .setDescription('Embed title')
                        .setRequired(false)
                )
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to send embed to (defaults to current channel)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
                .addStringOption(opt =>
                    opt.setName('color')
                        .setDescription('Preset accent color')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Blurple (Default)', value: 'blurple' },
                            { name: 'Red', value: 'red' },
                            { name: 'Green', value: 'green' },
                            { name: 'Gold / Yellow', value: 'gold' },
                            { name: 'Purple', value: 'purple' },
                            { name: 'Pink', value: 'pink' },
                            { name: 'Cyan', value: 'cyan' },
                            { name: 'Dark', value: 'dark' },
                            { name: 'White', value: 'white' }
                        )
                )
                .addStringOption(opt =>
                    opt.setName('custom_color')
                        .setDescription('Custom hex color code (e.g. #FF5500)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('image')
                        .setDescription('Large banner image URL (http/https)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('thumbnail')
                        .setDescription('Top-right thumbnail image URL')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('author')
                        .setDescription('Author header text')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('footer')
                        .setDescription('Footer text')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('url')
                        .setDescription('URL linked to title')
                        .setRequired(false)
                )
                .addBooleanOption(opt =>
                    opt.setName('timestamp')
                        .setDescription('Include current date/timestamp in footer')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('mention')
                        .setDescription('Add a ping above the embed')
                        .setRequired(false)
                        .addChoices(
                            { name: 'None', value: 'none' },
                            { name: '@everyone', value: '@everyone' },
                            { name: '@here', value: '@here' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('builder')
                .setDescription('Launch the interactive Components V2 dashboard message builder.')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel to send the built message to (defaults to current channel)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand(sub =>
            sub.setName('json')
                .setDescription('Import and send an embed from raw Discohook or Discord JSON.')
                .addStringOption(opt =>
                    opt.setName('data')
                        .setDescription('Raw JSON embed code (paste from discohook.org or JSON)')
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Target channel (defaults to current channel)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
                .addStringOption(opt =>
                    opt.setName('mention')
                        .setDescription('Add a ping above the embed')
                        .setRequired(false)
                        .addChoices(
                            { name: 'None', value: 'none' },
                            { name: '@everyone', value: '@everyone' },
                            { name: '@here', value: '@here' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('Edit an existing embed sent by the bot.')
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('The ID of the message to edit')
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel where the message is located')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('New description text')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('title')
                        .setDescription('New title')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('color')
                        .setDescription('New color (preset name or hex #RRGGBB)')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('image')
                        .setDescription('New image URL')
                        .setRequired(false)
                )
                .addStringOption(opt =>
                    opt.setName('json')
                        .setDescription('New raw JSON payload (replaces entire embed)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('raw')
                .setDescription('Export the raw JSON of an existing bot embed message.')
                .addStringOption(opt =>
                    opt.setName('message_id')
                        .setDescription('The ID of the message to inspect')
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel where the message is located')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: '❌ This command can only be used inside a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        const builderConfig = getEmbedBuilderConfig();
        const access = await canUseEmbed(interaction, builderConfig);
        if (!access.ok) {
            return interaction.reply({ content: DENY_MESSAGE, flags: MessageFlags.Ephemeral });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'create') {
            return await handleCreate(interaction);
        } else if (sub === 'builder') {
            return await handleBuilder(interaction, builderConfig);
        } else if (sub === 'json') {
            return await handleJson(interaction);
        } else if (sub === 'edit') {
            return await handleEdit(interaction);
        } else if (sub === 'raw') {
            return await handleRaw(interaction);
        }
    }
};

async function handleCreate(interaction) {
    const description = interaction.options.getString('description', true);
    const title = interaction.options.getString('title');
    const colorChoice = interaction.options.getString('custom_color') || interaction.options.getString('color') || 'blurple';
    const image = interaction.options.getString('image');
    const thumbnail = interaction.options.getString('thumbnail');
    const author = interaction.options.getString('author');
    const footer = interaction.options.getString('footer');
    const url = interaction.options.getString('url');
    const timestamp = interaction.options.getBoolean('timestamp');
    const mention = interaction.options.getString('mention');
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    if (!targetChannel.isTextBased() || !targetChannel.viewable) {
        return interaction.reply({ content: '❌ Selected channel is not available.', flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
        .setDescription(description.replace(/\\n/g, '\n'))
        .setColor(resolveColor(colorChoice));

    if (title) embed.setTitle(title);
    if (url && isValidHttpUrl(url)) embed.setURL(url);
    if (image && isValidHttpUrl(image)) embed.setImage(image);
    if (thumbnail && isValidHttpUrl(thumbnail)) embed.setThumbnail(thumbnail);
    if (author) embed.setAuthor({ name: author });
    if (footer) embed.setFooter({ text: footer });
    if (timestamp) embed.setTimestamp();

    const payload = { embeds: [embed] };
    if (mention && mention !== 'none') {
        payload.content = mention;
    }

    try {
        const sent = await targetChannel.send(payload);
        return interaction.reply({
            content: `✅ Embed successfully sent to ${targetChannel}! [Jump to message](${sent.url})`,
            flags: MessageFlags.Ephemeral
        });
    } catch (err) {
        logger.error(`Embed create failed: ${err.message}`);
        return interaction.reply({
            content: `❌ Failed to send embed: ${err.message}`,
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleBuilder(interaction, builderConfig) {
    const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!targetChannel || !targetChannel.isTextBased() || !targetChannel.viewable) {
        return interaction.reply({ content: '❌ That channel is not available for sending messages.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const session = createSession({
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            channelId: targetChannel.id,
            timeoutMs: builderConfig.sessionTimeoutMs
        });

        const { buildExpiredNotice } = require('../services/dashboard');
        const { expireSession } = require('../services/sessionStore');
        clearTimeout(session.timeout);
        session.timeout = setTimeout(async () => {
            const expired = expireSession(session.id, 'timeout');
            if (!expired) return;
            try {
                const channel = await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
                const message = channel && session.messageId
                    ? await channel.messages.fetch(session.messageId).catch(() => null)
                    : null;
                if (message) await message.edit(buildExpiredNotice());
            } catch (error) {
                logger.warn(`Embed builder expiry edit failed: ${error.message}`);
            }
        }, builderConfig.sessionTimeoutMs);

        const reply = await interaction.editReply(buildDashboard(session, interaction.member));
        session.messageId = reply?.id || null;
    } catch (error) {
        logger.error(`/embed failed: ${error.stack || error}`);
        await interaction.editReply('❌ Could not open the message builder. Please try again.');
    }
}

async function handleJson(interaction) {
    const rawData = interaction.options.getString('data', true);
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const mention = interaction.options.getString('mention');

    if (!targetChannel.isTextBased() || !targetChannel.viewable) {
        return interaction.reply({ content: '❌ Target channel is not accessible.', flags: MessageFlags.Ephemeral });
    }

    let parsed;
    try {
        parsed = JSON.parse(rawData);
    } catch (err) {
        return interaction.reply({
            content: `❌ Invalid JSON format: \`${err.message}\`\nPlease check your JSON syntax (e.g. from discohook.org).`,
            flags: MessageFlags.Ephemeral
        });
    }

    const payload = {};
    if (mention && mention !== 'none') {
        payload.content = mention;
    } else if (parsed.content) {
        payload.content = parsed.content;
    }

    if (Array.isArray(parsed.embeds)) {
        payload.embeds = parsed.embeds.map(e => EmbedBuilder.from(e));
    } else if (parsed.title || parsed.description || parsed.fields) {
        payload.embeds = [EmbedBuilder.from(parsed)];
    }

    try {
        const sent = await targetChannel.send(payload);
        return interaction.reply({
            content: `✅ JSON Embed successfully posted in ${targetChannel}! [Jump to message](${sent.url})`,
            flags: MessageFlags.Ephemeral
        });
    } catch (err) {
        logger.error(`Embed JSON send failed: ${err.message}`);
        return interaction.reply({
            content: `❌ Failed to send embed: ${err.message}`,
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleEdit(interaction) {
    const messageId = interaction.options.getString('message_id', true);
    const channel = interaction.options.getChannel('channel', true);
    const newDesc = interaction.options.getString('description');
    const newTitle = interaction.options.getString('title');
    const newColor = interaction.options.getString('color');
    const newImage = interaction.options.getString('image');
    const rawJson = interaction.options.getString('json');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (!msg) {
            return interaction.editReply(`❌ Message with ID \`${messageId}\` not found in ${channel}.`);
        }
        if (msg.author.id !== interaction.client.user.id) {
            return interaction.editReply('❌ I can only edit messages that were sent by me.');
        }

        if (rawJson) {
            const parsed = JSON.parse(rawJson);
            const payload = {};
            if (parsed.content !== undefined) payload.content = parsed.content;
            if (Array.isArray(parsed.embeds)) {
                payload.embeds = parsed.embeds.map(e => EmbedBuilder.from(e));
            } else if (parsed.title || parsed.description) {
                payload.embeds = [EmbedBuilder.from(parsed)];
            }
            await msg.edit(payload);
            return interaction.editReply(`✅ Successfully updated message [${messageId}](${msg.url}) with new JSON!`);
        }

        const existingEmbed = msg.embeds?.[0];
        const embed = existingEmbed ? EmbedBuilder.from(existingEmbed) : new EmbedBuilder();

        if (newDesc) embed.setDescription(newDesc.replace(/\\n/g, '\n'));
        if (newTitle) embed.setTitle(newTitle);
        if (newColor) embed.setColor(resolveColor(newColor));
        if (newImage && isValidHttpUrl(newImage)) embed.setImage(newImage);

        await msg.edit({ embeds: [embed] });
        return interaction.editReply(`✅ Successfully edited embed in [message](${msg.url})!`);
    } catch (err) {
        logger.error(`Embed edit error: ${err.message}`);
        return interaction.editReply(`❌ Failed to edit message: ${err.message}`);
    }
}

async function handleRaw(interaction) {
    const messageId = interaction.options.getString('message_id', true);
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (!msg) {
            return interaction.editReply(`❌ Message with ID \`${messageId}\` not found in ${channel}.`);
        }

        const raw = {
            content: msg.content || null,
            embeds: msg.embeds.map(e => e.toJSON())
        };

        const jsonString = JSON.stringify(raw, null, 2);

        if (jsonString.length < 1900) {
            return interaction.editReply(`\`\`\`json\n${jsonString}\n\`\`\``);
        }

        const attachment = new AttachmentBuilder(Buffer.from(jsonString, 'utf-8'), { name: `embed-${messageId}.json` });
        return interaction.editReply({
            content: '📄 Raw embed JSON is attached below:',
            files: [attachment]
        });
    } catch (err) {
        logger.error(`Embed raw fetch error: ${err.message}`);
        return interaction.editReply(`❌ Failed to fetch message: ${err.message}`);
    }
}

function isValidHttpUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}
