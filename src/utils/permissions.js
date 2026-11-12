const { PermissionFlagsBits } = require('discord.js');
const configService = require('../core/configService');

/**
 * Checks if a member has administrative/settings permissions or holds the
 * configured admin role (or a higher role in the role hierarchy).
 */
function isStaffOrAbove(member, guild) {
    if (!member) return false;
    
    // Server owner always has full access
    if (guild && member.id === guild.ownerId) return true;

    // Discord native admin permissions
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;

    // Configured admin role check (and role hierarchy: role or above)
    const adminRoleId = configService.get('adminRoleId', '1547085020957773884');
    if (adminRoleId && guild) {
        if (member.roles?.cache?.has(adminRoleId)) return true;

        const adminRole = guild.roles?.cache?.get(adminRoleId);
        if (adminRole && member.roles?.highest && member.roles.highest.position >= adminRole.position) {
            return true;
        }
    }

    return false;
}

module.exports = { isStaffOrAbove };
