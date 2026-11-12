const { handleInviteDelete } = require('../services/inviteCache');

module.exports = {
    name: 'inviteDelete',
    async execute(invite) {
        handleInviteDelete(invite);
    }
};
