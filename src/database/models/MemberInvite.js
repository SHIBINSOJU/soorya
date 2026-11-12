const mongoose = require('mongoose');

const memberInviteSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    memberId: { type: String, required: true, index: true },
    inviterId: { type: String, default: null, index: true },
    code: { type: String, default: null },
    isFake: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now }
}, { timestamps: true });

memberInviteSchema.index({ guildId: 1, memberId: 1 }, { unique: true });

module.exports = {
    MemberInvite: mongoose.models.MemberInvite || mongoose.model('MemberInvite', memberInviteSchema)
};
