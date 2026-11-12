const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getKazagumo } = require('../services/lavalinkManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music playback, clear the queue, and leave voice.'),

    async execute(interaction) {
        if (!interaction.inGuild()) return;
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ You must be in a voice channel.', flags: MessageFlags.Ephemeral });
        }

        const kazagumo = getKazagumo();
        const player = kazagumo?.players.get(interaction.guild.id);
        if (!player) {
            return interaction.reply({ content: '❌ No active player in this server.', flags: MessageFlags.Ephemeral });
        }

        player.destroy();
        return interaction.reply({ content: '⏹️ **Stopped playback, cleared the queue, and left the voice channel.**' });
    }
};
