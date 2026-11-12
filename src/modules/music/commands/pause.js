const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getKazagumo } = require('../services/lavalinkManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the current playing music.'),

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

        if (player.paused) {
            return interaction.reply({ content: '⚠️ The player is already paused. Use `/resume` to resume playback.', flags: MessageFlags.Ephemeral });
        }

        player.pause(true);
        return interaction.reply({ content: '⏸️ **Playback paused.**' });
    }
};
