var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var ObjectId = Schema.Types.ObjectId;
var Mixed = Schema.Types.Mixed;

var slotGroup = new Schema({
  name: {
    type: String,
    index: true,
    unique: true
  },
  area: String,
  descripton: String,
  slots: [ObjectId],
  ARRChecklist: Mixed,
  DRRChecklist: Mixed
});

var SlotGroup = mongoose.model('SlotGroup', slotGroup);

module.exports = {
  SlotGroup: SlotGroup
};