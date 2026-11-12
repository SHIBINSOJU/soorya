const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getKazagumo } = require('../services/lavalinkManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume paused music playback.'),

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

        if (!player.paused) {
            return interaction.reply({ content: '⚠️ The player is not paused.', flags: MessageFlags.Ephemeral });
        }

        player.pause(false);
        return interaction.reply({ content: '▶️ **Playback resumed.**' });
    }
};
