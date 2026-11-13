const inviteRepository = require('../../../database/repositories/inviteRepository');
const logger = require('../../../core/logger');

// The invites module records the join from its own guildMemberAdd listener and
// discord.js does not order listeners, so a welcome may run first. Poll briefly
// before falling back to "someone" — and never let a slow/absent database stall
// the welcome message itself.
const ATTEMPTS = 3;
const DELAY_MS = 300;
const LOOKUP_TIMEOUT_MS = 1500;

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))
    ]);
}

/**
 * Extra placeholder values for the welcome message. Only called when the
 * `welcome.invitedBy` text is configured, so servers without invite credit
 * never pay for the lookup.
 */
async function resolveInviteCredit(member) {
    const unknown = { '{inviter}': 'someone' };
    if (!member?.guild?.id || !member?.id || member.user?.bot) return unknown;

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const result = await withTimeout(
            inviteRepository.getJoinRecord(member.guild.id, member.id).catch((error) => {
                logger.warn(`Welcome: invite credit lookup failed: ${error.message}`);
                return null;
            }),
            LOOKUP_TIMEOUT_MS
        );

        if (result === 'timeout') {
            logger.warn('Welcome: invite credit lookup timed out — sending the welcome without it.');
            return unknown;
        }
        if (result?.inviterId) return { '{inviter}': `<@${result.inviterId}>` };
        if (attempt < ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }

    return unknown;
}

module.exports = { resolveInviteCredit };
