const { handleInviteCreate } = require('../services/inviteCache');

module.exports = {
    name: 'inviteCreate',
    async execute(invite) {
        handleInviteCreate(invite);
    }
};
