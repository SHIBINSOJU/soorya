const { handleMemberLeave } = require('../services/inviteService');

module.exports = {
    name: 'guildMemberRemove',
    async execute(member) {
        if (!member?.guild) return;
        if (member.user?.bot) return;
        await handleMemberLeave(member);
    }
};
