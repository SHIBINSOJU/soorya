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
const { formatDuration, createProgressBar } = require('../services/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show details of the song currently playing.'),

    async execute(interaction) {
        if (!interaction.inGuild()) return;

        const kazagumo = getKazagumo();
        const player = kazagumo?.players.get(interaction.guild.id);
        if (!player || !player.queue.current) {
            return interaction.reply({
                content: '❌ Nothing is currently playing.',
                flags: MessageFlags.Ephemeral
            });
        }

        const track = player.queue.current;
        const position = player.position || 0;
        const total = track.length || 0;
        const progressBar = createProgressBar(position, total, 16);

        const container = new ContainerBuilder().setAccentColor(0x5865F2);

        const section = new SectionBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## 🎵 Now Playing\n**[${track.title}](${track.uri})**`)
        );
        if (track.thumbnail) {
            section.setThumbnailAccessory(new ThumbnailBuilder().setURL(track.thumbnail));
        }
        container.addSectionComponents(section);

        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );

        const statusEmoji = player.paused ? '⏸️' : '▶️';
        const loopMode = player.loop === 'track' ? '🔂 Track' : player.loop === 'queue' ? '🔁 Queue' : 'Off';

        const lines = [
            `👤 **Author:** ${track.author || 'Unknown'}`,
            `⏱️ **Time:** \`${formatDuration(position)} / ${formatDuration(total)}\``,
            `> ${statusEmoji} ${progressBar}`,
            '',
            `🔊 **Volume:** \`${player.volume}%\` • 🔁 **Loop:** \`${loopMode}\``,
            `🙋 **Requested by:** <@${track.requester?.id || player.requester?.id || 'unknown'}>`
        ];

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

        return interaction.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [container]
        });
    }
};
