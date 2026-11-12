const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getKazagumo } = require('../services/lavalinkManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the upcoming music queue.'),

    async execute(interaction) {
        if (!interaction.inGuild()) return;
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ You must be in a voice channel.', flags: MessageFlags.Ephemeral });
        }

        const kazagumo = getKazagumo();
        const player = kazagumo?.players.get(interaction.guild.id);
        if (!player || player.queue.length === 0) {
            return interaction.reply({ content: '❌ The queue has no upcoming songs to shuffle.', flags: MessageFlags.Ephemeral });
        }

        player.queue.shuffle();
        return interaction.reply({ content: `🔀 Shuffled **${player.queue.length}** songs in the queue!` });
    }
};
