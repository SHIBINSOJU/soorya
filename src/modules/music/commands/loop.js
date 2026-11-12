const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getKazagumo } = require('../services/lavalinkManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Set the loop mode for the music player.')
        .addStringOption(opt =>
            opt.setName('mode')
                .setDescription('Loop mode')
                .setRequired(true)
                .addChoices(
                    { name: 'Off', value: 'none' },
                    { name: 'Track (Repeat Current Song)', value: 'track' },
                    { name: 'Queue (Repeat Whole Queue)', value: 'queue' }
                )
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

        const mode = interaction.options.getString('mode', true);
        player.setLoop(mode);

        const modeLabels = {
            none: '❌ **Loop disabled.**',
            track: '🔂 **Looping current track.**',
            queue: '🔁 **Looping entire queue.**'
        };

        return interaction.reply({ content: modeLabels[mode] || `Loop mode set to **${mode}**.` });
    }
};
