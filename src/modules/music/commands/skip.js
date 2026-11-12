const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getKazagumo } = require('../services/lavalinkManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the currently playing track.')
        .addIntegerOption(opt =>
            opt.setName('amount')
                .setDescription('Number of tracks to skip (default: 1)')
                .setMinValue(1)
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) return;
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ You must be in a voice channel.', flags: MessageFlags.Ephemeral });
        }

        const kazagumo = getKazagumo();
        const player = kazagumo?.players.get(interaction.guild.id);
        if (!player || !player.queue.current) {
            return interaction.reply({ content: '❌ Nothing is currently playing.', flags: MessageFlags.Ephemeral });
        }

        const currentTitle = player.queue.current.title;
        const amount = interaction.options.getInteger('amount') || 1;

        if (amount > 1) {
            const skipCount = Math.min(amount - 1, player.queue.length);
            player.queue.splice(0, skipCount);
        }

        player.skip();
        return interaction.reply({ content: `⏭️ Skipped **${currentTitle}**${amount > 1 ? ` (and skipped forward ${amount} tracks)` : ''}!` });
    }
};
