const {
    SlashCommandBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize
} = require('discord.js');
const { getKazagumo } = require('../services/lavalinkManager');
const { formatDuration } = require('../services/musicUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue.')
        .addIntegerOption(opt =>
            opt.setName('page')
                .setDescription('Queue page number (default: 1)')
                .setMinValue(1)
                .setRequired(false)
        ),

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

        const current = player.queue.current;
        const queue = player.queue;
        const page = interaction.options.getInteger('page') || 1;
        const pageSize = 10;
        const totalPages = Math.max(1, Math.ceil(queue.length / pageSize));
        const start = (page - 1) * pageSize;
        const tracksOnPage = queue.slice(start, start + pageSize);

        const container = new ContainerBuilder().setAccentColor(0x5865F2);

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## 🎶 Music Queue — ${interaction.guild.name}`)
        );

        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );

        const lines = [
            `**Now Playing:**`,
            `▶️ [${current.title}](${current.uri}) \`[${formatDuration(current.length)}]\` — <@${current.requester?.id || 'unknown'}>`,
            ''
        ];

        if (queue.length === 0) {
            lines.push('_No more tracks in the queue. Add some with /play!_');
        } else {
            lines.push(`**Up Next (${queue.length} track${queue.length === 1 ? '' : 's'}):**`);
            tracksOnPage.forEach((t, i) => {
                const index = start + i + 1;
                lines.push(`\`${index}.\` [${t.title}](${t.uri}) \`[${formatDuration(t.length)}]\` — <@${t.requester?.id || 'unknown'}>`);
            });
        }

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Page ${page}/${totalPages} • Total tracks: ${queue.length + 1}`)
        );

        return interaction.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [container]
        });
    }
};
