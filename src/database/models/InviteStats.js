const mongoose = require('mongoose');

const inviteStatsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    regular: { type: Number, default: 0 },
    left: { type: Number, default: 0 },
    fake: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 }
}, { timestamps: true });

inviteStatsSchema.index({ guildId: 1, userId: 1 }, { unique: true });

inviteStatsSchema.virtual('total').get(function() {
    return Math.max(0, (this.regular || 0) + (this.bonus || 0) - (this.left || 0));
});

inviteStatsSchema.set('toJSON', { virtuals: true });
inviteStatsSchema.set('toObject', { virtuals: true });

module.exports = {
    InviteStats: mongoose.models.InviteStats || mongoose.model('InviteStats', inviteStatsSchema)
};
