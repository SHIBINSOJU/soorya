const { handleMemberJoin } = require('../services/inviteService');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member) {
        if (!member?.guild) return;
        if (member.user?.bot) return; // Ignore bots for invite tracking
        await handleMemberJoin(member);
    }
};
