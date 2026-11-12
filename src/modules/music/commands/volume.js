const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getKazagumo } = require('../services/lavalinkManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Adjust the music playback volume.')
        .addIntegerOption(opt =>
            opt.setName('level')
                .setDescription('Volume level from 1 to 100')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true)
        ),

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

        const level = interaction.options.getInteger('level', true);
        player.setVolume(level);

        return interaction.reply({ content: `🔊 Volume set to **${level}%**!` });
    }
};
