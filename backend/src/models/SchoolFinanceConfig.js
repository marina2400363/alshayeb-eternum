const mongoose = require("mongoose");

// Sandra-owned mapping from a School to its finance Google Sheet. Kept
// separate from School.js on purpose — Marina's School model stays
// untouched. schoolId uniquely identifies the config for that School (one
// finance sheet per School). No school name or ticket price is duplicated
// here; both are read fresh from School/Attendee at sync time.
const schoolFinanceConfigSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      unique: true
    },
    googleSheetId: {
      type: String,
      trim: true
    },
    tabName: {
      type: String,
      trim: true,
      default: "Sheet1"
    },
    enabled: {
      type: Boolean,
      default: true
    },
    lastSync: {
      at: Date,
      status: {
        type: String,
        enum: ["success", "error", "skipped"]
      },
      message: String,
      syncedCount: Number
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SchoolFinanceConfig", schoolFinanceConfigSchema);
