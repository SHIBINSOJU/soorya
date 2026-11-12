const {
    SlashCommandBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder
} = require('discord.js');
const { getKazagumo } = require('../services/lavalinkManager');
const { formatDuration } = require('../services/musicUtils');
const configService = require('../../../core/configService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist from YouTube, SoundCloud, or URL.')
        .addStringOption(opt =>
            opt.setName('query')
                .setDescription('The song name, artist, or URL to play')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: '❌ This command can only be used in a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({
                content: '❌ You must be connected to a voice channel to play music.',
                flags: MessageFlags.Ephemeral
            });
        }

        const permissions = voiceChannel.permissionsFor(interaction.guild.members.me);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({
                content: '❌ I do not have permission to **Connect** or **Speak** in your voice channel.',
                flags: MessageFlags.Ephemeral
            });
        }

        const kazagumo = getKazagumo();
        if (!kazagumo) {
            return interaction.reply({
                content: '❌ Music system is currently initializing or Lavalink is unavailable.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply();

        const query = interaction.options.getString('query', true);
        const searchResult = await kazagumo.search(query, { requester: interaction.user });

        if (!searchResult || !searchResult.tracks || searchResult.tracks.length === 0) {
            return interaction.editReply({
                content: `❌ No results found for: \`${query}\``
            });
        }

        let player = kazagumo.players.get(interaction.guild.id);
        const defaultVolume = configService.get('music.defaultVolume', 80);

        if (!player) {
            player = await kazagumo.createPlayer({
                guildId: interaction.guild.id,
                textId: interaction.channel.id,
                voiceId: voiceChannel.id,
                deaf: true,
                volume: defaultVolume
            });
        }

        const container = new ContainerBuilder().setAccentColor(0x5865F2);

        if (searchResult.type === 'PLAYLIST') {
            for (const track of searchResult.tracks) {
                player.queue.add(track);
            }

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## 📑 Playlist Enqueued\n**${searchResult.playlistName || 'Playlist'}**`)
            );
            container.addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent([
                    `🎶 **Tracks added:** \`${searchResult.tracks.length}\``,
                    `🔊 **Voice channel:** ${voiceChannel}`,
                    `🙋 **Requested by:** ${interaction.user}`
                ].join('\n'))
            );
        } else {
            const track = searchResult.tracks[0];
            player.queue.add(track);

            const section = new SectionBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## 🎵 Added to Queue\n**[${track.title}](${track.uri})**`)
            );
            if (track.thumbnail) {
                section.setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail));
            }
            container.addSectionComponents(section);

            container.addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent([
                    `👤 **Author:** ${track.author || 'Unknown'}`,
                    `⏱️ **Duration:** \`${formatDuration(track.length)}\``,
                    `📊 **Position in queue:** \`#${player.queue.length}\``,
                    `🔊 **Voice channel:** ${voiceChannel}`
                ].join('\n'))
            );
        }

        if (!player.playing && !player.paused) {
            await player.play();
        }

        return interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [container]
        });
    }
};
